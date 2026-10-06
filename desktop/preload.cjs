// Exposes a tiny, safe API to the game UI running inside the desktop app.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pvzliteDesktop', {
  hostServer: (port) => ipcRenderer.invoke('pvzlite:host-server', port),
  info: () => ipcRenderer.invoke('pvzlite:info'),
  quit: () => ipcRenderer.send('pvzlite:quit'),
});
