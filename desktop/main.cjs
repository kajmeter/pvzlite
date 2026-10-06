// Electron main process for the Shardfall desktop client (Windows .exe, Linux .deb/AppImage).
// - Serves the built web client through a private app:// protocol
// - Can host a LAN multiplayer server in-process (Multiplayer → Host LAN server)
// - `Shardfall --server [--port 7777]` runs a dedicated server without opening a window
const { app, BrowserWindow, ipcMain, shell, protocol, net, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const serverMode = process.argv.includes('--server');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let lanServer = null;
let serverMod = null;

async function loadServerModule() {
  if (!serverMod) serverMod = await import(pathToFileURL(path.join(ROOT, 'server', 'server.js')).href);
  return serverMod;
}

async function hostServer(port = 7777) {
  const mod = await loadServerModule();
  if (!lanServer) {
    lanServer = await mod.createServer({ port, host: '0.0.0.0', files: mod.dirProvider(DIST) });
  }
  return { port: lanServer.port, addresses: mod.lanAddresses() };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#070b14',
    title: 'Shardfall',
    icon: path.join(ROOT, 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
  win.loadURL('app://game/index.html');
  return win;
}

if (serverMode) {
  // dedicated server without a window
  app.whenReady().then(async () => {
    const i = process.argv.indexOf('--port');
    const port = i > 0 ? Number(process.argv[i + 1]) : 7777;
    const info = await hostServer(port);
    console.log(`Shardfall server listening on port ${info.port}`);
    for (const a of info.addresses) console.log(`  ws://${a}:${info.port}/ws   http://${a}:${info.port}`);
  });
  app.on('window-all-closed', (e) => e.preventDefault());
} else {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) app.quit();

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    protocol.handle('app', (req) => {
      const url = new URL(req.url);
      let p = decodeURIComponent(url.pathname);
      if (p === '/' || p === '') p = '/index.html';
      const file = path.normalize(path.join(DIST, p));
      if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    });
    ipcMain.handle('shardfall:host-server', async (_e, port) => hostServer(Number(port) || 7777));
    ipcMain.handle('shardfall:info', () => ({ version: app.getVersion(), platform: process.platform }));
    ipcMain.on('shardfall:quit', () => app.quit());
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('second-instance', () => {
    const [w] = BrowserWindow.getAllWindows();
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });

  app.on('window-all-closed', async () => {
    if (lanServer) await lanServer.close();
    app.quit();
  });
}
