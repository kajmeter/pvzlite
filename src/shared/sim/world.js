// The authoritative game world. Runs identically in the browser (single player)
// and on the server (multiplayer).
import {
  TICK_RATE,
  DT,
  MAX_SUPPLY,
  START_CRYSTALS,
  START_FLUX,
  START_WORKERS,
  BARRIER_REGEN_DELAY,
  BARRIER_REGEN_RATE,
  FOG_UPDATE_TICKS,
  POWER_RADIUS,
  BEACON_CAPTURE_RANGE,
  PLAYER_COLORS,
} from '../constants.js';
import { UNITS, BUILDINGS, RESEARCH, NEUTRALS } from '../data/defs.js';
import { getMap } from '../maps/index.js';
import { PathGrid } from './pathgrid.js';
import { SpatialHash } from './spatial.js';
import { Rng } from './rng.js';
import { updateUnit, resolveCollisions, clearOrders } from './behavior.js';
import {
  updateBuilding,
  canPlace,
  placeBuilding,
  queueTrain,
  queueResearch,
  cancelQueue,
  cancelConstruction,
  overclock,
  warpIn,
  researchStatus,
} from './structures.js';
import { updateVision } from './vision.js';
import { AIController } from '../ai/ai.js';

let groupSerial = 1;

export class World {
  /**
   * @param {object} opts
   * @param {string} opts.mapId
   * @param {Array<{name:string,team?:number,color?:number,type?:'human'|'ai',difficulty?:string}>} opts.players
   * @param {number} [opts.seed]
   */
  constructor(opts) {
    const { mapId, players, seed = 1 } = opts;
    this.options = opts;
    this.map = getMap(mapId);
    this.grid = new PathGrid(this.map);
    this.hash = new SpatialHash(this.map.width, this.map.height, 4);
    this.rng = new Rng(seed);
    this.defs = { UNITS, BUILDINGS, RESEARCH };
    this.tick = 0;
    this.nextId = 1;
    this.entities = [];
    this.byId = new Map();
    this.units = [];
    this.buildings = [];
    this.resources = [];
    this.neutrals = [];
    this.events = [];
    this.dead = [];
    this.pending = [];
    this.pathBudget = 0;
    this._q = [];
    this.over = false;
    this.winnerTeam = -1;
    this.ais = [];
    this.errorThrottle = new Map();

    this.players = players.map((p, i) => ({
      id: i,
      name: p.name || `Player ${i + 1}`,
      team: p.team ?? i,
      color: p.color ?? i,
      colorHex: PLAYER_COLORS[(p.color ?? i) % PLAYER_COLORS.length].hex,
      type: p.type || 'human',
      difficulty: p.difficulty || 'normal',
      crystals: opts.startCrystals ?? START_CRYSTALS,
      flux: opts.startFlux ?? START_FLUX,
      supplyUsed: 0,
      supplyCap: 0,
      upgrades: { weapons: 0, armor: 0, barrier: 0, phaseTransit: 0, lunge: 0 },
      researching: {},
      eliminated: false,
      surrendered: false,
      startBase: -1,
      lastAttackAlert: -9999,
      stats: {
        unitsMade: 0,
        unitsLost: 0,
        kills: 0,
        structuresBuilt: 0,
        structuresLost: 0,
        structuresKilled: 0,
        crystalsMined: 0,
        fluxMined: 0,
        spent: 0,
        damageDealt: 0,
        timeline: [],
      },
    }));
    this.teamIds = [...new Set(this.players.map((p) => p.team))];
    const N = this.map.width * this.map.height;
    this.vision = {};
    this.explored = {};
    for (const t of this.teamIds) {
      this.vision[t] = new Uint8Array(N);
      this.explored[t] = new Uint8Array(N);
    }
    this.setup(opts);
  }

  // ---------------------------------------------------------------- setup

  setup(opts) {
    const map = this.map;
    for (const r of map.resources) {
      this.createResource(r);
    }
    for (const b of map.beacons) {
      const e = this.addEntity({
        kind: 'neutral',
        type: 'beacon',
        def: { ...NEUTRALS.beacon, priority: 0 },
        owner: -1,
        bx: b.x,
        by: b.y,
        w: 2,
        h: 2,
        x: b.x + 1,
        y: b.y + 1,
        r: 1,
        holders: [],
      });
      this.grid.setRect(b.x, b.y, 2, 2, e.id);
      this.neutrals.push(e);
    }
    for (const rb of map.rubble) {
      const e = this.addEntity({
        kind: 'neutral',
        type: 'rubble',
        def: { ...NEUTRALS.rubble, priority: 1 },
        owner: -1,
        bx: rb.x,
        by: rb.y,
        w: 4,
        h: 4,
        x: rb.x + 2,
        y: rb.y + 2,
        r: 2,
        hp: NEUTRALS.rubble.hp,
        maxHp: NEUTRALS.rubble.hp,
        barrier: 0,
        maxBarrier: 0,
        armor: NEUTRALS.rubble.armor,
      });
      this.grid.setRect(rb.x, rb.y, 4, 4, e.id);
      this.neutrals.push(e);
    }

    // start locations
    let starts = map.starts.slice();
    const n = this.players.length;
    if (opts.randomStarts) {
      for (let i = starts.length - 1; i > 0; i--) {
        const j = this.rng.int(i + 1);
        [starts[i], starts[j]] = [starts[j], starts[i]];
      }
    } else if (starts.length === 4 && n === 2) {
      starts = [starts[0], starts[2], starts[1], starts[3]]; // cross positions
    }
    this.players.forEach((p, i) => {
      const baseId = starts[i % starts.length];
      const base = map.bases[baseId];
      p.startBase = baseId;
      const c = this.createBuilding('citadel', p.id, base.tx, base.ty, true);
      // workers between citadel and crystal line
      const workers = opts.startWorkers ?? START_WORKERS;
      for (let k = 0; k < workers; k++) {
        const a = base.dir + ((k % 6) - 2.5) * 0.35;
        const rr = 3.4 + Math.floor(k / 6) * 0.8;
        const u = this.createUnit('shaper', p.id, base.x + Math.cos(a) * rr, base.y + Math.sin(a) * rr, {
          facing: base.dir,
        });
        const field = this.nearestCrystalTo(u.x, u.y, 12, k);
        if (field) {
          u.orders.push({ type: 'gather', target: field.id });
          u.lastGather = field.id;
        }
      }
      c.rally = this.defaultRally(c);
      if (p.type === 'ai') this.ais.push(new AIController(this, p.id));
    });
    this.recomputeSupplyAll();
    updateVision(this);
  }

  defaultRally(b) {
    const f = this.nearestCrystalTo(b.x, b.y, 12);
    return f ? { x: f.x, y: f.y, target: f.id } : null;
  }

  // nth nearest crystal (to spread starting workers across fields)
  nearestCrystalTo(x, y, r, spread = 0) {
    const list = this.resources
      .filter((res) => !res.dead && res.type === 'crystal' && Math.hypot(res.x - x, res.y - y) < r)
      .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
    if (!list.length) return null;
    return list[spread % list.length];
  }

  // ---------------------------------------------------------------- entities

  addEntity(e) {
    e.id = this.nextId++;
    e.dead = false;
    e.lastDamageTick = -99999;
    this.entities.push(e);
    this.byId.set(e.id, e);
    return e;
  }

  createResource(r) {
    const type = r.kind;
    const e = this.addEntity({
      kind: 'resource',
      type,
      def: NEUTRALS[type],
      owner: -1,
      bx: r.x,
      by: r.y,
      w: r.w,
      h: r.h,
      x: r.x + r.w / 2,
      y: r.y + r.h / 2,
      r: Math.max(r.w, r.h) / 2,
      amount: r.amount,
      maxAmount: r.amount,
      rich: !!r.rich,
      base: r.base,
      miner: 0,
      siphon: 0,
    });
    this.grid.setRect(r.x, r.y, r.w, r.h, e.id);
    this.resources.push(e);
    return e;
  }

  createUnit(type, owner, x, y, opts = {}) {
    const def = UNITS[type];
    const u = this.addEntity({
      kind: 'unit',
      type,
      def,
      owner,
      x,
      y,
      px: x,
      py: y,
      r: def.radius,
      facing: opts.facing ?? Math.PI / 2,
      pfacing: opts.facing ?? Math.PI / 2,
      targetFacing: opts.facing ?? Math.PI / 2,
      hp: def.hp,
      maxHp: def.hp,
      barrier: def.barrier,
      maxBarrier: def.barrier,
      armor: def.armor,
      orders: [],
      cooldown: 0,
      lungeCd: 0,
      lunging: 0,
      lungeHit: false,
      swing: null,
      carry: null,
      target: null,
      autocast: { lunge: true },
      warping: opts.warping || 0,
      warpTotal: opts.warping || 0,
      hidden: false,
      ghost: false,
      moving: false,
      created: this.tick,
      attackAnim: -100,
      lastGather: 0,
    });
    if (!opts.supplyCounted) this.players[owner].supplyUsed += def.supply;
    this.units.push(u);
    this.emit({ e: 'spawn', id: u.id, type, owner });
    return u;
  }

  createBuilding(type, owner, bx, by, built) {
    const def = BUILDINGS[type];
    const s = def.size;
    const b = this.addEntity({
      kind: 'building',
      type,
      def,
      owner,
      bx,
      by,
      w: s,
      h: s,
      x: bx + s / 2,
      y: by + s / 2,
      r: s / 2,
      hp: built ? def.hp : def.hp * 0.1,
      maxHp: def.hp,
      barrier: built ? def.barrier : def.barrier * 0.1,
      maxBarrier: def.barrier,
      armor: def.armor,
      built: false,
      progress: built ? 1 : 0,
      queue: [],
      rally: null,
      energy: def.energy ? def.energy.start : 0,
      maxEnergy: def.energy ? def.energy.max : 0,
      overclock: 0,
      powered: true,
      phase: false,
      warpCd: 0,
      transform: 0,
      beam: 0,
      vent: null,
      occupant: 0,
      created: this.tick,
    });
    this.grid.setRect(bx, by, s, s, b.id);
    this.buildings.push(b);
    if (built) this.completeBuilding(b, true);
    return b;
  }

  completeBuilding(b, silent = false) {
    b.built = true;
    b.progress = 1;
    const p = this.players[b.owner];
    p.stats.structuresBuilt++;
    this.recomputeSupply(p);
    if (b.type === 'citadel' && !b.rally) b.rally = this.defaultRally(b);
    if (b.type === 'portal' && p.upgrades.phaseTransit) b.transform = 0;
    if (!silent) this.emit({ e: 'buildDone', id: b.id, owner: b.owner, type: b.type, x: b.x, y: b.y });
  }

  recomputeSupply(p) {
    let cap = 0;
    for (const b of this.buildings) {
      if (b.owner === p.id && b.built && !b.dead && b.def.supply) cap += b.def.supply;
    }
    p.supplyCap = Math.min(MAX_SUPPLY, cap);
  }

  recomputeSupplyAll() {
    for (const p of this.players) this.recomputeSupply(p);
  }

  kill(e, attacker, silent = false) {
    if (e.dead) return;
    e.dead = true;
    if (e.hp !== undefined) e.hp = 0;
    this.dead.push(e);
    if (e.kind === 'unit') {
      clearOrders(this, e);
      const p = this.players[e.owner];
      p.supplyUsed -= e.def.supply;
      if (!silent) p.stats.unitsLost++;
      if (attacker && attacker.owner >= 0 && attacker.owner !== e.owner) this.players[attacker.owner].stats.kills++;
      if (e.mining) {
        const r = this.byId.get(e.mining);
        if (r && r.miner === e.id) r.miner = 0;
      }
    } else if (e.kind === 'building') {
      this.grid.clearRect(e.bx, e.by, e.w, e.h, e.id);
      const p = this.players[e.owner];
      for (const item of e.queue) {
        if (item.kind === 'unit' && item.started) p.supplyUsed -= UNITS[item.id].supply;
        if (item.kind === 'research') delete p.researching[item.id];
      }
      e.queue.length = 0;
      if (e.vent) e.vent.siphon = 0;
      if (e.occupant) {
        const w = this.byId.get(e.occupant);
        if (w) w.hidden = false;
      }
      this.recomputeSupply(p);
      if (!silent) p.stats.structuresLost++;
      if (attacker && attacker.owner >= 0 && attacker.owner !== e.owner) this.players[attacker.owner].stats.structuresKilled++;
    } else if (e.kind === 'resource') {
      this.grid.clearRect(e.bx, e.by, e.w, e.h, e.id);
    } else if (e.kind === 'neutral') {
      this.grid.clearRect(e.bx, e.by, e.w, e.h, e.id);
    }
    this.emit({ e: 'death', id: e.id, type: e.type, kind: e.kind, owner: e.owner, x: e.x, y: e.y, silent: silent ? 1 : 0 });
  }

  removeDead() {
    if (!this.dead.length) return;
    const isDead = (e) => e.dead;
    for (const e of this.dead) this.byId.delete(e.id);
    this.entities = this.entities.filter((e) => !isDead(e));
    this.units = this.units.filter((e) => !isDead(e));
    this.buildings = this.buildings.filter((e) => !isDead(e));
    this.resources = this.resources.filter((e) => !isDead(e));
    this.neutrals = this.neutrals.filter((e) => !isDead(e));
    this.dead.length = 0;
  }

  spawnFromBuilding(b, type) {
    const def = UNITS[type];
    const p = this.players[b.owner];
    const rally = b.rally;
    const tx = rally ? rally.x : b.x;
    const ty = rally ? rally.y + (rally.target ? 0 : 0) : b.y + b.h;
    // candidate cells just outside the footprint
    let best = null;
    let bestD = Infinity;
    for (let y = b.by - 1; y <= b.by + b.h; y++) {
      for (let x = b.bx - 1; x <= b.bx + b.w; x++) {
        const border = x === b.bx - 1 || x === b.bx + b.w || y === b.by - 1 || y === b.by + b.h;
        if (!border || !this.grid.pathable(x, y)) continue;
        const d = Math.hypot(x + 0.5 - tx, y + 0.5 - ty) + (rally ? 0 : y < b.by ? 2 : 0);
        if (d < bestD) {
          bestD = d;
          best = [x + 0.5, y + 0.5];
        }
      }
    }
    if (!best) {
      const nf = this.grid.nearestFree(b.x, b.y + b.h, 10) || [Math.floor(b.x), Math.floor(b.y + b.h)];
      best = [nf[0] + 0.5, nf[1] + 0.5];
    }
    const u = this.createUnit(type, b.owner, best[0], best[1], {
      supplyCounted: true,
      facing: Math.atan2(ty - best[1], tx - best[0]),
    });
    p.stats.unitsMade++;
    if (rally) {
      const t = rally.target ? this.byId.get(rally.target) : null;
      if (t && !t.dead && def.role === 'worker' && (t.type === 'crystal' || (t.type === 'siphon' && t.owner === b.owner))) {
        u.orders.push({ type: 'gather', target: t.id });
        u.lastGather = t.id;
      } else if (Math.hypot(rally.x - u.x, rally.y - u.y) > 1) {
        u.orders.push({ type: def.role === 'worker' ? 'move' : 'attackMove', x: rally.x, y: rally.y });
      }
    }
    this.emit({ e: 'trained', id: u.id, owner: b.owner, type, from: b.id });
    return u;
  }

  // ---------------------------------------------------------------- queries

  areEnemies(a, b) {
    if (a < 0 || b < 0 || a === b) return false;
    return this.players[a].team !== this.players[b].team;
  }

  isAllied(a, b) {
    if (a < 0 || b < 0) return false;
    return this.players[a].team === this.players[b].team;
  }

  isVisibleTo(e, playerId) {
    if (playerId < 0) return true;
    if (e.owner !== undefined && e.owner >= 0 && this.isAllied(e.owner, playerId)) return true;
    const vis = this.vision[this.players[playerId].team];
    const W = this.map.width;
    if (e.kind === 'building' || e.kind === 'resource' || e.kind === 'neutral') {
      // any footprint corner visible
      const pts = [
        [e.bx, e.by],
        [e.bx + e.w - 1, e.by],
        [e.bx, e.by + e.h - 1],
        [e.bx + e.w - 1, e.by + e.h - 1],
        [Math.floor(e.x), Math.floor(e.y)],
      ];
      for (const [x, y] of pts) if (vis[y * W + x]) return true;
      return false;
    }
    const cx = Math.floor(e.x);
    const cy = Math.floor(e.y);
    if (cx < 0 || cy < 0 || cx >= W || cy >= this.map.height) return false;
    return vis[cy * W + cx] === 1;
  }

  isExplored(playerId, x, y) {
    const ex = this.explored[this.players[playerId].team];
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= this.map.width || cy >= this.map.height) return false;
    return ex[cy * this.map.width + cx] === 1;
  }

  hasCompleted(owner, type) {
    for (const b of this.buildings) if (b.owner === owner && b.type === type && b.built && !b.dead) return true;
    return false;
  }

  count(owner, type, includeInProgress = true) {
    let n = 0;
    for (const e of this.entities) {
      if (e.dead || e.owner !== owner || e.type !== type) continue;
      if (e.kind === 'building' && !includeInProgress && !e.built) continue;
      n++;
    }
    return n;
  }

  powerSourceAt(owner, x, y) {
    for (const b of this.buildings) {
      if (b.type !== 'conduit' || b.owner !== owner || !b.built || b.dead) continue;
      if (Math.hypot(b.x - x, b.y - y) <= POWER_RADIUS) return b;
    }
    return null;
  }

  isPoweredAt(owner, x, y) {
    return !!this.powerSourceAt(owner, x, y);
  }

  isFastWarp(owner, conduit) {
    for (const b of this.buildings) {
      if (b.owner !== owner || !b.built || b.dead) continue;
      if ((b.type === 'citadel' || (b.type === 'portal' && b.phase)) && Math.hypot(b.x - conduit.x, b.y - conduit.y) <= 7.5) {
        return true;
      }
    }
    return false;
  }

  findDropoff(owner, x, y) {
    let best = null;
    let bestD = Infinity;
    for (const b of this.buildings) {
      if (b.owner !== owner || !b.built || b.dead || !b.def.dropoff) continue;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  findNearbyCrystal(x, y, r) {
    let best = null;
    let bestD = r;
    for (const res of this.resources) {
      if (res.dead || res.type !== 'crystal') continue;
      const d = Math.hypot(res.x - x, res.y - y);
      if (d < bestD) {
        bestD = d;
        best = res;
      }
    }
    return best;
  }

  findFreeCrystal(res, u, r) {
    let best = null;
    let bestD = Infinity;
    for (const f of this.resources) {
      if (f === res || f.dead || f.type !== 'crystal' || f.miner) continue;
      if (Math.hypot(f.x - res.x, f.y - res.y) > r) continue;
      const d = Math.hypot(f.x - u.x, f.y - u.y);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }

  deposit(u) {
    if (!u.carry || u.carry.amount <= 0) return;
    const p = this.players[u.owner];
    if (u.carry.kind === 'crystals') {
      p.crystals += u.carry.amount;
      p.stats.crystalsMined += u.carry.amount;
    } else {
      p.flux += u.carry.amount;
      p.stats.fluxMined += u.carry.amount;
    }
    this.emit({ e: 'deposit', id: u.id, k: u.carry.kind, n: u.carry.amount });
    const o = u.orders[0];
    if (o && o.type === 'gather') u.lastGather = o.target;
    u.carry = null;
  }

  // ---------------------------------------------------------------- events & alerts

  emit(ev) {
    ev.tick = this.tick;
    this.events.push(ev);
  }

  drainEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  error(owner, msg, x, y) {
    const key = `${owner}|${msg}`;
    const last = this.errorThrottle.get(key) || -999;
    if (this.tick - last < 10) return;
    this.errorThrottle.set(key, this.tick);
    this.emit({ e: 'error', owner, msg, x, y });
  }

  underAttack(target, attacker) {
    const p = this.players[target.owner];
    if (this.tick - p.lastAttackAlert < TICK_RATE * 12) return;
    p.lastAttackAlert = this.tick;
    let what = 'Your forces are under attack';
    if (target.kind === 'building') what = 'Your base is under attack';
    else if (target.def.role === 'worker') what = 'Your workers are under attack';
    this.emit({ e: 'alert', owner: target.owner, msg: what, x: target.x, y: target.y, attacker: attacker.owner });
  }

  // ---------------------------------------------------------------- commands

  issue(playerId, cmd) {
    this.pending.push({ playerId, cmd });
  }

  applyCommand(pid, c) {
    const p = this.players[pid];
    if (!p || p.eliminated || !c || typeof c.type !== 'string') return;
    const ids = Array.isArray(c.ids) ? c.ids.slice(0, 500) : [];
    const ents = ids.map((id) => this.byId.get(id)).filter((e) => e && !e.dead && e.owner === pid);
    const units = ents.filter((e) => e.kind === 'unit' && !(e.warping > 0));
    const builds = ents.filter((e) => e.kind === 'building');
    const queue = !!c.queue;
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const x = Math.min(Math.max(num(c.x), 0), this.map.width);
    const y = Math.min(Math.max(num(c.y), 0), this.map.height);
    const give = (u, order) => {
      if (!queue) {
        clearOrders(this, u);
        u.swing = null;
        u.target = null;
      }
      if (order) u.orders.push(order);
      u.guard = null;
      u.arrivedGroup = 0;
    };
    switch (c.type) {
      case 'move':
      case 'attackMove':
      case 'patrol': {
        const group = groupSerial++;
        for (const u of units) {
          const o = { type: c.type, x, y, group, groupSize: units.length };
          if (c.type === 'patrol') {
            o.x0 = u.x;
            o.y0 = u.y;
          }
          give(u, o);
        }
        break;
      }
      case 'attack': {
        const t = this.byId.get(c.target);
        if (!t || t.dead) break;
        for (const u of units) {
          if (t.owner === pid || (t.owner >= 0 && !this.areEnemies(pid, t.owner))) give(u, { type: 'follow', target: t.id });
          else give(u, { type: 'attack', target: t.id });
        }
        break;
      }
      case 'follow': {
        const t = this.byId.get(c.target);
        if (!t || t.dead) break;
        for (const u of units) if (u !== t) give(u, { type: 'follow', target: t.id });
        break;
      }
      case 'stop':
        for (const u of units) give(u, null);
        break;
      case 'hold':
        for (const u of units) give(u, { type: 'hold' });
        break;
      case 'gather': {
        let t = this.byId.get(c.target);
        if (!t || t.dead) break;
        if (t.type === 'vent' && t.siphon) t = this.byId.get(t.siphon) || t;
        const ok = t.type === 'crystal' || (t.type === 'siphon' && t.owner === pid);
        for (const u of units) {
          if (u.def.role === 'worker' && ok) {
            give(u, { type: 'gather', target: t.id });
            u.lastGather = t.id;
          } else give(u, { type: 'move', x: t.x, y: t.y });
        }
        break;
      }
      case 'returnCargo':
        for (const u of units) {
          if (u.def.role === 'worker' && u.carry) give(u, { type: 'returnCargo' });
        }
        break;
      case 'build': {
        const type = c.building;
        const def = BUILDINGS[type];
        const worker = units.find((u) => u.def.role === 'worker');
        if (!def || !worker) break;
        const bx = Math.floor(num(c.bx));
        const by = Math.floor(num(c.by));
        const check = canPlace(this, pid, type, bx, by, worker);
        if (!check.ok && check.reason !== 'Something is in the way') {
          this.error(pid, check.reason, bx, by);
          break;
        }
        if (p.crystals < def.cost.crystals) {
          this.error(pid, 'Not enough crystals', bx, by);
          break;
        }
        if (p.flux < def.cost.flux) {
          this.error(pid, 'Not enough flux', bx, by);
          break;
        }
        give(worker, { type: 'build', building: type, bx, by });
        break;
      }
      case 'train': {
        const type = c.unit;
        if (!UNITS[type]) break;
        const cands = builds.filter((b) => b.built && b.def.trains.includes(type) && !b.phase);
        if (!cands.length) break;
        const count = Math.min(5, Math.max(1, Math.floor(num(c.count)) || 1));
        for (let k = 0; k < count; k++) {
          cands.sort((a, b) => a.queue.length - b.queue.length);
          if (!queueTrain(this, cands[0], type)) break;
        }
        break;
      }
      case 'research': {
        const r = RESEARCH[c.research];
        if (!r) break;
        const cands = builds.filter((b) => b.built && b.type === r.at).sort((a, b) => a.queue.length - b.queue.length);
        if (cands.length) queueResearch(this, cands[0], c.research);
        break;
      }
      case 'cancel': {
        const b = this.byId.get(c.building) || builds[0];
        if (b && b.owner === pid && b.kind === 'building') {
          if (!b.built) cancelConstruction(this, b);
          else cancelQueue(this, b, typeof c.index === 'number' ? c.index : -1);
        }
        break;
      }
      case 'rally': {
        const t = c.target ? this.byId.get(c.target) : null;
        for (const b of builds) {
          b.rally = t && !t.dead ? { x: t.x, y: t.y, target: t.id } : { x, y, target: 0 };
        }
        break;
      }
      case 'overclock':
        overclock(this, pid, c.target, c.source);
        break;
      case 'warp':
        warpIn(this, pid, x, y, c.portal);
        break;
      case 'autocast':
        for (const u of units) if (u.autocast) u.autocast[c.ability || 'lunge'] = !!c.value;
        break;
      case 'surrender':
        p.surrendered = true;
        this.eliminate(p);
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- simulation step

  step() {
    if (this.over) return;
    this.tick++;
    this.pathBudget = 90;
    for (const ai of this.ais) ai.update();
    if (this.pending.length) {
      const cmds = this.pending;
      this.pending = [];
      for (const { playerId, cmd } of cmds) {
        try {
          this.applyCommand(playerId, cmd);
        } catch (err) {
          // malformed command: ignore but never crash the simulation
          if (typeof console !== 'undefined') console.warn('Bad command', cmd, err);
        }
      }
    }
    this.hash.clear();
    const units = this.units;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (!u.dead && !u.hidden) this.hash.insert(u);
    }
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      u.px = u.x;
      u.py = u.y;
      u.pfacing = u.facing;
      if (!u.dead) updateUnit(this, u);
    }
    resolveCollisions(this);
    const bl = this.buildings;
    for (let i = 0; i < bl.length; i++) if (!bl[i].dead) updateBuilding(this, bl[i]);

    // barrier regeneration
    const delayTicks = BARRIER_REGEN_DELAY * TICK_RATE;
    const regen = BARRIER_REGEN_RATE * DT;
    for (const list of [units, bl]) {
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.dead || e.barrier >= e.maxBarrier) continue;
        if (e.kind === 'building' && !e.built) continue;
        if (this.tick - e.lastDamageTick > delayTicks) e.barrier = Math.min(e.maxBarrier, e.barrier + regen);
      }
    }

    this.removeDead();
    if (this.tick % 10 === 0) this.updateBeacons();
    if (this.tick % FOG_UPDATE_TICKS === 0) updateVision(this);
    if (this.tick % 20 === 0) this.checkVictory();
    if (this.tick % (TICK_RATE * 10) === 0) this.sampleStats();
  }

  updateBeacons() {
    for (const n of this.neutrals) {
      if (n.type !== 'beacon') continue;
      const holders = new Set();
      const near = this.hash.query(n.x, n.y, BEACON_CAPTURE_RANGE + 2, this._q);
      for (const u of near) {
        if (u.dead || u.hidden || u.owner < 0) continue;
        const d = Math.max(Math.abs(u.x - n.x), Math.abs(u.y - n.y)) - 1;
        if (d <= BEACON_CAPTURE_RANGE) holders.add(this.players[u.owner].team);
      }
      n.holders = [...holders];
    }
  }

  eliminate(p) {
    if (p.eliminated) return;
    p.eliminated = true;
    for (const e of this.entities) {
      if (e.owner === p.id && !e.dead && (e.kind === 'unit' || e.kind === 'building')) this.kill(e, null, true);
    }
    this.emit({ e: 'eliminated', owner: p.id });
    this.checkVictory();
  }

  checkVictory() {
    if (this.over) return;
    for (const p of this.players) {
      if (p.eliminated) continue;
      let hasBuilding = false;
      for (const b of this.buildings) {
        if (b.owner === p.id && !b.dead) {
          hasBuilding = true;
          break;
        }
      }
      if (!hasBuilding) this.eliminate(p);
      if (this.over) return;
    }
    const aliveTeams = new Set(this.players.filter((p) => !p.eliminated).map((p) => p.team));
    if (aliveTeams.size <= 1) {
      this.over = true;
      this.winnerTeam = aliveTeams.size === 1 ? [...aliveTeams][0] : -1;
      this.sampleStats();
      this.emit({ e: 'gameOver', winnerTeam: this.winnerTeam });
    }
  }

  sampleStats() {
    for (const p of this.players) {
      let army = 0;
      let workers = 0;
      for (const u of this.units) {
        if (u.owner !== p.id || u.dead) continue;
        if (u.def.role === 'worker') workers++;
        else army += u.def.cost.crystals + u.def.cost.flux;
      }
      p.stats.timeline.push({
        t: Math.round(this.tick / TICK_RATE),
        army,
        workers,
        collected: p.stats.crystalsMined + p.stats.fluxMined,
        supply: p.supplyUsed,
      });
    }
  }

  // ---------------------------------------------------------------- helpers used by UI / AI / tests

  canPlace(owner, type, bx, by) {
    return canPlace(this, owner, type, bx, by);
  }

  placeBuilding(owner, type, bx, by, builder) {
    return placeBuilding(this, owner, type, bx, by, builder);
  }

  researchStatus(owner, id) {
    return researchStatus(this, owner, id);
  }

  get time() {
    return this.tick / TICK_RATE;
  }

  // Run n ticks (tests / fast-forward)
  run(n) {
    for (let i = 0; i < n && !this.over; i++) {
      this.step();
      this.events.length = 0;
    }
  }
}
