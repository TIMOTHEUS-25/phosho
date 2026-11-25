const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  info: () => ipcRenderer.invoke('app:info'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  pickIndd: () => ipcRenderer.invoke('dialog:pickIndd'),
  open: (p) => ipcRenderer.invoke('doc:open', p),
  close: () => ipcRenderer.invoke('doc:close'),
  relinkFile: (name) => ipcRenderer.invoke('dialog:relinkFile', name),
  searchFolder: (names) => ipcRenderer.invoke('dialog:searchFolder', names),
  saveAs: (current) => ipcRenderer.invoke('dialog:saveAs', current),
  convert: (opts) => ipcRenderer.invoke('doc:convert', opts),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, p) => cb(p)),
});
