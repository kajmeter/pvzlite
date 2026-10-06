// Shardfall server: serves the web client over HTTP and hosts multiplayer games over WebSocket.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { listMaps } from '../src/shared/maps/index.js';
import { PROTOCOL_VERSION } from '../src/shared/net/protocol.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export const SERVER_VERSION = '1.0.0';

// Static file providers: from a directory or from an in-memory map (single-binary builds)
export function dirProvider(dir) {
  const root = path.resolve(dir);
  return (rel) => {
    const p = path.resolve(root, `.${rel}`);
    if (!p.startsWith(root)) return null;
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) return null;
      return fs.readFileSync(p);
    } catch {
      return null;
    }
  };
}

export function memoryProvider(files) {
  return (rel) => {
    const f = files[rel.replace(/^\//, '')];
    return f ? Buffer.from(f, 'base64') : null;
  };
}

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

class Client {
  constructor(server, ws, id) {
    this.server = server;
    this.ws = ws;
    this.id = id;
    this.name = 'Player';
    this.room = null;
    this.hello = false;
    this.msgCount = 0;
    this.msgWindow = Date.now();
  }

  send(obj) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }
}

export function createServer({ port = 7777, host = '0.0.0.0', files = null, log = console.log, quiet = false } = {}) {
  const server = {
    clients: new Map(),
    rooms: new Map(),
    log: quiet ? () => {} : log,
    nextClientId: 1,
  };

  server.sendRooms = (client) => client.send({ t: 'rooms', rooms: [...server.rooms.values()].map((r) => r.summary()) });
  server.broadcastRooms = () => {
    for (const c of server.clients.values()) if (c.hello && !c.room) server.sendRooms(c);
  };

  const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ ok: true, name: 'shardfall', version: SERVER_VERSION, protocol: PROTOCOL_VERSION, clients: server.clients.size, rooms: server.rooms.size }));
      return;
    }
    if (url.pathname === '/api/rooms') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify([...server.rooms.values()].map((r) => r.summary())));
      return;
    }
    if (url.pathname === '/api/maps') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(listMaps()));
      return;
    }
    if (!files) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Shardfall multiplayer server is running. Connect with the game client using ws://<this-host>:<port>/ws');
      return;
    }
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '') p = '/index.html';
    let body = files(p);
    if (!body && !path.extname(p)) {
      p = '/index.html';
      body = files(p);
    }
    if (!body) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(p).toLowerCase();
    if (p === '/index.html') {
      // tell the client it is served by a game server (enables same-origin multiplayer)
      body = Buffer.from(body.toString('utf8').replace('<head>', '<head><script>window.__SHARDFALL_SERVER__=true</script>'));
    }
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
    });
    res.end(body);
  });

  const wss = new WebSocketServer({ server: httpServer, perMessageDeflate: { threshold: 512 } });
  wss.on('connection', (ws) => {
    const client = new Client(server, ws, server.nextClientId++);
    server.clients.set(client.id, client);
    ws.on('message', (data) => {
      // basic flood protection
      const now = Date.now();
      if (now - client.msgWindow > 1000) {
        client.msgWindow = now;
        client.msgCount = 0;
      }
      if (++client.msgCount > 60) return;
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      try {
        handle(server, client, msg);
      } catch (err) {
        server.log('error handling message', err);
      }
    });
    ws.on('close', () => {
      if (client.room) client.room.removeClient(client);
      server.clients.delete(client.id);
      server.log(`client ${client.id} (${client.name}) disconnected`);
    });
    ws.on('error', () => {});
  });

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      const addr = httpServer.address();
      server.port = addr.port;
      server.httpServer = httpServer;
      server.wss = wss;
      server.close = () =>
        new Promise((res) => {
          for (const r of [...server.rooms.values()]) r.close();
          for (const c of server.clients.values()) c.ws.terminate();
          wss.close();
          httpServer.close(() => res());
        });
      resolve(server);
    });
  });
}

function handle(server, client, msg) {
  if (msg.t === 'hello') {
    client.name = String(msg.name || 'Player').replace(/[<>]/g, '').trim().slice(0, 20) || 'Player';
    client.hello = true;
    client.send({ t: 'welcome', clientId: client.id, version: PROTOCOL_VERSION, server: SERVER_VERSION });
    server.log(`client ${client.id} connected as ${client.name}`);
    return;
  }
  if (!client.hello) return;
  const room = client.room;
  switch (msg.t) {
    case 'ping':
      client.send({ t: 'pong', time: msg.time });
      break;
    case 'list':
      server.sendRooms(client);
      break;
    case 'create': {
      if (room) room.removeClient(client);
      const r = new Room(server, client, msg.name, msg.mapId);
      server.rooms.set(r.id, r);
      server.log(`room ${r.id} "${r.name}" created by ${client.name}`);
      r.broadcastState();
      break;
    }
    case 'join': {
      const r = server.rooms.get(msg.roomId);
      if (!r) return client.send({ t: 'error', msg: 'Room not found' });
      if (room === r) return;
      if (room) room.removeClient(client);
      const err = r.addClient(client);
      if (err) client.send({ t: 'error', msg: err });
      break;
    }
    case 'leave':
      if (room) room.removeClient(client);
      server.sendRooms(client);
      break;
    case 'ready':
      room?.setReady(client, msg.ready);
      break;
    case 'slot':
      room?.setSlot(client, Number(msg.index), msg.patch || {});
      break;
    case 'addAI':
      if (room && room.hostId === client.id) room.addAI(msg.difficulty);
      break;
    case 'kick':
      room?.kick(client, Number(msg.index));
      break;
    case 'map':
      room?.setMap(client, msg.mapId);
      break;
    case 'start': {
      if (!room) return;
      const err = room.start(client);
      if (err) client.send({ t: 'error', msg: err });
      break;
    }
    case 'chat':
      room?.chat(client, msg.text);
      break;
    case 'cmd':
      room?.command(client, msg.cmd);
      break;
    default:
      break;
  }
}
