// AI for pvzlite survival mode. Builders fortify a crystal grove with a ring of
// Barricade Wards, add turrets and level up. Hunters upgrade, scout, and breach walls.
import { TICK_RATE } from '../constants.js';
import { SURVIVAL, levelCost, SURVIVAL_BUILDINGS, HUNTER_UPGRADES, upgradeCost } from '../data/survival.js';
import { SPRINT } from '../sim/survival.js';

const THINK = { easy: 24, normal: 12, hard: 8, brutal: 5 };

export class SurvivalAI {
  constructor(world, pid) {
    this.world = world;
    this.pid = pid;
    this.player = world.players[pid];
    this.diff = this.player.difficulty || 'normal';
    this.think = THINK[this.diff] || 12;
    this.offset = (pid * 5) % this.think;
    this.plan = null;
    this.known = new Map(); // builder hero id -> {x,y,tick}
    this.visited = new Map(); // grove index -> tick
    this.lastTarget = 0;
    this.lastBreach = 0;
  }

  issue(cmd) {
    this.world.issue(this.pid, cmd);
  }

  get hero() {
    return this.world.byId.get(this.player.heroId) || null;
  }

  update() {
    const w = this.world;
    if (this.player.eliminated || w.over) return;
    if ((w.tick + this.offset) % this.think !== 0) return;
    if (this.player.role === 'hunter') this.hunterThink();
    else this.builderThink();
  }

  // =================================================================== Builder

  groveFields(gi) {
    return this.world.resources.filter((r) => !r.dead && r.type === 'crystal' && r.grove === gi && r.amount > 0);
  }

  claims() {
    const sv = this.world.survival;
    if (!sv.claims) sv.claims = {};
    return sv.claims;
  }

  chooseGrove(hero) {
    const w = this.world;
    const claims = this.claims();
    let best = null;
    let bestScore = -Infinity;
    w.map.groves.forEach((g, gi) => {
      const fields = this.groveFields(gi);
      if (fields.length < 2) return;
      const plan = this.makePlan(gi, fields);
      if (!plan) return;
      const d = Math.hypot(g.x - hero.x, g.y - hero.y);
      const cageD = Math.hypot(g.x - w.map.cage.x, g.y - w.map.cage.y);
      let score = fields.length * 6 + (g.rich ? 4 : 0) - d * 0.35 - plan.slots.length * 0.6 + Math.min(cageD, 40) * 0.25;
      if (cageD < 26) score -= 30;
      if (claims[gi] !== undefined && claims[gi] !== this.pid) score -= 60;
      if (score > bestScore) {
        bestScore = score;
        best = plan;
      }
    });
    if (best) {
      for (const k of Object.keys(claims)) if (claims[k] === this.pid) delete claims[k];
      claims[best.grove] = this.pid;
    }
    return best;
  }

  // Ring of 2x2 Barricade Wards around the grove with a 2-cell inner band for turrets.
  makePlan(gi, fields) {
    const grid = this.world.grid;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const f of fields) {
      minX = Math.min(minX, f.bx);
      minY = Math.min(minY, f.by);
      maxX = Math.max(maxX, f.bx + f.w);
      maxY = Math.max(maxY, f.by + f.h);
    }
    let ix0 = minX - 2;
    let iy0 = minY - 2;
    let ix1 = maxX + 2;
    let iy1 = maxY + 2;
    if ((ix1 - ix0) % 2) ix1++;
    if ((iy1 - iy0) % 2) iy1++;
    const R = { x0: ix0 - 2, y0: iy0 - 2, x1: ix1 + 2, y1: iy1 + 2 };
    const slots = [];
    const pushSlot = (x, y) => slots.push({ x, y });
    for (let x = R.x0; x < R.x1; x += 2) {
      pushSlot(x, R.y0);
      pushSlot(x, R.y1 - 2);
    }
    for (let y = R.y0 + 2; y < R.y1 - 2; y += 2) {
      pushSlot(R.x0, y);
      pushSlot(R.x1 - 2, y);
    }
    const need = [];
    for (const s of slots) {
      let buildable = true;
      let blocked = true;
      for (let y = s.y; y < s.y + 2; y++) {
        for (let x = s.x; x < s.x + 2; x++) {
          if (!grid.inBounds(x, y)) {
            buildable = false;
            continue;
          }
          const terrainOk = grid.terrainPathable(x, y);
          const occ = grid.occ[y * grid.W + x];
          if (!(grid.flags[y * grid.W + x] & 2) || occ) buildable = false;
          if (terrainOk && !occ) blocked = false;
        }
      }
      if (buildable) need.push(s);
      else if (!blocked) return null; // a walkable gap we can't seal
    }
    if (need.length < 4) return null;
    // never plan walls next to the Hunter cage
    const cage = this.world.map.cage;
    const keep = this.world.map.cageRadius + 4;
    if (need.some((sl) => Math.abs(sl.x + 1 - cage.x) < keep && Math.abs(sl.y + 1 - cage.y) < keep)) return null;
    const corners = [
      { x: ix0, y: iy0 },
      { x: ix1 - 2, y: iy0 },
      { x: ix0, y: iy1 - 2 },
      { x: ix1 - 2, y: iy1 - 2 },
    ];
    corners.sort((a, b) => Math.hypot(a.x - cage.x, a.y - cage.y) - Math.hypot(b.x - cage.x, b.y - cage.y));
    need.sort((a, b) => Math.hypot(a.x - cage.x, a.y - cage.y) - Math.hypot(b.x - cage.x, b.y - cage.y));
    return { grove: gi, slots: need, corners, inner: { x0: ix0, y0: iy0, x1: ix1, y1: iy1 }, ring: R, cx: (ix0 + ix1) / 2, cy: (iy0 + iy1) / 2 };
  }

  inside(plan, x, y) {
    return x >= plan.inner.x0 && x <= plan.inner.x1 && y >= plan.inner.y0 && y <= plan.inner.y1;
  }

  slotBuilt(s, type) {
    const occ = this.world.grid.occ[s.y * this.world.grid.W + s.x];
    if (!occ) return false;
    const e = this.world.byId.get(occ);
    return !!(e && e.owner === this.pid && (!type || e.type === type));
  }

  builderThink() {
    const w = this.world;
    const p = this.player;
    const hero = this.hero;
    if (!hero) {
      this.plan = null;
      return;
    }
    if (!this.plan || this.groveFields(this.plan.grove).length === 0) this.plan = this.chooseGrove(hero);
    const plan = this.plan;
    const hunters = w.units.filter((u) => u.type === 'hunter' && !u.dead && !u.caged && w.isVisibleTo(u, this.pid));
    let threat = null;
    let td = Infinity;
    for (const h of hunters) {
      const d = Math.hypot(h.x - hero.x, h.y - hero.y);
      if (d < td) {
        td = d;
        threat = h;
      }
    }
    const busyBuilding = hero.orders.some((o) => o.type === 'build');
    // flee when caught in the open, or when a Hunter got inside the walls
    const exposed = !plan || !this.inside(plan, hero.x, hero.y);
    const hunterInside = threat && plan && this.inside(plan, threat.x, threat.y);
    if (threat && ((exposed && td < 10) || (hunterInside && td < 7))) {
      const away = this.escapePoint(hero, threat, plan);
      const path = w.grid.findPath(hero.x, hero.y, away.x, away.y, { radius: hero.r, maxNodes: 4000 });
      const end = path && path.length ? path[path.length - 1] : null;
      if (end && Math.hypot(end[0] - hero.x, end[1] - hero.y) > 3) {
        if (p.level >= SPRINT.unlock && p.sprintCd <= 0 && td < 6) this.issue({ type: 'sprint' });
        this.issue({ type: 'move', ids: [hero.id], x: end[0], y: end[1] });
        this.fleeing = w.tick;
        return;
      }
    }
    if (this.fleeing && w.tick - this.fleeing < TICK_RATE * 2) return;
    this.fleeing = 0;
    if (!plan) {
      if (!hero.orders.length) this.mineNearest(hero);
      this.spendLevels(0);
      return;
    }
    // walk home
    if (!this.inside(plan, hero.x, hero.y) && !busyBuilding) {
      const f = this.groveFields(plan.grove)[0];
      if (f) this.issue({ type: 'gather', ids: [hero.id], target: f.id });
      return;
    }
    // 1. seal the ring
    const missing = plan.slots.filter((s) => !this.slotBuilt(s));
    const barricadeCost = SURVIVAL_BUILDINGS.barricade.cost;
    if (missing.length) {
      if (!busyBuilding && p.crystals >= barricadeCost) {
        const s = missing.find((m) => w.canPlace(this.pid, 'barricade', m.x, m.y).ok);
        if (s) {
          this.issue({ type: 'build', ids: [hero.id], building: 'barricade', bx: s.x, by: s.y });
          this.queueMining(hero, plan);
          return;
        }
      }
      if (!hero.orders.length) this.queueMining(hero, plan, false);
      // level 2 early for faster mining
      if (p.level === 1 && p.crystals >= levelCost(1) + barricadeCost * 3) this.issue({ type: 'levelUp' });
      return;
    }
    // 2. defenses in the inner corners
    const want = this.desiredDefenses();
    for (let i = 0; i < plan.corners.length && i < want.length; i++) {
      const c = plan.corners[i];
      const type = want[i];
      if (this.slotBuilt(c)) continue;
      const sb = SURVIVAL_BUILDINGS[type];
      if (p.level < sb.unlock) break;
      if (busyBuilding) return;
      if (p.crystals >= sb.cost) {
        if (w.canPlace(this.pid, type, c.x, c.y).ok) {
          this.issue({ type: 'build', ids: [hero.id], building: type, bx: c.x, by: c.y });
          this.queueMining(hero, plan);
          return;
        }
      } else {
        if (!hero.orders.length) this.queueMining(hero, plan, false);
        // save up for the first turret, otherwise keep leveling
        if (i < (this.diff === 'easy' ? 0 : 1)) return;
        break;
      }
    }
    if (!hero.orders.length) this.queueMining(hero, plan, false);
    this.spendLevels(this.diff === 'easy' ? 0 : 40);
  }

  desiredDefenses() {
    if (this.diff === 'easy') return ['turret', 'mender'];
    if (this.diff === 'normal') return ['turret', 'turret', 'mender', 'lanceTurret'];
    return ['turret', 'lanceTurret', 'turret', 'mender'];
  }

  spendLevels(reserve) {
    const p = this.player;
    if (p.level >= SURVIVAL.maxLevel) return;
    if (p.crystals >= levelCost(p.level) + reserve) this.issue({ type: 'levelUp' });
  }

  ringBroken(plan) {
    return plan.slots.some((s) => !this.slotBuilt(s));
  }

  queueMining(hero, plan, queue = true) {
    const fields = this.groveFields(plan.grove);
    if (!fields.length) return;
    const f = fields.find((r) => !r.miner || r.miner === hero.id) || fields[0];
    this.issue({ type: 'gather', ids: [hero.id], target: f.id, queue });
  }

  mineNearest(hero) {
    const f = this.world.findNearbyCrystal(hero.x, hero.y, 60);
    if (f) this.issue({ type: 'gather', ids: [hero.id], target: f.id });
  }

  escapePoint(hero, threat, plan) {
    const w = this.world;
    if (plan && !this.ringBroken(plan) && Math.hypot(plan.cx - threat.x, plan.cy - threat.y) > 3) return { x: plan.cx + 0.5, y: plan.cy + 0.5 };
    // run to the safest known spot: far from the hunter, not too far from us, never into a dead-end corner
    const cands = [...w.map.builderSpawns, ...w.map.groves];
    for (const pl of w.players) {
      const ai = w.ais.find((a) => a.pid === pl.id && a.plan && !a.ringBroken(a.plan));
      if (ai) cands.push({ x: ai.plan.cx, y: ai.plan.cy, bonus: 15 });
    }
    let best = null;
    let bestScore = -Infinity;
    for (const c of cands) {
      const dHunter = Math.hypot(c.x - threat.x, c.y - threat.y);
      const dMe = Math.hypot(c.x - hero.x, c.y - hero.y);
      // reject spots that make us run past the hunter
      const toC = [c.x - hero.x, c.y - hero.y];
      const toH = [threat.x - hero.x, threat.y - hero.y];
      const dot = (toC[0] * toH[0] + toC[1] * toH[1]) / ((Math.hypot(...toC) || 1) * (Math.hypot(...toH) || 1));
      const score = dHunter - dMe * 0.4 - (dot > 0.3 ? 40 : 0) + (c.bonus || 0);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    const t = best || { x: w.map.width / 2, y: w.map.height / 2 };
    const nf = w.grid.nearestFree(t.x, t.y, 10);
    return nf ? { x: nf[0] + 0.5, y: nf[1] + 0.5 } : t;
  }

  // =================================================================== Hunter

  hunterThink() {
    const w = this.world;
    const p = this.player;
    this.buyUpgrades();
    const hero = this.hero;
    if (!hero || hero.caged) return;
    // remember Shapers we can see
    for (const u of w.units) {
      if (u.type !== 'builder' || u.dead) continue;
      if (w.isVisibleTo(u, this.pid)) this.known.set(u.id, { x: u.x, y: u.y, tick: w.tick });
    }
    for (const [id] of this.known) if (!w.byId.get(id)) this.known.delete(id);
    if (p.revealCd <= 0 && this.diff !== 'easy') {
      const seen = [...this.known.values()].some((k) => w.tick - k.tick < TICK_RATE * 2);
      if (!seen || this.diff === 'brutal') this.issue({ type: 'reveal' });
    }
    // retreat to recover when badly hurt (barrier/hull regenerate out of combat)
    const hpFrac = (hero.hp + hero.barrier) / (hero.maxHp + hero.maxBarrier);
    if ((this.diff === 'hard' || this.diff === 'brutal') && hpFrac < 0.3 && this.turretThreat(hero)) {
      const c = w.map.cage;
      this.issue({ type: 'move', ids: [hero.id], x: c.x, y: c.y });
      this.retreating = w.tick;
      return;
    }
    if (this.retreating && w.tick - this.retreating < TICK_RATE * 10 && hpFrac < 0.75) return;
    this.retreating = 0;
    // pick a target Shaper
    let target = null;
    let best = Infinity;
    for (const [id, k] of this.known) {
      const u = w.byId.get(id);
      const age = (w.tick - k.tick) / TICK_RATE;
      if (age > 45) continue;
      const level = u ? w.players[u.owner].level : 1;
      const defense = this.defenseNear(k.x, k.y);
      const score = Math.hypot(k.x - hero.x, k.y - hero.y) + defense * 6 + level * 1.5 + age * 0.3;
      if (score < best) {
        best = score;
        target = { id, ...k, unit: u };
      }
    }
    if (!target) {
      this.roam(hero);
      return;
    }
    const visible = target.unit && w.isVisibleTo(target.unit, this.pid);
    // try to reach the Shaper directly
    if (w.tick - this.lastBreach < TICK_RATE * 0.9 && hero.orders.length) return;
    this.lastBreach = w.tick;
    const tx = visible ? target.unit.x : target.x;
    const ty = visible ? target.unit.y : target.y;
    const breach = this.breachPath(hero, tx, ty);
    if (!breach) {
      this.issue({ type: 'move', ids: [hero.id], x: tx, y: ty });
      return;
    }
    if (breach.blocker) {
      const cur = hero.orders[0];
      if (!(cur && cur.type === 'attack' && cur.target === breach.blocker.id)) {
        this.issue({ type: 'attack', ids: [hero.id], target: breach.blocker.id });
      }
      return;
    }
    if (visible) {
      const cur = hero.orders[0];
      if (!(cur && cur.type === 'attack' && cur.target === target.unit.id)) this.issue({ type: 'attack', ids: [hero.id], target: target.unit.id });
    } else {
      this.issue({ type: 'attackMove', ids: [hero.id], x: tx, y: ty });
    }
  }

  buyUpgrades() {
    const p = this.player;
    const plan = {
      easy: ['blades', 'vitality', 'armor'],
      normal: ['blades', 'armor', 'vitality', 'sunder', 'swiftness', 'barrier', 'lunge'],
      hard: ['blades', 'armor', 'sunder', 'vitality', 'swiftness', 'barrier', 'lunge'],
      brutal: ['blades', 'sunder', 'armor', 'vitality', 'swiftness', 'lunge', 'barrier'],
    }[this.diff] || ['blades', 'armor'];
    // buy the cheapest next level among the plan, weighted by priority
    let pick = null;
    let pickCost = Infinity;
    plan.forEach((id, i) => {
      const lvl = p.hunterUp[id] || 0;
      if (lvl >= HUNTER_UPGRADES[id].max) return;
      const c = upgradeCost(id, lvl) * (1 + i * 0.12);
      if (c < pickCost) {
        pickCost = c;
        pick = id;
      }
    });
    if (pick && p.essence >= upgradeCost(pick, p.hunterUp[pick] || 0) + (this.diff === 'easy' ? 150 : 0)) {
      this.issue({ type: 'upgrade', upgrade: pick });
    }
  }

  defenseNear(x, y) {
    let n = 0;
    for (const b of this.world.buildings) {
      if (b.dead || !b.weaponDamage) continue;
      if (Math.hypot(b.x - x, b.y - y) < 10) n += b.type === 'lanceTurret' ? 2 : 1;
    }
    return n;
  }

  turretThreat(hero) {
    for (const b of this.world.buildings) {
      if (b.dead || !b.weaponDamage || !b.built) continue;
      if (Math.hypot(b.x - hero.x, b.y - hero.y) < b.weaponRange + 2) return true;
    }
    return false;
  }

  roam(hero) {
    const w = this.world;
    if (hero.orders.length) return;
    let best = null;
    let bestScore = -Infinity;
    w.map.groves.forEach((g, gi) => {
      const last = this.visited.get(gi) ?? -99999;
      if (Math.hypot(g.x - hero.x, g.y - hero.y) < 5) this.visited.set(gi, w.tick);
      const score = (w.tick - last) / TICK_RATE - Math.hypot(g.x - hero.x, g.y - hero.y) * 0.8;
      if (score > bestScore) {
        bestScore = score;
        best = g;
      }
    });
    if (best) this.issue({ type: 'attackMove', ids: [hero.id], x: best.x, y: best.y });
  }

  // A* where Shaper structures are passable at a cost: returns the first structure on the
  // cheapest route (the wall segment to break), or {blocker:null} if the route is open.
  breachPath(hero, tx, ty) {
    const w = this.world;
    const g = w.grid;
    const W = g.W;
    const H = g.H;
    const N = W * H;
    if (!this.buf || this.buf.cost.length !== N) {
      this.buf = { cost: new Float32Array(N), from: new Int32Array(N), seen: new Uint32Array(N), gen: 0 };
    }
    const B = this.buf;
    B.gen++;
    const gen = B.gen;
    const sx = Math.floor(hero.x);
    const sy = Math.floor(hero.y);
    const gx = Math.floor(tx);
    const gy = Math.floor(ty);
    const enter = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return -1;
      if (!g.terrainPathable(x, y)) return -1;
      const occ = g.occ[y * W + x];
      if (!occ) return 0;
      const e = w.byId.get(occ);
      if (!e || e.kind !== 'building' || !w.areEnemies(this.pid, e.owner)) return -1;
      return 4 + (e.hp + e.barrier) / 40;
    };
    const heap = [];
    const push = (i, f) => {
      heap.push([f, i]);
      let k = heap.length - 1;
      while (k > 0) {
        const pk = (k - 1) >> 1;
        if (heap[pk][0] <= heap[k][0]) break;
        [heap[pk], heap[k]] = [heap[k], heap[pk]];
        k = pk;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          let c = 2 * k + 1;
          if (c >= heap.length) break;
          if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++;
          if (heap[c][0] >= heap[k][0]) break;
          [heap[c], heap[k]] = [heap[k], heap[c]];
          k = c;
        }
      }
      return top;
    };
    const h = (x, y) => Math.hypot(x - gx, y - gy);
    const si = sy * W + sx;
    B.seen[si] = gen;
    B.cost[si] = 0;
    B.from[si] = -1;
    push(si, h(sx, sy));
    let found = -1;
    let expanded = 0;
    while (heap.length && expanded < 25000) {
      const [, ci] = pop();
      const cx = ci % W;
      const cy = (ci - cx) / W;
      expanded++;
      if (Math.abs(cx - gx) <= 1 && Math.abs(cy - gy) <= 1) {
        found = ci;
        break;
      }
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = cx + ox;
          const ny = cy + oy;
          const pen = enter(nx, ny);
          if (pen < 0) continue;
          if (ox && oy && (enter(cx + ox, cy) < 0 || enter(cx, cy + oy) < 0)) continue;
          const ni = ny * W + nx;
          const nc = B.cost[ci] + (ox && oy ? 1.414 : 1) + pen;
          if (B.seen[ni] === gen && nc >= B.cost[ni]) continue;
          B.seen[ni] = gen;
          B.cost[ni] = nc;
          B.from[ni] = ci;
          push(ni, nc + h(nx, ny));
        }
      }
    }
    if (found < 0) return null;
    // walk back to find the first structure from the hunter's side
    const cells = [];
    for (let k = found; k !== -1; k = B.from[k]) cells.push(k);
    cells.reverse();
    for (const ci of cells) {
      const occ = g.occ[ci];
      if (occ) {
        const e = w.byId.get(occ);
        if (e && e.kind === 'building') return { blocker: e };
      }
    }
    return { blocker: null };
  }
}
