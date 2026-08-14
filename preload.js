const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  apiVersion: 'listen-v2',
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  openPath: (targetPath) => ipcRenderer.invoke('open-path', targetPath),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (data) => ipcRenderer.invoke('save-settings', data),
  isElectron: () => ipcRenderer.invoke('is-electron'),
  getPort: () => ipcRenderer.invoke('get-port'),
  listenCapable: () => ipcRenderer.invoke('listen-capable'),
  closeWindow: () => ipcRenderer.send('close-window')
});
