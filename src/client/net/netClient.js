// WebSocket client for Shardfall multiplayer servers.
import { PROTOCOL_VERSION } from '../../shared/net/protocol.js';

export function normalizeUrl(url) {
  let u = (url || '').trim();
  if (!u) throw new Error('Enter a server address');
  if (u.startsWith('http://')) u = `ws://${u.slice(7)}`;
  else if (u.startsWith('https://')) u = `wss://${u.slice(8)}`;
  else if (!/^wss?:\/\//.test(u)) u = `ws://${u}`;
  // default path
  const m = u.match(/^(wss?:\/\/[^/]+)(\/.*)?$/);
  if (m && (!m[2] || m[2] === '/')) u = `${m[1]}/ws`;
  if (!/:\d+/.test(u.split('/')[2]) && u.startsWith('ws://') && !u.includes('localhost:')) {
    // keep as-is (port 80) — explicit ports are recommended for LAN servers
  }
  return u;
}

export class NetClient {
  constructor() {
    this.ws = null;
    this.clientId = null;
    this.name = '';
    this.url = '';
    this.onRooms = null;
    this.onRoom = null;
    this.onChat = null;
    this.onError = null;
    this.onClose = null;
    this.onStart = null;
    this.onSnapshot = null;
    this.onGameMessage = null;
    this.ping = 0;
    this.closedByUser = false;
  }

  connect(url, name) {
    this.url = normalizeUrl(url);
    this.name = name;
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws;
      try {
        ws = new WebSocket(this.url);
      } catch (err) {
        reject(err);
        return;
      }
      this.ws = ws;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.close();
          reject(new Error('Timed out'));
        }
      }, 8000);
      ws.onopen = () => this.send({ t: 'hello', name, version: PROTOCOL_VERSION });
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Could not reach ${this.url}`));
        }
      };
      ws.onclose = () => {
        clearInterval(this.pingTimer);
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('Connection closed'));
        }
        if (!this.closedByUser && this.onClose) this.onClose();
      };
      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.t === 'welcome') {
          this.clientId = msg.clientId;
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(this);
          }
          this.pingTimer = setInterval(() => this.send({ t: 'ping', time: performance.now() }), 2000);
          return;
        }
        this.handle(msg);
      };
    });
  }

  handle(msg) {
    switch (msg.t) {
      case 'rooms':
        this.onRooms?.(msg.rooms);
        break;
      case 'room':
        this.room = msg.room;
        this.onRoom?.(msg.room);
        break;
      case 'chat':
        if (this.inGame) this.onGameMessage?.(msg);
        else this.onChat?.(msg.from, msg.text);
        break;
      case 'error':
        this.onError?.(msg.msg);
        break;
      case 'start':
        this.inGame = true;
        this.onStart?.(msg);
        break;
      case 'snap':
        this.onSnapshot?.(msg);
        break;
      case 'pong':
        this.ping = Math.round(performance.now() - msg.time);
        break;
      case 'left':
        this.inGame = false;
        break;
      default:
        break;
    }
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  listRooms() {
    this.send({ t: 'list' });
  }

  createRoom(name, mapId) {
    this.send({ t: 'create', name, mapId });
  }

  joinRoom(roomId) {
    this.send({ t: 'join', roomId });
  }

  leaveRoom() {
    this.inGame = false;
    this.send({ t: 'leave' });
  }

  setReady(ready) {
    this.send({ t: 'ready', ready });
  }

  setSlot(index, patch) {
    this.send({ t: 'slot', index, patch });
  }

  addAI(difficulty) {
    this.send({ t: 'addAI', difficulty });
  }

  kick(index) {
    this.send({ t: 'kick', index });
  }

  setMap(mapId) {
    this.send({ t: 'map', mapId });
  }

  startGame() {
    this.send({ t: 'start' });
  }

  chat(text) {
    this.send({ t: 'chat', text });
  }

  command(cmd) {
    this.send({ t: 'cmd', cmd });
  }

  close() {
    this.closedByUser = true;
    clearInterval(this.pingTimer);
    if (this.ws) this.ws.close();
  }
}
