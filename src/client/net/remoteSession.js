// Client-side mirror of a server-authoritative game. Interpolates snapshots and
// exposes the same interface as LocalSession so the renderer/HUD don't care.
import { World } from '../../shared/sim/world.js';
import { PathGrid } from '../../shared/sim/pathgrid.js';
import { UNITS, BUILDINGS, RESEARCH } from '../../shared/data/defs.js';
import { PLAYER_COLORS, POWER_RADIUS, RESOURCE_EXCLUSION } from '../../shared/constants.js';
import { SURVIVAL_BUILDINGS } from '../../shared/data/survival.js';
import { TYPE_NAME, SNAPSHOT_INTERVAL, unrle } from '../../shared/net/protocol.js';
import { rectDist } from '../../shared/sim/geom.js';

export class RemoteSession {
  constructor(net, start) {
    this.net = net;
    this.isLocal = false;
    this.localPlayer = start.localPlayer;
    this.mode = start.mode === 'survival' ? 'survival' : 'classic';
    this.survival = null;
    // Build the static part of the world locally: same map + creation order => same entity ids
    const shadow = new World({ mapId: start.mapId, mode: this.mode, players: start.players.map((p) => ({ ...p, type: 'human' })), seed: start.seed, startCrystals: start.startCrystals });
    this.map = shadow.map;
    this.grid = new PathGrid(this.map);
    this.players = start.players.map((p, i) => ({
      id: i,
      name: p.name,
      team: p.team,
      color: p.color,
      colorHex: PLAYER_COLORS[p.color % PLAYER_COLORS.length].hex,
      type: p.type,
      role: p.role || 'builder',
      level: 1,
      lives: 0,
      essence: 0,
      heroId: 0,
      hunterUp: {},
      crystals: 0,
      flux: 0,
      supplyUsed: 0,
      supplyCap: 0,
      upgrades: { weapons: 0, armor: 0, barrier: 0, phaseTransit: 0, lunge: 0 },
      researching: {},
      eliminated: false,
      startBase: shadow.players[i].startBase,
      stats: {},
    }));
    this.ents = new Map();
    this._resources = [];
    this._neutrals = [];
    for (const r of shadow.resources) {
      const v = { id: r.id, kind: 'resource', type: r.type, owner: -1, bx: r.bx, by: r.by, w: r.w, h: r.h, x: r.x, y: r.y, r: r.r, amount: r.amount, maxAmount: r.maxAmount, rich: r.rich, siphon: 0, miner: 0 };
      this.ents.set(v.id, v);
      this._resources.push(v);
    }
    for (const n of shadow.neutrals) {
      const v = { id: n.id, kind: 'neutral', type: n.type, owner: -1, bx: n.bx, by: n.by, w: n.w, h: n.h, x: n.x, y: n.y, r: n.r, hp: n.hp, maxHp: n.maxHp, barrier: 0, maxBarrier: 0, holders: [], def: n.def };
      this.ents.set(v.id, v);
      this._neutrals.push(v);
    }
    this._units = [];
    this._buildings = [];
    const N = this.map.width * this.map.height;
    this.vis = new Uint8Array(N);
    this.exp = new Uint8Array(N);
    this.events = [];
    this.tick = 0;
    this.snapTime = performance.now();
    this.over = false;
    this.winnerTeam = -1;
    this.finalStats = null;
    this.speed = 1;
    this.lastSnapAt = performance.now();
    this.occSig = '';
    net.onSnapshot = (m) => this.applySnapshot(m);
    net.onGameMessage = (m) => this.events.push({ e: 'chat', from: m.from, text: m.text });
    net.onClose = () => this.events.push({ e: 'error', owner: this.localPlayer, msg: 'Disconnected from server' });
    this.rebuildOccupancy();
  }

  get time() {
    return this.tick / 20;
  }

  // ---------------------------------------------------------------- snapshot handling

  applySnapshot(m) {
    const now = performance.now();
    const a = this.alpha();
    this.tick = m.tick;
    const seen = new Set();
    const units = [];
    for (const row of m.units) {
      const [id, ti, owner, x, y, facing, hp, barrier, aa, lunging, carry, mining, hidden, warping, warpTotal] = row;
      const type = TYPE_NAME[ti];
      let v = this.ents.get(id);
      if (!v || v.kind !== 'unit') {
        const def = UNITS[type];
        v = { id, kind: 'unit', type, def, owner, x, y, px: x, py: y, facing, pfacing: facing, r: def.radius, maxHp: def.hp, maxBarrier: def.barrier, autocast: { lunge: true } };
        this.ents.set(id, v);
      } else {
        // continue from the currently displayed position
        v.px = v.px + (v.x - v.px) * a;
        v.py = v.py + (v.y - v.py) * a;
        let df = v.facing - v.pfacing;
        while (df > Math.PI) df -= Math.PI * 2;
        while (df < -Math.PI) df += Math.PI * 2;
        v.pfacing = v.pfacing + df * a;
        v.x = x;
        v.y = y;
        v.facing = facing;
        // teleports (e.g. leaving a siphon): snap
        if (Math.hypot(v.x - v.px, v.y - v.py) > 4) {
          v.px = x;
          v.py = y;
        }
      }
      v.hp = hp;
      v.barrier = barrier;
      v.attackAnim = aa;
      v.lunging = lunging;
      v.carry = carry === 2 ? 'flux' : carry === 1 ? 'crystals' : null;
      v.mining = mining;
      v.hidden = !!hidden;
      v.warping = warping;
      v.warpTotal = warpTotal;
      if (row[15]) {
        v.idle = row[15][0] === 1;
        v.autocast.lunge = row[15][1] === 1;
      }
      if (row[16]) {
        const [mh, mb, ar, sp, dm, sb, my, caged, sprint] = row[16];
        v.maxHp = mh;
        v.maxBarrier = mb;
        v.armor = ar;
        v.speedOverride = sp;
        v.damage = dm;
        v.structureBonus = sb;
        v.mineYield = my;
        v.caged = !!caged;
        v.sprinting = !!sprint;
      }
      seen.add(id);
      units.push(v);
    }
    const buildings = [];
    for (const row of m.buildings) {
      const [id, ti, owner, bx, by, hp, barrier, built, progress, phase, powered, beam, overclock] = row;
      const type = TYPE_NAME[ti];
      let v = this.ents.get(id);
      const def = BUILDINGS[type];
      if (!v || v.kind !== 'building') {
        v = { id, kind: 'building', type, def, owner, bx, by, w: def.size, h: def.size, x: bx + def.size / 2, y: by + def.size / 2, r: def.size / 2, maxHp: def.hp, maxBarrier: def.barrier, maxEnergy: def.energy ? def.energy.max : 0, queue: [] };
        this.ents.set(id, v);
      }
      v.hp = hp;
      v.barrier = barrier;
      v.built = !!built;
      v.progress = progress;
      v.phase = !!phase;
      v.powered = !!powered;
      v.beam = beam;
      v.overclock = overclock;
      if (row[13]) {
        const o = row[13];
        v.energy = o[0];
        v.warpCd = o[1];
        v.transform = o[2];
        v.queue = o[3].map(([k, qid, prog, time, level]) => ({ kind: k === 0 ? 'unit' : 'research', id: qid, progress: prog, time, level }));
        v.rally = o[4] ? { x: o[4][0], y: o[4][1], target: o[4][2] } : null;
        v.ventAmount = o[5] >= 0 ? o[5] : undefined;
      }
      if (row[14]) {
        const [mh, mb, level, aim, wd, wr] = row[14];
        v.maxHp = mh;
        v.maxBarrier = mb;
        v.level = level;
        v.aim = aim;
        v.weaponDamage = wd;
        v.weaponRange = wr;
      }
      seen.add(id);
      buildings.push(v);
    }
    for (const [id, ent] of this.ents) {
      if ((ent.kind === 'unit' || ent.kind === 'building') && !seen.has(id)) this.ents.delete(id);
    }
    this._units = units;
    this._buildings = buildings;
    for (const [id, amount, siphon, miner] of m.resources) {
      const r = this.ents.get(id);
      if (!r) continue;
      r.amount = amount;
      r.siphon = siphon;
      r.miner = miner;
    }
    for (const [id, hp, holders] of m.neutrals) {
      const n = this.ents.get(id);
      if (!n) continue;
      n.hp = hp;
      n.holders = holders;
    }
    for (const pl of m.players) {
      const p = this.players[pl.id];
      if (!p) continue;
      Object.assign(p, pl);
    }
    if (m.vision) unrle(m.vision, this.vis, this.exp);
    if (m.survival) this.survival = m.survival;
    for (const ev of m.events) {
      if (ev.e === 'death' && (ev.kind === 'resource' || ev.kind === 'neutral')) {
        this.ents.delete(ev.id);
        this._resources = this._resources.filter((r) => r.id !== ev.id);
        this._neutrals = this._neutrals.filter((r) => r.id !== ev.id);
      }
      this.events.push(ev);
    }
    if (m.over) {
      this.over = true;
      this.winnerTeam = m.winnerTeam;
      if (m.stats) this.finalStats = m.stats;
      if (m.reason) this.overReason = m.reason;
    }
    this.snapTime = now;
    this.lastSnapAt = now;
    this.rebuildOccupancy();
  }

  rebuildOccupancy() {
    const sig = `${this._buildings.map((b) => b.id).join(',')}|${this._resources.length}|${this._neutrals.length}`;
    if (sig === this.occSig) return;
    this.occSig = sig;
    this.grid.occ.fill(0);
    for (const e of [...this._resources, ...this._neutrals, ...this._buildings]) this.grid.setRect(e.bx, e.by, e.w, e.h, e.id);
  }

  update() {}

  alpha() {
    return Math.min(1, (performance.now() - this.snapTime) / (SNAPSHOT_INTERVAL * 1000));
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  issue(cmd) {
    this.net.command(cmd);
  }

  sendChat(text) {
    this.net.chat(text);
  }

  player() {
    return this.players[this.localPlayer];
  }

  survivalInfo() {
    return this.survival;
  }

  hero() {
    const p = this.players[this.localPlayer];
    return p && p.heroId ? this.ents.get(p.heroId) || null : null;
  }

  startLocation() {
    const h = this.hero();
    if (h) return { x: h.x, y: h.y };
    const p = this.players[this.localPlayer];
    if (this.mode === 'survival' && p) {
      const sp = p.role === 'hunter' ? this.map.cage : this.map.builderSpawns[0];
      if (sp) return { x: sp.x, y: sp.y };
    }
    const b = p && this.map.bases[p.startBase];
    return b ? { x: b.x, y: b.y } : { x: this.map.width / 2, y: this.map.height / 2 };
  }

  units() {
    return this._units;
  }

  buildings() {
    return this._buildings;
  }

  resources() {
    return this._resources;
  }

  neutrals() {
    return this._neutrals;
  }

  byId(id) {
    return this.ents.get(id);
  }

  visionArray() {
    return this.vis;
  }

  exploredArray() {
    return this.exp;
  }

  cellVisible(x, y) {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= this.map.width || cy >= this.map.height) return false;
    return this.vis[cy * this.map.width + cx] === 1;
  }

  isVisible(e) {
    if (e.owner !== undefined && e.owner >= 0 && this.isAllied(e.owner)) return true;
    if (e.kind === 'building' || e.kind === 'resource' || e.kind === 'neutral') {
      return (
        this.cellVisible(e.bx, e.by) ||
        this.cellVisible(e.bx + e.w - 1, e.by) ||
        this.cellVisible(e.bx, e.by + e.h - 1) ||
        this.cellVisible(e.bx + e.w - 1, e.by + e.h - 1) ||
        this.cellVisible(e.x, e.y)
      );
    }
    return this.cellVisible(e.x, e.y);
  }

  isExplored(x, y) {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= this.map.width || cy >= this.map.height) return false;
    return this.exp[cy * this.map.width + cx] === 1;
  }

  isAllied(owner) {
    const me = this.players[this.localPlayer];
    const o = this.players[owner];
    return !!(me && o && me.team === o.team);
  }

  teamColorHex(team) {
    const p = this.players.find((pl) => pl.team === team);
    return p ? p.colorHex : 0xffffff;
  }

  hasCompleted(type) {
    return this._buildings.some((b) => b.owner === this.localPlayer && b.type === type && b.built);
  }

  isPoweredAt(x, y) {
    return this._buildings.some((b) => b.owner === this.localPlayer && b.type === 'conduit' && b.built && Math.hypot(b.x - x, b.y - y) <= POWER_RADIUS);
  }

  canPlace(type, bx, by) {
    if (this.mode === 'survival') return this.canPlaceSurvival(type, bx, by);
    const def = BUILDINGS[type];
    for (const req of def.requires) if (!this.hasCompleted(req)) return { ok: false, reason: `Requires ${BUILDINGS[req].name}` };
    const s = def.size;
    if (def.onVent) {
      const vent = this._resources.find((r) => r.type === 'vent' && r.bx === bx && r.by === by);
      if (!vent) return { ok: false, reason: 'Must be placed on a flux vent' };
      if (vent.siphon) return { ok: false, reason: 'Vent already has a Siphon' };
      return { ok: true };
    }
    for (let y = by; y < by + s; y++) for (let x = bx; x < bx + s; x++) if (!this.grid.buildable(x, y)) return { ok: false, reason: "Can't build there" };
    if (!this.isExplored(bx + s / 2, by + s / 2)) return { ok: false, reason: 'Location not explored' };
    if (type === 'citadel' && !this.map.bases.some((m) => m.tx === bx && m.ty === by)) {
      for (const r of this._resources) if (rectDist(bx, by, s, s, r.bx, r.by, r.w, r.h) < RESOURCE_EXCLUSION) return { ok: false, reason: 'Too close to resources' };
    }
    if (def.needsPower && !this.isPoweredAt(bx + s / 2, by + s / 2)) return { ok: false, reason: 'Must be placed in a power field' };
    return { ok: true };
  }

  canPlaceSurvival(type, bx, by) {
    const sb = SURVIVAL_BUILDINGS[type];
    const p = this.player();
    if (!sb || !p) return { ok: false, reason: 'Unknown structure' };
    if (p.role !== 'builder') return { ok: false, reason: 'Only Shapers can build' };
    if ((p.level || 1) < sb.unlock) return { ok: false, reason: `Unlocks at level ${sb.unlock}` };
    for (let y = by; y < by + 2; y++) for (let x = bx; x < bx + 2; x++) if (!this.grid.buildable(x, y)) return { ok: false, reason: "Can't build there" };
    const cx = bx + 1;
    const cy = by + 1;
    const cage = this.map.cage;
    const cr = this.map.cageRadius + 2;
    if (Math.abs(cx - cage.x) < cr + 1 && Math.abs(cy - cage.y) < cr + 1) return { ok: false, reason: 'Too close to the Hunter cage' };
    if (!this.isExplored(cx, cy)) return { ok: false, reason: 'Location not explored' };
    if (sb.needsPower && !this._buildings.some((b) => b.owner === this.localPlayer && b.type === 'barricade' && b.built && Math.hypot(b.x - cx, b.y - cy) <= SURVIVAL_BUILDINGS.barricade.powerRadius)) {
      return { ok: false, reason: 'Needs a Barricade Ward nearby (power)' };
    }
    return { ok: true };
  }

  researchStatus(id) {
    const r = RESEARCH[id];
    const p = this.player();
    const level = p.upgrades[id] || 0;
    const pending = p.researching && p.researching[id] ? 1 : 0;
    const next = level + pending;
    if (next >= r.levels.length) return { ok: false, reason: 'Fully researched', level, maxed: true };
    const L = r.levels[next];
    for (const req of L.requires) if (!this.hasCompleted(req)) return { ok: false, reason: `Requires ${BUILDINGS[req].name}`, level, next, L };
    if (pending) return { ok: false, reason: 'Already researching', level, next, L };
    return { ok: true, level, next, L };
  }

  setSpeed() {}

  setPaused() {}

  netInfo() {
    const stale = performance.now() - this.lastSnapAt > 1500;
    return `${this.net.url.replace(/^wss?:\/\//, '')} · ping ${this.net.ping} ms${stale ? ' · waiting for server…' : ''}`;
  }

  stats() {
    if (this.finalStats) return this.finalStats;
    return this.players.map((p) => ({ id: p.id, name: p.name, team: p.team, colorHex: p.colorHex, role: p.role, level: p.level, lives: p.lives, deaths: p.deaths, hunterUp: p.hunterUp, crystalsMined: 0, fluxMined: 0, unitsMade: 0, kills: 0, unitsLost: 0, structuresBuilt: 0, structuresKilled: 0 }));
  }

  leave() {
    this.net.leaveRoom();
  }

  dispose() {
    this.net.onSnapshot = null;
    this.net.onGameMessage = null;
  }
}
