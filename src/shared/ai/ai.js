// Computer opponent. Plays fair: it only reacts to what its team can see,
// and issues the same commands a human would through world.issue().
import { TICK_RATE } from '../constants.js';
import { UNITS, BUILDINGS } from '../data/defs.js';
import { rectDist } from '../sim/geom.js';

export const AI_PROFILES = {
  easy: {
    think: 40,
    maxWorkers: 16,
    workersPerBase: 14,
    maxPortals: 1,
    attackSupply: 12,
    firstAttack: 480,
    expandAt: 9999,
    maxBases: 1,
    upgrades: 0,
    lunge: false,
    phase: false,
    aegis: 0,
    workerPull: false,
    scout: false,
    trainQueue: 1,
    overclock: false,
  },
  normal: {
    think: 16,
    maxWorkers: 40,
    workersPerBase: 19,
    maxPortals: 5,
    attackSupply: 26,
    firstAttack: 330,
    expandAt: 230,
    maxBases: 3,
    upgrades: 1,
    lunge: true,
    phase: true,
    aegis: 0,
    workerPull: false,
    scout: true,
    trainQueue: 1,
    overclock: true,
  },
  hard: {
    think: 8,
    maxWorkers: 54,
    workersPerBase: 21,
    maxPortals: 8,
    attackSupply: 32,
    firstAttack: 300,
    expandAt: 170,
    maxBases: 4,
    upgrades: 2,
    lunge: true,
    phase: true,
    aegis: 1,
    workerPull: true,
    scout: true,
    trainQueue: 2,
    overclock: true,
  },
  brutal: {
    think: 4,
    maxWorkers: 66,
    workersPerBase: 22,
    maxPortals: 12,
    attackSupply: 36,
    firstAttack: 270,
    expandAt: 130,
    maxBases: 5,
    upgrades: 3,
    lunge: true,
    phase: true,
    aegis: 2,
    workerPull: true,
    scout: true,
    trainQueue: 2,
    overclock: true,
  },
};

export class AIController {
  constructor(world, playerId) {
    this.world = world;
    this.pid = playerId;
    this.player = world.players[playerId];
    this.profile = AI_PROFILES[this.player.difficulty] || AI_PROFILES.normal;
    this.offset = (playerId * 7) % this.profile.think;
    this.state = 'build';
    this.attackTarget = null;
    this.attackStartSupply = 0;
    this.attacksLaunched = 0;
    this.known = new Map(); // enemy structure id -> {x,y,type}
    this.pulled = new Set();
    this.scoutId = 0;
    this.scouted = false;
    this.lastBuildTick = -999;
    this.enemyStarts = [];
  }

  issue(cmd) {
    this.world.issue(this.pid, cmd);
  }

  get time() {
    return this.world.tick / TICK_RATE;
  }

  update() {
    const w = this.world;
    if (this.player.eliminated || w.over) return;
    if ((w.tick + this.offset) % this.profile.think !== 0) return;
    if (!this.enemyStarts.length) {
      this.enemyStarts = w.players
        .filter((p) => w.areEnemies(p.id, this.pid))
        .map((p) => w.map.bases[p.startBase])
        .filter(Boolean);
    }
    this.gatherState();
    this.rememberEnemies();
    this.manageStructures();
    this.manageSupply();
    this.manageWorkers();
    this.manageProduction();
    this.manageResearch();
    this.manageArmy();
    this.manageScout();
  }

  gatherState() {
    const w = this.world;
    const pid = this.pid;
    this.workers = [];
    this.army = [];
    this.byType = {};
    for (const u of w.units) {
      if (u.dead || u.owner !== pid) continue;
      if (u.def.role === 'worker') this.workers.push(u);
      else if (!(u.warping > 0)) this.army.push(u);
    }
    for (const b of w.buildings) {
      if (b.dead || b.owner !== pid) continue;
      (this.byType[b.type] ||= []).push(b);
    }
    this.citadels = (this.byType.citadel || []).filter((b) => b.built);
    this.armySupply = this.army.reduce((s, u) => s + u.def.supply, 0);
    // crystals/flux promised to structures a worker is walking to place
    this.pendingCrystals = 0;
    this.pendingFlux = 0;
    for (const u of this.workers) {
      for (const o of u.orders) {
        if (o.type !== 'build') continue;
        this.pendingCrystals += BUILDINGS[o.building].cost.crystals;
        this.pendingFlux += BUILDINGS[o.building].cost.flux;
      }
    }
  }

  // resources not yet promised to anything
  get crystals() {
    return this.player.crystals - this.pendingCrystals;
  }

  get flux() {
    return this.player.flux - this.pendingFlux;
  }

  countType(type, includeQueued = true) {
    let n = (this.byType[type] || []).length;
    if (includeQueued) {
      for (const u of this.workers) {
        for (const o of u.orders) if (o.type === 'build' && o.building === type) n++;
      }
    }
    return n;
  }

  builtCount(type) {
    return (this.byType[type] || []).filter((b) => b.built).length;
  }

  rememberEnemies() {
    const w = this.world;
    for (const b of w.buildings) {
      if (b.dead || !w.areEnemies(this.pid, b.owner)) continue;
      if (w.isVisibleTo(b, this.pid)) this.known.set(b.id, { x: b.x, y: b.y, type: b.type });
    }
    for (const [id, k] of this.known) {
      const e = w.byId.get(id);
      if (!e || e.dead) this.known.delete(id);
      else if (w.isVisibleTo({ kind: 'point', x: k.x, y: k.y }, this.pid) && !w.isVisibleTo(e, this.pid)) {
        this.known.delete(id);
      }
    }
  }

  // ------------------------------------------------------------- economy

  baseOfResource(res) {
    let best = null;
    let bd = Infinity;
    for (const c of this.citadels) {
      const d = Math.hypot(c.x - res.x, c.y - res.y);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return bd < 14 ? best : null;
  }

  manageWorkers() {
    const w = this.world;
    const p = this.player;
    // saturation per citadel
    const sat = new Map();
    const gasSat = new Map();
    for (const c of this.citadels) sat.set(c.id, 0);
    for (const u of this.workers) {
      const o = u.orders[0];
      if (o && o.type === 'gather') {
        const t = w.byId.get(o.target);
        if (!t) continue;
        if (t.type === 'siphon') gasSat.set(t.id, (gasSat.get(t.id) || 0) + 1);
        else {
          const c = this.baseOfResource(t);
          if (c) sat.set(c.id, (sat.get(c.id) || 0) + 1);
        }
      }
    }
    const fieldsAt = (c) => w.resources.filter((r) => r.type === 'crystal' && !r.dead && Math.hypot(r.x - c.x, r.y - c.y) < 12);
    // idle workers -> least saturated base
    for (const u of this.workers) {
      if (u.orders.length || this.pulled.has(u.id) || u.id === this.scoutId) continue;
      let best = null;
      let bestRatio = Infinity;
      for (const c of this.citadels) {
        const fields = fieldsAt(c);
        if (!fields.length) continue;
        const ratio = (sat.get(c.id) || 0) / (fields.length * 2);
        const dist = Math.hypot(c.x - u.x, c.y - u.y) / 200;
        if (ratio + dist < bestRatio) {
          bestRatio = ratio + dist;
          best = { c, fields };
        }
      }
      if (best) {
        const f = best.fields[(u.id * 7) % best.fields.length];
        this.issue({ type: 'gather', ids: [u.id], target: f.id });
        sat.set(best.c.id, (sat.get(best.c.id) || 0) + 1);
      }
    }
    // flux saturation
    for (const s of this.byType.siphon || []) {
      if (!s.built || (s.vent && s.vent.amount <= 0)) continue;
      const have = gasSat.get(s.id) || 0;
      if (have < 3) {
        const cand = this.workers.find((u) => {
          const o = u.orders[0];
          if (!o || o.type !== 'gather' || u.carry) return false;
          const t = w.byId.get(o.target);
          return t && t.type === 'crystal' && Math.hypot(t.x - s.x, t.y - s.y) < 14;
        });
        if (cand) {
          this.issue({ type: 'gather', ids: [cand.id], target: s.id });
          gasSat.set(s.id, have + 1);
        }
      }
    }
    // train workers
    const fields = this.citadels.reduce((s, c) => s + fieldsAt(c).length, 0);
    const siphons = (this.byType.siphon || []).filter((s) => s.built).length;
    const target = Math.min(this.profile.maxWorkers, fields * 2 + siphons * 3 + 2, this.citadels.length * this.profile.workersPerBase + 4);
    let queued = 0;
    for (const c of this.citadels) queued += c.queue.filter((q) => q.id === 'shaper').length;
    if (this.workers.length + queued < target) {
      for (const c of this.citadels) {
        if (c.queue.length < this.profile.trainQueue && this.crystals - this.reserveFor().crystals * 0.5 >= 50 && p.supplyUsed < p.supplyCap) {
          this.issue({ type: 'train', ids: [c.id], unit: 'shaper' });
        }
      }
    }
    // overclock: workers early, army later
    if (this.profile.overclock) {
      for (const c of this.citadels) {
        if (c.energy < 50) continue;
        let tgt = null;
        if (this.workers.length < target && c.queue.length) tgt = c;
        else {
          tgt =
            (this.byType.foundry || []).find((b) => b.built && b.queue.length && !b.overclock) ||
            (this.byType.sanctum || []).find((b) => b.built && b.queue.length && !b.overclock) ||
            (this.byType.portal || []).find((b) => b.built && (b.queue.length || b.warpCd > 5) && !b.overclock);
        }
        if (tgt && !tgt.overclock) this.issue({ type: 'overclock', target: tgt.id, source: c.id });
      }
    }
  }

  manageSupply() {
    const p = this.player;
    if (p.supplyCap >= 200) return;
    const pendingConduits =
      (this.byType.conduit || []).filter((b) => !b.built).length +
      this.workers.reduce((n, u) => n + u.orders.filter((o) => o.type === 'build' && o.building === 'conduit').length, 0);
    const portals = (this.byType.portal || []).filter((b) => b.built).length;
    const buffer = 3 + this.citadels.length * 2 + portals * 2;
    const left = p.supplyCap + pendingConduits * 8 - p.supplyUsed;
    const firstAt = this.profile === AI_PROFILES.easy ? 15 : 13;
    const urgent = left <= 2 && pendingConduits === 0;
    if ((p.supplyUsed >= firstAt && left < buffer && pendingConduits < 1 + Math.floor(portals / 4) && !this.saving) || urgent) {
      if (this.crystals >= 100) this.buildNear('conduit', this.conduitSpotHint());
    }
  }

  conduitSpotHint() {
    const main = this.world.map.bases[this.player.startBase];
    const citadels = this.citadels.length ? this.citadels : [{ x: main.x, y: main.y }];
    const c = citadels[(this.countType('conduit') * 3 + 1) % citadels.length];
    const base = this.world.map.bases.find((b) => Math.hypot(b.x - c.x, b.y - c.y) < 2) || main;
    // away from the crystal line
    const a = base.dir + Math.PI + ((this.countType('conduit') % 5) - 2) * 0.55;
    const r = 7 + (this.countType('conduit') % 3) * 2.5;
    return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
  }

  // ------------------------------------------------------------- structures

  manageStructures() {
    const w = this.world;
    const p = this.player;
    const prof = this.profile;
    const t = this.time;
    if (w.tick - this.lastBuildTick < TICK_RATE * 1.5) return;
    const conduits = this.builtCount('conduit');
    if (!conduits) return;
    const portals = this.countType('portal');
    const bases = this.citadels.length + (this.byType.citadel || []).filter((b) => !b.built).length;
    const want = [];
    // first portal
    if (portals < 1) want.push('portal');
    // flux
    const extraFlux = prof.upgrades >= 3 && this.citadels.length > 1 ? 1 : 0;
    const siphonsWanted = Math.min(this.citadels.length * 2, t > 70 ? 1 + (t > 200 && prof.upgrades >= 1 ? 1 : 0) + extraFlux : 0);
    if (this.countType('siphon') < siphonsWanted && prof.phase) want.push('siphon');
    if (!prof.phase && this.countType('siphon') < (t > 200 ? 1 : 0)) want.push('siphon');
    // expansion
    if (t > prof.expandAt && bases < prof.maxBases && (t - prof.expandAt) / 120 >= bases - 1) want.push('citadel');
    // tech, production and support structures
    const portalTarget = Math.min(prof.maxPortals, 1 + Math.floor(t / (prof.upgrades >= 2 ? 60 : 90)) + (this.citadels.length - 1) * 3);
    if (prof.phase && this.builtCount('portal') >= 1 && this.countType('archive') < 1) want.push('archive');
    if (portals < Math.min(portalTarget, 2 + this.citadels.length)) want.push('portal');
    if (prof.lunge && this.builtCount('archive') >= 1 && this.countType('sanctum') < 1 && t > 200) want.push('sanctum');
    if (prof.upgrades > 0 && this.countType('foundry') < 1 && t > 260) want.push('foundry');
    if (portals < portalTarget) want.push('portal');
    if (prof.aegis && this.builtCount('archive') && this.countType('aegis') < Math.min(prof.aegis * this.citadels.length, 3)) want.push('aegis');

    this.saving = null;
    for (const type of want) {
      const def = BUILDINGS[type];
      if (this.crystals < def.cost.crystals || this.flux < def.cost.flux) {
        // save up for important tech/expansion for a limited time, then spend on the army again
        if (type === 'citadel' || type === 'sanctum') {
          if (!this.saveStart) this.saveStart = w.tick;
          const waited = (w.tick - this.saveStart) / TICK_RATE;
          if (waited < 35 && this.state !== 'defend') {
            this.saving = def.cost;
            return;
          }
          if (waited > 60) this.saveStart = 0;
        }
        continue;
      }
      let ok = false;
      if (type === 'siphon') ok = this.buildSiphon();
      else if (type === 'citadel') ok = this.expand();
      else ok = this.buildNear(type, null);
      if (ok) {
        this.lastBuildTick = w.tick;
        if (type === 'citadel' || type === 'sanctum') this.saveStart = 0;
        return;
      }
    }
  }

  pickBuilder(x, y) {
    let best = null;
    let bd = Infinity;
    for (const u of this.workers) {
      if (u.id === this.scoutId || this.pulled.has(u.id)) continue;
      const o = u.orders[0];
      if (o && o.type === 'build') continue;
      if (o && o.type === 'gather' && (o.phase === 'mining' || u.hidden)) continue;
      const d = Math.hypot(u.x - x, u.y - y) + (u.carry ? 4 : 0);
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    return best;
  }

  buildNear(type, hint) {
    const spot = this.findSpot(type, hint);
    if (!spot) return false;
    const def = BUILDINGS[type];
    const b = this.pickBuilder(spot.bx + def.size / 2, spot.by + def.size / 2);
    if (!b) return false;
    this.issue({ type: 'build', ids: [b.id], building: type, bx: spot.bx, by: spot.by });
    return true;
  }

  buildSiphon() {
    const w = this.world;
    for (const c of this.citadels) {
      const vents = w.resources.filter((r) => r.type === 'vent' && !r.dead && !r.siphon && r.amount > 0 && Math.hypot(r.x - c.x, r.y - c.y) < 12);
      const pendingVent = new Set(
        this.workers.flatMap((u) => u.orders.filter((o) => o.type === 'build' && o.building === 'siphon').map((o) => `${o.bx},${o.by}`)),
      );
      const v = vents.find((x) => !pendingVent.has(`${x.bx},${x.by}`));
      if (v) {
        const b = this.pickBuilder(v.x, v.y);
        if (!b) return false;
        this.issue({ type: 'build', ids: [b.id], building: 'siphon', bx: v.bx, by: v.by });
        return true;
      }
    }
    return false;
  }

  expand() {
    const w = this.world;
    const main = w.map.bases[this.player.startBase];
    const taken = (base) =>
      w.buildings.some((b) => b.type === 'citadel' && !b.dead && Math.hypot(b.x - base.x, b.y - base.y) < 6) ||
      this.workers.some((u) => u.orders.some((o) => o.type === 'build' && o.building === 'citadel'));
    const enemyNear = (base) =>
      [...this.known.values()].some((k) => Math.hypot(k.x - base.x, k.y - base.y) < 20) ||
      this.enemyStarts.some((s) => Math.hypot(s.x - base.x, s.y - base.y) < 30);
    const cands = w.map.bases
      .filter((b) => !taken(b) && !enemyNear(b))
      .sort((a, b) => Math.hypot(a.x - main.x, a.y - main.y) - Math.hypot(b.x - main.x, b.y - main.y));
    for (const base of cands) {
      // base must have been explored for placement; mark area explored for AI fairness via scouting worker trip
      if (!w.isExplored(this.pid, base.x, base.y)) {
        const b = this.pickBuilder(base.x, base.y);
        if (b) this.issue({ type: 'move', ids: [b.id], x: base.x, y: base.y + 3.5 });
        return true;
      }
      const ok = w.canPlace(this.pid, 'citadel', base.tx, base.ty);
      if (ok.ok) {
        const b = this.pickBuilder(base.x, base.y);
        if (!b) return false;
        this.issue({ type: 'build', ids: [b.id], building: 'citadel', bx: base.tx, by: base.ty });
        return true;
      }
    }
    return false;
  }

  findSpot(type, hint) {
    const w = this.world;
    const def = BUILDINGS[type];
    const s = def.size;
    const centers = [];
    if (def.needsPower) {
      for (const c of this.byType.conduit || []) if (c.built) centers.push({ x: c.x, y: c.y, r: 6 });
      // prefer conduits at the main/nat
      centers.sort((a, b) => this.distToMain(a) - this.distToMain(b));
    } else if (hint) {
      centers.push({ x: hint.x, y: hint.y, r: 8 });
    }
    if (!centers.length) {
      const main = w.map.bases[this.player.startBase];
      centers.push({ x: main.x, y: main.y, r: 12 });
    }
    for (const c of centers) {
      for (let r = 0; r <= c.r; r++) {
        const steps = Math.max(8, r * 8);
        for (let k = 0; k < steps; k++) {
          const a = (k / steps) * Math.PI * 2 + r * 0.7;
          const bx = Math.round(c.x + Math.cos(a) * r - s / 2);
          const by = Math.round(c.y + Math.sin(a) * r - s / 2);
          if (!this.goodSpot(type, bx, by, s)) continue;
          return { bx, by };
        }
      }
    }
    return null;
  }

  distToMain(p) {
    const main = this.world.map.bases[this.player.startBase];
    return Math.hypot(p.x - main.x, p.y - main.y);
  }

  goodSpot(type, bx, by, s) {
    const w = this.world;
    const chk = w.canPlace(this.pid, type, bx, by);
    if (!chk.ok) return false;
    // keep crystal lines and paths open
    for (const r of w.resources) {
      if (r.dead) continue;
      if (rectDist(bx, by, s, s, r.bx, r.by, r.w, r.h) < 3) return false;
    }
    for (const b of w.buildings) {
      if (b.dead) continue;
      const gap = b.type === 'citadel' ? 3 : 1;
      if (rectDist(bx, by, s, s, b.bx, b.by, b.w, b.h) < gap) return false;
      // keep the space between citadel and its crystals clear
      if (b.type === 'citadel') {
        const base = w.map.bases.find((m) => Math.hypot(m.x - b.x, m.y - b.y) < 2);
        if (base) {
          const dx = bx + s / 2 - b.x;
          const dy = by + s / 2 - b.y;
          const d = Math.hypot(dx, dy);
          const dot = (dx * Math.cos(base.dir) + dy * Math.sin(base.dir)) / (d || 1);
          if (d < 11 && dot > 0.2) return false;
        }
      }
    }
    // not on other workers' pending build sites
    for (const u of this.workers) {
      for (const o of u.orders) {
        if (o.type !== 'build') continue;
        const os = BUILDINGS[o.building].size;
        if (rectDist(bx, by, s, s, o.bx, o.by, os, os) < 1) return false;
      }
    }
    // must stay reachable: at least one free neighbour cell on two sides
    let free = 0;
    for (let x = bx; x < bx + s; x++) {
      if (w.grid.pathable(x, by - 1)) free++;
      if (w.grid.pathable(x, by + s)) free++;
    }
    return free >= 2;
  }

  // ------------------------------------------------------------- production & research

  manageProduction() {
    const w = this.world;
    const p = this.player;
    const portals = (this.byType.portal || []).filter((b) => b.built);
    const reserve = this.reserveFor();
    for (const b of portals) {
      if (this.crystals - reserve.crystals < 100 || p.supplyUsed + 2 > p.supplyCap) break;
      if (b.phase) {
        if (b.warpCd > 0 || !b.powered) continue;
        const spot = this.warpSpot();
        if (spot && this.crystals - reserve.crystals >= 100) {
          this.issue({ type: 'warp', x: spot.x, y: spot.y, portal: b.id });
          this.pendingCrystals += 100;
        }
      } else if (b.queue.length < this.profile.trainQueue && b.powered) {
        this.issue({ type: 'train', ids: [b.id], unit: 'lancer' });
        this.pendingCrystals += 100;
      }
    }
    // rally portals to the staging point
    const stage = this.stagingPoint();
    for (const b of portals) {
      if (!b.rally || Math.hypot(b.rally.x - stage.x, b.rally.y - stage.y) > 4) {
        this.issue({ type: 'rally', ids: [b.id], x: stage.x, y: stage.y });
      }
    }
    void w;
  }

  // crystals the AI wants to keep for planned structures
  reserveFor() {
    if (this.saving && this.state !== 'defend') return { crystals: this.saving.crystals };
    return { crystals: 0 };
  }

  warpSpot() {
    const w = this.world;
    const stage = this.stagingPoint();
    const conduits = (this.byType.conduit || []).filter((c) => c.built).sort((a, b) => Math.hypot(a.x - stage.x, a.y - stage.y) - Math.hypot(b.x - stage.x, b.y - stage.y));
    for (const c of conduits.slice(0, 3)) {
      for (let k = 0; k < 12; k++) {
        const a = w.rng.next() * Math.PI * 2;
        const r = 2 + w.rng.next() * 3.5;
        const x = c.x + Math.cos(a) * r;
        const y = c.y + Math.sin(a) * r;
        if (!w.grid.pathable(Math.floor(x), Math.floor(y))) continue;
        if (!w.isVisibleTo({ kind: 'point', x, y }, this.pid)) continue;
        const near = w.hash.query(x, y, 1.2, []);
        if (near.some((u) => Math.hypot(u.x - x, u.y - y) < u.r + 0.6)) continue;
        return { x, y };
      }
    }
    return null;
  }

  manageResearch() {
    const w = this.world;
    const p = this.player;
    const prof = this.profile;
    const tryR = (id, maxLevel) => {
      if ((p.upgrades[id] || 0) >= maxLevel || p.researching[id]) return;
      const st = w.researchStatus(this.pid, id);
      if (!st.ok) return;
      if (this.crystals - this.reserveFor().crystals < st.L.cost.crystals || this.flux < st.L.cost.flux) return;
      const at = (this.byType[w.defs.RESEARCH[id].at] || []).find((b) => b.built && b.queue.length === 0 && b.powered);
      if (at) this.issue({ type: 'research', ids: [at.id], research: id });
    };
    if (prof.phase) tryR('phaseTransit', 1);
    if (prof.lunge) tryR('lunge', 1);
    if (prof.upgrades > 0) {
      tryR('weapons', prof.upgrades);
      if (this.time > 380) tryR('armor', prof.upgrades);
      if (this.time > 540) tryR('barrier', prof.upgrades);
    }
  }

  // ------------------------------------------------------------- army

  stagingPoint() {
    const w = this.world;
    const main = w.map.bases[this.player.startBase];
    const enemy = this.enemyStarts[0] || { x: w.map.width / 2, y: w.map.height / 2 };
    // the own citadel closest to the enemy, nudged toward the enemy
    let front = { x: main.x, y: main.y };
    let bd = Infinity;
    for (const c of this.citadels) {
      const d = Math.hypot(c.x - enemy.x, c.y - enemy.y);
      if (d < bd) {
        bd = d;
        front = c;
      }
    }
    const dx = enemy.x - front.x;
    const dy = enemy.y - front.y;
    const d = Math.hypot(dx, dy) || 1;
    let x = front.x + (dx / d) * 9;
    let y = front.y + (dy / d) * 9;
    const nf = w.grid.nearestFree(x, y, 8);
    if (nf) {
      x = nf[0] + 0.5;
      y = nf[1] + 0.5;
    }
    return { x, y };
  }

  threat() {
    const w = this.world;
    let sx = 0;
    let sy = 0;
    let n = 0;
    let supply = 0;
    const mine = w.buildings.filter((b) => b.owner === this.pid && !b.dead);
    for (const u of w.units) {
      if (u.dead || !w.areEnemies(this.pid, u.owner) || !w.isVisibleTo(u, this.pid)) continue;
      const nearBase = mine.some((b) => Math.hypot(b.x - u.x, b.y - u.y) < 16);
      if (!nearBase) continue;
      sx += u.x;
      sy += u.y;
      n++;
      supply += u.def.role === 'worker' ? 0.5 : u.def.supply;
    }
    if (!n) return null;
    return { x: sx / n, y: sy / n, n, supply };
  }

  manageArmy() {
    const w = this.world;
    const prof = this.profile;
    const ids = this.army.map((u) => u.id);
    const threat = this.threat();
    if (threat && threat.supply >= 1) {
      this.state = 'defend';
      if (ids.length) {
        const idle = this.army.filter((u) => !u.orders.length || u.orders[0].type === 'move' || (u.orders[0].type === 'attackMove' && Math.hypot(u.orders[0].x - threat.x, u.orders[0].y - threat.y) > 8));
        if (idle.length) this.issue({ type: 'attackMove', ids: idle.map((u) => u.id), x: threat.x, y: threat.y });
      }
      // worker pull when heavily outnumbered
      if (prof.workerPull && threat.supply <= 10 && threat.supply > this.armySupply * 1.5 + 2) {
        const pull = this.workers.filter((u) => Math.hypot(u.x - threat.x, u.y - threat.y) < 14 && !this.pulled.has(u.id)).slice(0, Math.ceil(threat.supply * 1.5));
        if (pull.length) {
          for (const u of pull) this.pulled.add(u.id);
          this.issue({ type: 'attackMove', ids: pull.map((u) => u.id), x: threat.x, y: threat.y });
        }
      }
      return;
    }
    if (this.pulled.size) {
      const back = [...this.pulled].filter((id) => w.byId.get(id));
      this.pulled.clear();
      if (back.length) this.issue({ type: 'stop', ids: back }); // idle -> reassigned to mining
    }
    if (this.state === 'defend') this.state = 'build';

    const t = this.time;
    const threshold = prof.attackSupply + this.attacksLaunched * 6;
    if (this.state !== 'attack') {
      const ready = t >= prof.firstAttack && (this.armySupply >= threshold || this.player.supplyUsed >= 180);
      if (ready && ids.length) {
        this.state = 'attack';
        this.attacksLaunched++;
        this.attackStartSupply = this.armySupply;
        this.attackTarget = this.pickAttackTarget();
        if (this.attackTarget) this.issue({ type: 'attackMove', ids, x: this.attackTarget.x, y: this.attackTarget.y });
      } else {
        // gather idle units at staging point
        const stage = this.stagingPoint();
        const loose = this.army.filter((u) => !u.orders.length && Math.hypot(u.x - stage.x, u.y - stage.y) > 7);
        if (loose.length) this.issue({ type: 'attackMove', ids: loose.map((u) => u.id), x: stage.x, y: stage.y });
      }
      return;
    }
    // attacking
    if (this.armySupply < Math.max(4, this.attackStartSupply * 0.35) && this.player.supplyUsed < 150) {
      this.state = 'build';
      const stage = this.stagingPoint();
      if (ids.length) this.issue({ type: 'move', ids, x: stage.x, y: stage.y });
      return;
    }
    const tgt = this.pickAttackTarget();
    if (tgt && (!this.attackTarget || Math.hypot(tgt.x - this.attackTarget.x, tgt.y - this.attackTarget.y) > 3)) {
      this.attackTarget = tgt;
    }
    if (!this.attackTarget) return;
    const idle = this.army.filter((u) => !u.orders.length);
    if (idle.length) this.issue({ type: 'attackMove', ids: idle.map((u) => u.id), x: this.attackTarget.x, y: this.attackTarget.y });
  }

  pickAttackTarget() {
    const w = this.world;
    // closest known enemy structure to our army center
    let cx = 0;
    let cy = 0;
    for (const u of this.army) {
      cx += u.x;
      cy += u.y;
    }
    if (this.army.length) {
      cx /= this.army.length;
      cy /= this.army.length;
    } else {
      const s = this.stagingPoint();
      cx = s.x;
      cy = s.y;
    }
    let best = null;
    let bd = Infinity;
    for (const k of this.known.values()) {
      const d = Math.hypot(k.x - cx, k.y - cy);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    if (best) return best;
    // unexplored enemy start or any base we haven't checked
    for (const s of this.enemyStarts) {
      const alive = w.buildings.some((b) => !b.dead && w.areEnemies(this.pid, b.owner) && Math.hypot(b.x - s.x, b.y - s.y) < 12);
      if (alive || !w.isVisibleTo({ kind: 'point', x: s.x, y: s.y }, this.pid)) return { x: s.x, y: s.y };
    }
    // sweep bases
    const bases = w.map.bases.filter((b) => !w.isVisibleTo({ kind: 'point', x: b.x, y: b.y }, this.pid));
    if (bases.length) {
      const b = bases[(w.tick / 200) % bases.length | 0];
      return { x: b.x, y: b.y };
    }
    return null;
  }

  manageScout() {
    if (!this.profile.scout || this.scouted) return;
    const w = this.world;
    if (this.time < 55 || !this.enemyStarts.length) return;
    if (!this.scoutId) {
      const u = this.pickBuilder(this.enemyStarts[0].x, this.enemyStarts[0].y);
      if (!u) return;
      this.scoutId = u.id;
      const pts = this.enemyStarts.map((s) => ({ x: s.x, y: s.y + 6 }));
      this.issue({ type: 'move', ids: [u.id], x: pts[0].x, y: pts[0].y });
      for (const p of pts.slice(1)) this.issue({ type: 'move', ids: [u.id], x: p.x, y: p.y, queue: true });
      return;
    }
    const u = w.byId.get(this.scoutId);
    if (!u || u.dead) {
      this.scouted = true;
      this.scoutId = 0;
      return;
    }
    if (!u.orders.length) {
      // done scouting: go back to mining
      this.scouted = true;
      this.scoutId = 0;
      const main = w.map.bases[this.player.startBase];
      const f = w.findNearbyCrystal(main.x, main.y, 12);
      if (f) this.issue({ type: 'gather', ids: [u.id], target: f.id });
    }
  }
}

export { UNITS };
