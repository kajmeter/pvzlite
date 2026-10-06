// A multiplayer room: lobby slots, then an authoritative game simulation.
import { World } from '../src/shared/sim/world.js';
import { getMap, listMaps } from '../src/shared/maps/index.js';
import { TICK_RATE, PLAYER_COLORS, AI_DIFFICULTIES } from '../src/shared/constants.js';
import { makeSnapshot, SNAPSHOT_EVERY } from '../src/shared/net/protocol.js';

let roomSerial = 1;

export class Room {
  constructor(server, host, name, mapId) {
    this.server = server;
    this.id = `r${roomSerial++}`;
    this.name = String(name || 'Game').slice(0, 32);
    this.mapId = listMaps().some((m) => m.id === mapId) ? mapId : 'frostgate';
    this.hostId = host.id;
    this.slots = [];
    this.started = false;
    this.world = null;
    this.timer = null;
    this.pendingEvents = [];
    this.createdAt = Date.now();
    this.addClient(host);
  }

  get map() {
    return getMap(this.mapId);
  }

  get maxPlayers() {
    return this.map.players;
  }

  summary() {
    return {
      id: this.id,
      name: this.name,
      mapId: this.mapId,
      mapName: this.map.name,
      players: this.slots.length,
      maxPlayers: this.maxPlayers,
      started: this.started,
    };
  }

  state() {
    return {
      id: this.id,
      name: this.name,
      mapId: this.mapId,
      host: this.hostId,
      started: this.started,
      slots: this.slots.map((s) => ({ clientId: s.clientId ?? null, name: s.name, ai: !!s.ai, difficulty: s.difficulty, color: s.color, team: s.team, ready: !!s.ready })),
    };
  }

  freeColor() {
    for (let c = 0; c < PLAYER_COLORS.length; c++) if (!this.slots.some((s) => s.color === c)) return c;
    return 0;
  }

  freeTeam() {
    for (let t = 1; t <= 8; t++) if (!this.slots.some((s) => s.team === t)) return t;
    return 1;
  }

  addClient(client) {
    if (this.started) return 'Game already started';
    if (this.slots.length >= this.maxPlayers) return 'Room is full';
    this.slots.push({ clientId: client.id, name: client.name, color: this.freeColor(), team: this.freeTeam(), ready: false });
    client.room = this;
    this.broadcastState();
    return null;
  }

  addAI(difficulty) {
    if (this.started || this.slots.length >= this.maxPlayers) return;
    const d = AI_DIFFICULTIES.includes(difficulty) ? difficulty : 'normal';
    this.slots.push({ ai: true, difficulty: d, name: `AI (${d})`, color: this.freeColor(), team: this.freeTeam(), ready: true });
    this.broadcastState();
  }

  removeClient(client) {
    client.room = null;
    if (this.started && this.world) {
      // player left a running game: they surrender
      const idx = this.slots.findIndex((s) => s.clientId === client.id);
      if (idx >= 0) {
        this.slots[idx].left = true;
        this.world.issue(idx, { type: 'surrender' });
      }
      if (!this.slots.some((s) => s.clientId && !s.left)) this.close();
      return;
    }
    this.slots = this.slots.filter((s) => s.clientId !== client.id);
    if (!this.slots.some((s) => s.clientId)) {
      this.close();
      return;
    }
    if (this.hostId === client.id) this.hostId = this.slots.find((s) => s.clientId).clientId;
    this.broadcastState();
  }

  setSlot(client, index, patch) {
    const s = this.slots[index];
    if (!s || this.started) return;
    const isHost = client.id === this.hostId;
    if (!(s.clientId === client.id || (isHost && s.ai))) return;
    if (typeof patch.color === 'number' && patch.color >= 0 && patch.color < PLAYER_COLORS.length) {
      if (!this.slots.some((o) => o !== s && o.color === patch.color)) s.color = patch.color;
    }
    if (typeof patch.team === 'number' && patch.team >= 1 && patch.team <= 8) s.team = patch.team;
    if (s.ai && typeof patch.difficulty === 'string' && AI_DIFFICULTIES.includes(patch.difficulty)) {
      s.difficulty = patch.difficulty;
      s.name = `AI (${s.difficulty})`;
    }
    this.broadcastState();
  }

  kick(client, index) {
    if (client.id !== this.hostId || this.started) return;
    const s = this.slots[index];
    if (!s) return;
    if (s.ai) {
      this.slots.splice(index, 1);
      this.broadcastState();
      return;
    }
    if (s.clientId === client.id) return;
    const victim = this.server.clients.get(s.clientId);
    if (victim) {
      this.removeClient(victim);
      victim.send({ t: 'error', msg: 'You were removed from the room' });
      this.server.sendRooms(victim);
    }
  }

  setReady(client, ready) {
    const s = this.slots.find((x) => x.clientId === client.id);
    if (s) s.ready = !!ready;
    this.broadcastState();
  }

  setMap(client, mapId) {
    if (client.id !== this.hostId || this.started) return;
    if (!listMaps().some((m) => m.id === mapId)) return;
    this.mapId = mapId;
    while (this.slots.length > this.maxPlayers) {
      const idx = this.slots.findLastIndex((s) => s.ai);
      if (idx < 0) break;
      this.slots.splice(idx, 1);
    }
    this.broadcastState();
  }

  chat(client, text) {
    const t = String(text || '').slice(0, 140).trim();
    if (!t) return;
    for (const s of this.slots) {
      const c = s.clientId && this.server.clients.get(s.clientId);
      if (c) c.send({ t: 'chat', from: client.name, text: t });
    }
  }

  broadcastState() {
    const st = this.state();
    for (const s of this.slots) {
      const c = s.clientId && this.server.clients.get(s.clientId);
      if (c) c.send({ t: 'room', room: st });
    }
    this.server.broadcastRooms();
  }

  start(client) {
    if (client.id !== this.hostId || this.started) return 'Only the host can start';
    if (this.slots.length < 2) return 'Need at least two players (add an AI)';
    if (new Set(this.slots.map((s) => s.team)).size < 2) return 'Need at least two different teams';
    const notReady = this.slots.filter((s) => s.clientId && s.clientId !== this.hostId && !s.ready);
    if (notReady.length) return `Waiting for ${notReady.map((s) => s.name).join(', ')} to be ready`;
    this.started = true;
    const seed = Math.floor(Math.random() * 1e9);
    const players = this.slots.map((s) => ({ name: s.name, team: s.team, color: s.color, type: s.ai ? 'ai' : 'human', difficulty: s.difficulty }));
    this.world = new World({ mapId: this.mapId, players, seed });
    this.slots.forEach((s, i) => {
      const c = s.clientId && this.server.clients.get(s.clientId);
      if (c) c.send({ t: 'start', mapId: this.mapId, players: players.map(({ name, team, color, type }) => ({ name, team, color, type })), localPlayer: i, seed });
    });
    this.server.log(`room ${this.id} started on ${this.mapId} with ${players.length} players`);
    this.server.broadcastRooms();
    this.loop();
    return null;
  }

  loop() {
    const stepMs = 1000 / TICK_RATE;
    let next = Date.now();
    const tick = () => {
      if (!this.world) return;
      const now = Date.now();
      let steps = 0;
      while (now >= next && steps < 5) {
        this.step();
        next += stepMs;
        steps++;
      }
      if (now - next > 1000) next = now; // fell far behind: resync
      this.timer = setTimeout(tick, Math.max(1, next - Date.now()));
    };
    tick();
  }

  step() {
    const w = this.world;
    w.step();
    const ev = w.drainEvents();
    if (ev.length) this.pendingEvents.push(...ev);
    if (w.tick % SNAPSHOT_EVERY === 0 || w.over) {
      const events = this.pendingEvents;
      this.pendingEvents = [];
      this.slots.forEach((s, i) => {
        const c = s.clientId && !s.left && this.server.clients.get(s.clientId);
        if (!c) return;
        const snap = makeSnapshot(w, i, events);
        if (w.over) snap.stats = w.players.map((p) => ({ id: p.id, name: p.name, team: p.team, colorHex: p.colorHex, ...p.stats, timeline: undefined, eliminated: p.eliminated }));
        c.send(snap);
      });
    }
    if (w.over && !this.endTimer) {
      this.server.log(`room ${this.id} finished, winner team ${w.winnerTeam}`);
      clearTimeout(this.timer);
      this.world = null;
      this.endTimer = setTimeout(() => this.close(), 60000);
    }
  }

  command(client, cmd) {
    if (!this.world || !cmd || typeof cmd !== 'object') return;
    const idx = this.slots.findIndex((s) => s.clientId === client.id);
    if (idx < 0) return;
    this.world.issue(idx, cmd);
  }

  close() {
    clearTimeout(this.timer);
    clearTimeout(this.endTimer);
    this.world = null;
    for (const s of this.slots) {
      const c = s.clientId && this.server.clients.get(s.clientId);
      if (c && c.room === this) {
        c.room = null;
        c.send({ t: 'left' });
      }
    }
    this.server.rooms.delete(this.id);
    this.server.broadcastRooms();
  }
}
