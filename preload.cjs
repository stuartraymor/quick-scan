// SPDX-License-Identifier: AGPL-3.0-only
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('quickScanUpdater', {
  check: () => ipcRenderer.invoke('updater:check'),
  download: () => ipcRenderer.invoke('updater:download'),
  install: () => ipcRenderer.invoke('updater:install'),
  onProgress: cb => { const h = (_e, p) => cb(p); ipcRenderer.on('updater:progress', h); return () => ipcRenderer.removeListener('updater:progress', h); },
});
