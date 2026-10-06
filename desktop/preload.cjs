// Exposes a tiny, safe API to the game UI running inside the desktop app.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shardfallDesktop', {
  hostServer: (port) => ipcRenderer.invoke('shardfall:host-server', port),
  info: () => ipcRenderer.invoke('shardfall:info'),
  quit: () => ipcRenderer.send('shardfall:quit'),
});
