# Evil Asset Fetcher

Resilient synchronization of manifest of files to the local files system. 

This is a sharable package that's been extracted from the initial implementation in the original player software, outlined here: https://github.com/cinemataztic/player/pull/53

## Getting started

The package is available on [npm](https://www.npmjs.com/package/@cinemataztic/evil-asset-fetcher), and can be installed with:
```sh
npm install evil-asset-fetcher
```


## Usage

Simple example of usage:

```js
const DownloadManager = require('@cinemataztic/evil-asset-fetcher');

const downloadManager = new DownloadManager({
  workingDirectory: process.env.WORKING_DIR,
  interval: process.env.SYNC_INTERVAL_SEC * 1000,
  verbose: true,
  getManifest: () => {
    return new Promise(async (resolve, reject) => {

      const response = fetch('https://example.com/manifest.json');
      if (!response.ok) {
        reject(new Error(`Failed to fetch manifest: ${response.statusText}`));
      }
      const json = await response.json();
      resolve(json);
    });
  },
  getDownloadDelay: retries => Math.round(10 + retries * 30)
})

downloadManager.init();
```



## Motivation

Many of our products running on the machines in the cinema need to download various assets from our servers. Experience shows us that the network is not always reliable, and we need to be able to recover from network errors and other issues. This package provides functionality to download files reliably, and to keep track of the files that have been downloaded.


## Documentation

Documentation is available at https://cinemataztic.github.io/evil-asset-fetcher/


## Build and deploy

The package is built and distributed using a GitHub action. To build and deploy a new version, simply create a new release on GitHub. The action will automatically build and publish the package to npm.