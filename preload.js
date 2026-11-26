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
  profiles: {
    load: () => ipcRenderer.invoke('profiles:load'),
    save: (data) => ipcRenderer.invoke('profiles:save', data),
    importCsv: () => ipcRenderer.invoke('profiles:importCsv'),
    exportCsv: (profile) => ipcRenderer.invoke('profiles:exportCsv', profile),
  },
  onProgress: (cb) => ipcRenderer.on('progress', (_e, p) => cb(p)),
});
