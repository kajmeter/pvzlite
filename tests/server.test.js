import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { createServer, memoryProvider } from '../server/server.js';

let server;
let base;

function client(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
    const inbox = [];
    const waiters = [];
    ws.on('message', (d) => {
      const msg = JSON.parse(d.toString());
      inbox.push(msg);
      for (const w of [...waiters]) {
        if (w.pred(msg)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(msg);
        }
      }
    });
    const c = {
      ws,
      inbox,
      send: (o) => ws.send(JSON.stringify(o)),
      wait: (pred, ms = 5000) =>
        new Promise((res, rej) => {
          const found = inbox.find(pred);
          if (found) {
            inbox.splice(inbox.indexOf(found), 1);
            return res(found);
          }
          const t = setTimeout(() => rej(new Error('timeout waiting for message')), ms);
          waiters.push({ pred, resolve: (m) => (clearTimeout(t), inbox.splice(inbox.indexOf(m), 1), res(m)) });
        }),
    };
    ws.on('open', async () => {
      c.send({ t: 'hello', name, version: 1 });
      const w = await c.wait((m) => m.t === 'welcome');
      c.id = w.clientId;
      resolve(c);
    });
    ws.on('error', reject);
  });
}

beforeAll(async () => {
  const files = memoryProvider({ 'index.html': Buffer.from('<html><head></head><body>test</body></html>').toString('base64') });
  server = await createServer({ port: 0, host: '127.0.0.1', files, quiet: true });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server.close();
});

describe('http', () => {
  it('reports health', async () => {
    const r = await fetch(`${base}/health`);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.name).toBe('pvzlite');
  });

  it('serves the web client with the server flag injected', async () => {
    const r = await fetch(`${base}/`);
    const t = await r.text();
    expect(t).toContain('__PVZLITE_SERVER__');
  });

  it('lists maps', async () => {
    const j = await (await fetch(`${base}/api/maps`)).json();
    expect(j.length).toBeGreaterThanOrEqual(5);
  });
});

describe('multiplayer flow', () => {
  it('creates a room, joins, starts and streams snapshots', async () => {
    const a = await client('Alice');
    const b = await client('Bob');
    a.send({ t: 'create', name: 'Test game', mapId: 'proving', mode: 'classic' });
    const roomMsg = await a.wait((m) => m.t === 'room');
    expect(roomMsg.room.slots).toHaveLength(1);
    b.send({ t: 'list' });
    const rooms = await b.wait((m) => m.t === 'rooms' && m.rooms.length > 0);
    b.send({ t: 'join', roomId: rooms.rooms[0].id });
    await b.wait((m) => m.t === 'room' && m.room.slots.length === 2);
    // host cannot start until the guest is ready
    a.send({ t: 'start' });
    const err = await a.wait((m) => m.t === 'error');
    expect(err.msg).toMatch(/ready/);
    b.send({ t: 'ready', ready: true });
    await a.wait((m) => m.t === 'room' && m.room.slots[1] && m.room.slots[1].ready);
    a.send({ t: 'chat', text: 'glhf' });
    const chat = await b.wait((m) => m.t === 'chat');
    expect(chat.text).toBe('glhf');
    a.send({ t: 'start' });
    const sa = await a.wait((m) => m.t === 'start');
    const sb = await b.wait((m) => m.t === 'start');
    expect(sa.localPlayer).toBe(0);
    expect(sb.localPlayer).toBe(1);
    expect(sa.mapId).toBe('proving');
    const snap = await a.wait((m) => m.t === 'snap');
    expect(snap.units.length).toBeGreaterThanOrEqual(12);
    expect(snap.players[0].crystals).toBeGreaterThanOrEqual(0);
    // enemy economy is hidden
    expect(snap.players[1].crystals).toBeUndefined();
    // own units only (enemy base is out of sight at the start)
    expect(snap.units.every((u) => u[2] === 0)).toBe(true);
    // issue a command: train a Shaper at our Citadel
    const citadel = snap.buildings.find((r) => r[2] === 0);
    a.send({ t: 'cmd', cmd: { type: 'train', ids: [citadel[0]], unit: 'shaper' } });
    const later = await a.wait((m) => m.t === 'snap' && m.buildings.some((r) => r[0] === citadel[0] && r[13] && r[13][3].length === 1), 3000);
    expect(later).toBeTruthy();
    // leaving a running game surrenders
    b.send({ t: 'leave' });
    const over = await a.wait((m) => m.t === 'snap' && m.over === 1, 5000);
    expect(over.winnerTeam).toBe(sa.players[0].team);
    expect(over.stats).toHaveLength(2);
    a.ws.close();
    b.ws.close();
  });

  it('host can add AI players', async () => {
    const a = await client('Host');
    a.send({ t: 'create', name: 'AI game', mapId: 'quarry', mode: 'classic' });
    await a.wait((m) => m.t === 'room');
    a.send({ t: 'addAI', difficulty: 'easy' });
    a.send({ t: 'addAI', difficulty: 'hard' });
    const r = await a.wait((m) => m.t === 'room' && m.room.slots.length === 3);
    expect(r.room.slots[1].ai).toBe(true);
    a.send({ t: 'start' });
    const s = await a.wait((m) => m.t === 'start');
    expect(s.players).toHaveLength(3);
    await a.wait((m) => m.t === 'snap');
    a.ws.close();
  });

  it('ignores garbage messages', async () => {
    const a = await client('Fuzzer');
    a.ws.send('not json');
    a.send({ t: 'cmd', cmd: { type: 'move', ids: 'x', x: 'nan' } });
    a.send({ t: 'unknown' });
    a.send({ t: 'ping', time: 1 });
    const pong = await a.wait((m) => m.t === 'pong');
    expect(pong.time).toBe(1);
    a.ws.close();
  });
});

describe('survival multiplayer', () => {
  it('starts a survival room with a Shaper and a Hunter', async () => {
    const a = await client('Shaper');
    const b = await client('Hunter');
    a.send({ t: 'create', name: 'PvZ night', mapId: 'wilds', mode: 'survival' });
    const r = await a.wait((m) => m.t === 'room');
    expect(r.room.mode).toBe('survival');
    b.send({ t: 'join', roomId: r.room.id });
    const r2 = await a.wait((m) => m.t === 'room' && m.room.slots.length === 2);
    expect(r2.room.slots[1].role).toBe('hunter');
    a.send({ t: 'addAI', difficulty: 'easy' });
    await a.wait((m) => m.t === 'room' && m.room.slots.length === 3);
    b.send({ t: 'ready', ready: true });
    await a.wait((m) => m.t === 'room' && m.room.slots[1] && m.room.slots[1].ready);
    a.send({ t: 'start' });
    const sa = await a.wait((m) => m.t === 'start');
    expect(sa.mode).toBe('survival');
    const snap = await a.wait((m) => m.t === 'snap' && m.survival);
    expect(snap.survival.phase).toBe('grace');
    const me = snap.players[0];
    expect(me.role).toBe('builder');
    expect(me.crystals).toBeGreaterThan(0);
    const hero = snap.units.find((u) => u[0] === me.heroId);
    expect(hero[16][0]).toBeGreaterThan(0); // hero max hull is streamed
    a.send({ t: 'cmd', cmd: { type: 'levelUp' } });
    a.ws.close();
    b.ws.close();
  });
});
