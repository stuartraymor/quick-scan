// SPDX-License-Identifier: AGPL-3.0-only
const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('quickScanUpdater', {
  check: () => ipcRenderer.invoke('updater:check'),
  download: () => ipcRenderer.invoke('updater:download'),
  install: () => ipcRenderer.invoke('updater:install'),
  onProgress: cb => { const h = (_e, p) => cb(p); ipcRenderer.on('updater:progress', h); return () => ipcRenderer.removeListener('updater:progress', h); },
});
contextBridge.exposeInMainWorld('quickScanFiles', {
  recent: () => ipcRenderer.invoke('files:recent'),
  remember: file => { try { const p = webUtils.getPathForFile(file); return p ? ipcRenderer.invoke('files:remember', p) : Promise.resolve([]); } catch { return Promise.resolve([]); } },
  open: p => ipcRenderer.invoke('files:open', p),
  clear: () => ipcRenderer.invoke('files:clear'),
  onChanged: cb => { const h = () => cb(); ipcRenderer.on('files:changed', h); return () => ipcRenderer.removeListener('files:changed', h); },
});
