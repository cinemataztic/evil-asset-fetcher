const fetch = require('node-fetch')
const fs = require('fs')
const path = require('path')
const extract = require('extract-zip')

/**
 * Download a file from a url
 * 
 */
class DownloadManager {
  /**
   * Initialize the download manager
   * @constructor
   * @public
   * @param {Object} options The download manager options
   * @param {Number} options.abandonedTimeout The time in milliseconds to wait before abandoning a download (default: 30 minutes)
   * @param {Number} options.defaultDelayInSeconds The default delay in seconds to wait before starting a download (default: 0). This is used when a download is scheduled but the delay is not specified in the options object.
   * @param {Boolean} options.disableUnzip If true, don't unzip the downloaded zip file (default: false)
   * @param {Array} options.downloadManifest The list of files to download (default: [])
   * @param {Number} options.downloadManifest.delayInSeconds The delay in seconds to wait before starting the download (default: 1 minute)
   * @param {String} options.downloadManifest.fileName The name of the file to download (the file path will be the download directory + this name) (default: The file name from the url)
   * @param {String} options.downloadManifest.url The url to download the file from
   * @param {String} options.downloadManifest.unzipTo The path to unzip the downloaded file to
   * @param {Number} options.interval The interval in milliseconds at which to download/check for downloads (default: 1 minute)
   * @param {Boolean} options.verbose If true, print out debug messages (default: false)
   * @param {String} options.workingDirectory The directory to download files to (default: './downloads')
   */
  constructor(options={}) {
    // Internal state
    this.currentDownloads = {};
    this.scheduledDownloads = {};
    this._downloadInterval;

    // Options
    this.abandonedTimeout = options?.abandonedTimeout ?? 1800000;
    this.defaultDelayInSeconds = options?.defaultDelayInSeconds ?? 0;
    this.disableUnzip = options?.disableUnzip ?? false;
    this.downloadManifest = options?.downloadManifest ? options.downloadManifest.map(manifest => ({
        delayInSeconds: manifest.delayInSeconds ?? 60,
        fileName: manifest.fileName,
        url: manifest.url,
        unzipTo: manifest.unzipTo
      })) : [];
    this.interval = options?.interval ?? 60000;
    this.verbose = options?.verbose ?? false;
    this.workingDirectory = path.resolve(options?.workingDirectory ?? './downloads')
  }

  init() {
    // Initialize the download of the files in the manifest if they don't already exist in the download directory
    // Set interval to check for downloads every minute
    this._logger(`Initializing download manager\nDownload interval set to ${this.interval / 1000} seconds`)
    this._downloadInterval = setInterval(() => {
      this._logger('Checking for downloads')
      this._checkLocalCache()?.forEach(async (manifest) => {
        if (!manifest.fileName) {
          manifest.fileName = path.basename(manifest.url)
        }
        this._logger(`Checking for ${manifest.fileName}`)
        try {
          const file = await this.start(path.resolve(this.workingDirectory, manifest.fileName), {
            url: manifest.url
          }, {
            delayInSeconds: manifest.delayInSeconds
          });

          // If the file is a zip file, the manifest has unzipTo property and unzip is not disabled
          // Unzip the file
          const fileName = file.split('/').pop()
          if (fileName.indexOf('.zip') > -1 && manifest.unzipTo && !this.disableUnzip) {
            // Unzip the file to the directory
            extract(file, {
              dir: manifest.unzipTo
            }, (err) => {
              if (err) {
                this._logger(`Error unzipping file: ${err}`)
              }
            });
          }
        } catch (err) {
          this._logger(`Error downloading ${manifest.fileName}: ${err}`)
        }
      });
    }, this.interval)
  }

  /**
   * Check the local cache (file system) for the files in the manifest and return the files that don't exist
   * @returns {Array} The list of files that don't exist in the local cache
   */
  _checkLocalCache() {
    // Check the local cache for the files in the manifest
    const missingFiles = this.downloadManifest.filter(manifest => {
      return !fs.existsSync(path.resolve(this.workingDirectory, manifest.fileName))
    })

    return missingFiles
  }


  /**
   * Start a file download
   * @param {String} filePath The path to save the file to
   * @param {Object} requestConfig The configuration for the request
   * @param {Object} options The options for the download
   * @returns {Promise} A promise that resolves when the file is downloaded
   * @public
   */
  start(filePath, requestConfig, options) {
    if (options && options.delayInSeconds) {
      return this._delayedStart(filePath, requestConfig, options)
    }

    // Clear scheduled download if it exists
    if (this.currentDownloads[filePath]) {
      clearTimeout(this.currentDownloads[filePath].timeout)
    }

    return new Promise(async (resolve, reject) => {

      // Const get download from the current downloads
      const download = this.currentDownloads[filePath]

      // Check that download is not older than 30 minutes
      if (download && download.startTime && (Date.now() - download.startTime) > this.abandonedTimeout) {
        // Delete the download
        delete this.currentDownloads[filePath]
        // Remove temporary file
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
        }
        // Reject the promise
        reject(`Download is older than ${this.abandonedTimeout / 1000} seconds`)
        return;
      }

      // Check if we're already downloading this file)
      if (download) {
        reject('Duplicate download')
        return;
      }

      // Check if the file already exists in the download directory
      if (fs.existsSync(filePath)) {
        // Delete the file so we can initialize a fresh download
        fs.unlinkSync(filePath)
      }

      // Create the download
      if (options && options.onNewDownload) {
        options.onNewDownload()
      }

      // Insert the download into the current downloads
      this.currentDownloads[filePath] = {
        startTime: Date.now()
      }
      // Start a new download
      const file = fs.createWriteStream(filePath)
      const res = await fetch(requestConfig.url, requestConfig)
      res.body.pipe(file)
      res.body.on('error', (err) => {
        // Remove the file from the current downloads
        delete this.currentDownloads[filePath]
        // Remove the file from the filesystem
        fs.unlink(filePath, () => {
          reject(err)
        })
      })
      file.on('finish', () => {
        // Remove the file from the current downloads
        delete this.currentDownloads[filePath]
        resolve(filePath)
      })
    })
  }

  /**
   * Start a download after a delay
   * @param {Object} filePath The path to save the file to
   * @param {Object} requestConfig The configuration for the request
   * @param {Object} options The options for the download
   * @returns {Promise} A promise that resolves when the file is downloaded
   * @private
   */
  _delayedStart(filePath, requestConfig, options) {
    return new Promise((resolve, reject) => {
      if (this.scheduledDownloads[filePath]) {
        reject(`Duplicate download: starting in ${(this.scheduledDownloads[filePath].startTime - Date.now())/1000} seconds`)
        return;
      }
      if (this.currentDownloads[filePath]) {
        reject(`Duplicate download: cannot schedule a download while another is in progress`)
        return;
      }
      const delay = options.delayInSeconds ?? this.defaultDelayInSeconds
      const timeout = setTimeout(() => {
        delete options.delayInSeconds
        delete this.scheduledDownloads[filePath]
        this.start(filePath, requestConfig, options).then(resolve).catch(reject)
      }, delay * 1000)

      this.scheduledDownloads[filePath] = {
        startTime: Date.now() + (delay * 1000),
        timeout
      }
    })
  }

  // HELPERS
  /**
   * Log a message if the verbose option is set to true
   * @param {String} message The message to log
   * @private
   * @returns {void}
   * @example
   * this._logger('Hello World')
   * // => 'Hello World'
   */
  _logger(message) {
    if (this.verbose) {
      console.log(message)
    }
  }
}

module.exports = DownloadManager