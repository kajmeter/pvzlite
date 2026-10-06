// Survival mode: Shapers vs Lancer, pvzlite's reproduction of the "Probes vs Zealot 2" arcade rules.
// Written from docs/design/pvz-mode.md (sections 1-11 and the module API in section 15). The spec's
// numbers are copied here on purpose so the tests catch drift in the data tables.
//
// Where the spec leaves room, these tests assume:
// - legacy roles: 'builder' means 'shaper' and 'hunter' asks for 'lancer';
// - shop attack speed and damage reduction are fractions (+400% -> as: 4, 9% -> dr: 0.09);
// - building/upgrade/train costs are paid when the action starts (placement, upgrade start, queueing);
//   a building's `level` is only read once `upgrading` is back to 0;
// - a Blink aimed beyond 8 cells may fail or be clamped, but never moves the Shaper further than 8;
// - cloaked units are reported invisible by world.isVisibleTo() for the other team (unless scanned);
// - pallets are worth their table value (pace is not listed for pallets in section 1);
// - the Lancer's passive income is only measured after it arrived (0:40);
// - miner/warden costs are paid when queued; a depot queues at most 5 miners;
// - Decay "50% slower" = twice the strike period; a Barrier Field covers 2x2 cells around the point;
// - the hero ("ids") is passed with every Shaper/Lancer command; structure commands also pass `id`.
// Test setup (teleports, resources, cooldown resets, removing random gas bonuses, parking the
// Lancer away from a test base) only arranges situations; the rules are exercised through commands.
import { describe, it, expect } from 'vitest';
import { World } from '../src/shared/sim/world.js';
import { applyDamage } from '../src/shared/sim/combat.js';
import { PathGrid } from '../src/shared/sim/pathgrid.js';
import { TICK_RATE as T } from '../src/shared/constants.js';
import { MAP_DESCRIPTIONS } from '../src/shared/maps/index.js';
import { CELL_PATHABLE, CELL_BUILDABLE, CELL_RAMP } from '../src/shared/maps/mapgen.js';
import * as data from '../src/shared/data/survival.js';
import * as sim from '../src/shared/sim/survival.js';

const LONG = 30000; // ms, for tests that simulate several game minutes

const MAP = (
  MAP_DESCRIPTIONS.find((m) => m.id === 'wilds') ||
  MAP_DESCRIPTIONS.find((m) => m.mode === 'survival') ||
  MAP_DESCRIPTIONS[0]
).id;

// ------------------------------------------------------------------ spec tables (section 4 / 7)

// level, gas, minerals, gas/s, pallet, hp, upgrade requires
const GEN = [
  [1, 0, 0, 1, 0, 200, null],
  [2, 50, 0, 2, 100, 300, ['wall', 1]],
  [3, 100, 0, 4, 150, 400, ['wall', 4]],
  [4, 200, 0, 8, 175, 600, ['market', 1]],
  [5, 400, 0, 16, 200, 800, ['wall', 6]],
  [6, 800, 32, 32, 400, 1200, ['market', 2]],
  [7, 1600, 64, 64, 5600, 1800, ['wall', 7]],
  [8, 3200, 128, 128, 6400, 2700, ['wall', 9]],
  [9, 6400, 256, 256, 9600, 4000, ['wall', 11]],
  [10, 12800, 512, 512, 12800, 6000, ['wall', 13]],
].map(([level, gas, minerals, income, pallet, hp, req]) => ({ level, gas, minerals, income, pallet, hp, req }));

// level, name, gas, minerals, hp, shield, dr
const WALLS = [
  [1, 'Wall 1', 4, 0, 50, 0, 0],
  [2, 'Wall 2', 8, 0, 70, 0, 0],
  [3, 'Wall 3', 16, 0, 110, 0, 0],
  [4, 'Wall 4', 32, 0, 170, 0, 0],
  [5, 'Wall 5', 64, 0, 210, 0, 0],
  [6, 'Ultra Wall 1', 128, 0, 320, 0, 0.02],
  [7, 'Ultra Wall 2', 256, 0, 640, 0, 0.04],
  [8, 'Ultra Wall 3', 512, 0, 1280, 0, 0.06],
  [9, 'Ultra Wall 4', 1024, 0, 2560, 0, 0.08],
  [10, 'Ultra Wall 5', 2048, 0, 5120, 0, 0.1],
  [11, 'Mega Wall 1', 4096, 32, 10240, 0, 0.12],
  [12, 'Mega Wall 2', 8192, 64, 20480, 0, 0.14],
  [13, 'Mega Wall 3', 16384, 128, 40960, 0, 0.16],
  [14, 'Mega Wall 4', 32768, 256, 81920, 0, 0.18],
  [15, 'Mega Wall 5', 65536, 516, 163840, 0, 0.2],
  [16, 'Power Wall 1', 131072, 1020, 350000, 0, 0.5],
  [17, 'Power Wall 2', 262144, 2048, 400000, 277680, 0.6],
  [18, 'Final Wall', 1000000, 500000, 500000, 500000, 0.75],
].map(([level, name, gas, minerals, hp, shield, dr]) => ({ level, name, gas, minerals, hp, shield, dr }));
const wallTime = (L) => (L <= 5 ? 2 : L <= 10 ? 3 : L <= 15 ? 4 : 5);

// level, name, gas, hp
const MARKETS = [
  [1, 'Market', 64, 20],
  [2, 'Underground Market', 256, 50],
  [3, 'Global Market', 1024, 130],
];

// level, gas, minerals, damage, cooldown, range, hp, requires
const TURRETS = [
  [1, 8, 0, 1, 1.0, 6, 20, null],
  [2, 24, 0, 2, 1.0, 6, 30, null],
  [3, 32, 0, 4, 1.0, 6, 40, ['market', 1]],
  [4, 64, 0, 8, 1.0, 6, 40, ['market', 1]],
  [5, 128, 0, 16, 1.0, 6, 40, ['market', 2]],
  [6, 256, 0, 32, 1.0, 6, 40, ['market', 2]],
  [7, 512, 16, 64, 1.0, 6, 40, ['market', 3]],
  [8, 1024, 32, 128, 1.0, 7, 40, ['market', 3]],
  [9, 2048, 64, 400, 1.0, 7, 40, ['market', 3]],
  [10, 4096, 128, 700, 1.0, 8, 40, ['market', 3]],
  [11, 8192, 15000, 40960, 1.0, 9, 40, ['library']],
  [12, 8192, 36000, 160000, 1.0, 10, 40, ['library']],
  [13, 8192, 1000960, 524270, 0.2, 11, 40, ['library']],
  [14, 0, 20000000, 524270, 0.1, 7, 100000, ['library']],
].map(([level, gas, minerals, damage, cooldown, range, hp, req]) => ({ level, gas, minerals, damage, cooldown, range, hp, req }));

// tier, name, gas, minerals per gather, gather seconds
const MINERS = [
  [1, 'Simple Miner', 512, 1, 8],
  [2, 'Average Miner', 1024, 1, 4],
  [3, 'Advanced Miner', 2048, 1, 2],
  [4, 'Professional Miner', 4096, 1, 1],
  [5, 'Master Miner', 15360, 6, 1],
  [6, 'Ultra Miner', 71680, 36, 1],
  [7, 'Legendary Miner', 299999, 216, 1],
  [8, 'Perfect Miner', 1000000, 1296, 1],
  [9, 'Ludicrous Miner', 10000000, 17500, 1],
];

// level, minerals, gas/s
const AUTOMINES = [
  [1, 32, 1],
  [2, 256, 8],
  [3, 1024, 32],
  [4, 4096, 128],
  [5, 16384, 512],
  [6, 65536, 2048],
  [7, 262144, 8192],
  [8, 1000000, 32768],
];

// tier, gas, minerals, dps, hp
const WARDENS = [
  [1, 35000, 25000, 40960, 20000],
  [2, 100000, 35000, 160000, 60000],
  [3, 5000000, 1000000, 2621350, 500000],
  [4, 10000000, 2500000, 7864050, 2000000],
];

// shop items: [stat..., minerals, gas]
const BLADES = [
  // damage, minerals, gas, attack speed
  [2, 100, 0, 0],
  [4, 200, 0, 0],
  [8, 400, 0, 0],
  [16, 800, 0, 0],
  [32, 1600, 0, 0],
  [64, 3200, 0, 0],
  [128, 6400, 0, 0],
  [256, 12800, 0, 0],
  [256, 25600, 0, 4],
  [1280, 0, 1, 4],
  [2560, 0, 2, 4],
  [5120, 0, 8, 4],
  [20480, 0, 32, 4],
  [40960, 0, 96, 4],
  [61440, 0, 160, 4],
  [81920, 0, 512, 4],
  [260000, 0, 1536, 24],
];
const GLOVES = [
  [0.2, 100],
  [0.4, 200],
  [0.8, 400],
  [1.0, 800],
  [1.5, 1600],
  [2.0, 3200],
  [3.0, 6400],
  [4.0, 12800],
];
const ARMOR = [
  [0.09, 100, 0],
  [0.18, 200, 0],
  [0.27, 400, 0],
  [0.36, 800, 0],
  [0.45, 1600, 0],
  [0.54, 3200, 0],
  [0.63, 6400, 0],
  [0.72, 12800, 0],
  [0.92, 0, 1],
  [0.96, 0, 2],
  [0.98, 0, 8],
  [0.99, 0, 32],
  [0.995, 0, 128],
  [0.9975, 0, 256],
];
const LIFE = [
  [250, 100, 0],
  [500, 200, 0],
  [1000, 400, 0],
  [2000, 800, 0],
  [4000, 1600, 0],
  [8000, 3200, 0],
  [16000, 6400, 0],
  [32000, 12800, 0],
  [160000, 0, 1],
  [320000, 0, 2],
  [471000, 0, 8],
];
const REGEN = [
  [4, 100, 0],
  [8, 200, 0],
  [16, 400, 0],
  [32, 800, 0],
  [64, 1600, 0],
  [128, 3200, 0],
  [256, 6400, 0],
  [512, 12800, 0],
  [2560, 0, 1],
  [5120, 0, 2],
  [20480, 0, 8],
  [61440, 0, 256],
];
const BOOTS = [
  // speed, immune, sight, scanR, scanCd, minerals, gas
  [1, 0, 0, 0, 0, 200, 0],
  [1.3, 1.5, 0, 0, 0, 1600, 0],
  [1.4, 2, 0, 0, 0, 3200, 0],
  [1.5, 2.5, 0, 0, 0, 6400, 0],
  [1.6, 3, 0, 0, 0, 12800, 0],
  [1.7, 3.5, 3.5, 13, 30, 0, 1],
  [1.8, 4, 7, 14, 30, 0, 2],
  [1.9, 4.5, 7, 15, 30, 0, 8],
  [2, 5, 7, 16, 30, 0, 32],
  [2.1, 5.5, 7, 19, 25, 0, 128],
  [2.2, 6, 7, 22, 20, 0, 256],
  [2.3, 6.5, 7, 25, 15, 0, 512],
];

// ------------------------------------------------------------------ stepping & events

function tick(w) {
  w.step();
  if (w.__log) w.__log.push(...w.events);
  w.events.length = 0;
  if (w.__hooks) for (const h of w.__hooks) h(w);
}

function sec(w, s) {
  const n = Math.round(s * T);
  for (let i = 0; i < n && !w.over; i++) tick(w);
}

// steps until pred() is truthy or maxSec of game time passed; returns pred()'s last value
function until(w, pred, maxSec = 30) {
  const n = Math.round(maxSec * T);
  for (let i = 0; i < n; i++) {
    const r = pred();
    if (r) return r;
    if (w.over) break;
    tick(w);
  }
  return pred();
}

// collects the events emitted while fn runs (World.run() throws them away)
function record(w, fn) {
  w.events.length = 0;
  const log = [];
  w.__log = log;
  try {
    fn();
  } finally {
    log.push(...w.events);
    w.events.length = 0;
    w.__log = null;
  }
  return log;
}
const errorsOf = (log, pid) => log.filter((e) => e.e === 'error' && e.owner === pid).map((e) => String(e.msg));

function near(actual, expected, tol) {
  expect(actual).toBeGreaterThanOrEqual(expected - tol);
  expect(actual).toBeLessThanOrEqual(expected + tol);
}

// ------------------------------------------------------------------ world queries

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const HERO_TYPES = ['builder', 'lancerHero', 'hunter', 'spirit'];

function heroOf(w, pid) {
  const p = w.players[pid];
  const u = p.heroId ? w.byId.get(p.heroId) : null;
  if (u && !u.dead) return u;
  return w.units.find((v) => !v.dead && v.owner === pid && HERO_TYPES.includes(v.type)) || null;
}
const heroIds = (w, pid) => {
  const h = heroOf(w, pid);
  return h ? [h.id] : [];
};
const lancerPid = (w) => w.players.findIndex((p) => p.role === 'lancer');
const lancerHero = (w) => w.units.find((u) => !u.dead && u.type === 'lancerHero') || null;
const unitsOf = (w, pid, type) => w.units.filter((u) => !u.dead && u.owner === pid && u.type === type);
const shopOf = (w) => w.entities.find((e) => !e.dead && e.type === 'shop') || null;
function shopPos(w) {
  const s = shopOf(w);
  return s ? { x: s.x, y: s.y } : { x: w.map.cage.x, y: w.map.cage.y };
}
const fields = (w) => w.resources.filter((r) => !r.dead && r.type !== 'vent');
const pickupsOf = (w, type) => (w.pickups || []).filter((k) => k.type === type);
const findB = (w, pid, type, bx, by) =>
  w.buildings.find((b) => !b.dead && b.owner === pid && b.type === type && b.bx === bx && b.by === by) || null;
const ownedBuildings = (w, pid) => w.buildings.filter((b) => !b.dead && b.owner === pid);
const gone = (w, e) => e.dead || !w.byId.has(e.id);
const visibleCell = (w, pid, pt) =>
  w.vision[w.players[pid].team][Math.floor(pt.y) * w.map.width + Math.floor(pt.x)] === 1;
function rectDist(u, b) {
  const dx = Math.max(b.bx - u.x, 0, u.x - (b.bx + b.w));
  const dy = Math.max(b.by - u.y, 0, u.y - (b.by + b.h));
  return Math.hypot(dx, dy);
}
function nearestField(w, u) {
  let best = null;
  for (const f of fields(w)) if (!best || dist(f, u) < dist(best, u)) best = f;
  return best;
}

// teleports a unit (test setup only)
function put(u, x, y) {
  u.x = u.px = x;
  u.y = u.py = y;
  u.nav = null;
  if (u.orders) u.orders.length = 0;
  u.target = null;
  u.guard = null;
  u.swing = null;
}

const waitLancer = (w, maxSec = 45) => until(w, () => lancerHero(w), maxSec);

// ------------------------------------------------------------------ map spots

// distance between a cell rectangle and an entity footprint (bx, by, w, h)
const rectGap = (x, y, w, h, e) =>
  Math.hypot(Math.max(e.bx - (x + w), 0, x - (e.bx + e.w)), Math.max(e.by - (y + h), 0, y - (e.by + e.h)));

// clear(x, y, w, h): every cell buildable, pathable and unoccupied (summed-area table)
function clearTable(w) {
  const { width: W, height: H } = w.map;
  const g = w.grid;
  const R = W + 1;
  const S = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ok = g.buildable(x, y) && g.pathable(x, y) ? 1 : 0;
      S[(y + 1) * R + x + 1] = ok + S[y * R + x + 1] + S[(y + 1) * R + x] - S[y * R + x];
    }
  }
  return (x, y, sw, sh) => {
    if (x < 0 || y < 0 || x + sw > W || y + sh > H) return false;
    return S[(y + sh) * R + x + sw] - S[y * R + x + sw] - S[(y + sh) * R + x] + S[y * R + x] === sw * sh;
  };
}

// a sw x sh block of free cells away from the Shop, outside the gold lock and other test bases
function findArea(w, sw, sh, { minShop = 20, goldGap = 11, avoid = [] } = {}) {
  const { width: W, height: H } = w.map;
  const clear = clearTable(w);
  const shop = shopPos(w);
  const gold = fields(w).filter((r) => r.rich);
  const busy = w.units.filter((u) => !u.dead);
  let best = null;
  for (let y = 1; y + sh < H - 1; y++) {
    for (let x = 1; x + sw < W - 1; x++) {
      if (!clear(x, y, sw, sh)) continue;
      const c = { x: x + sw / 2, y: y + sh / 2 };
      const ds = dist(c, shop);
      if (ds < minShop) continue;
      if (gold.some((r) => rectGap(x, y, sw, sh, r) < goldGap)) continue;
      if (avoid.some((a) => x < a.x + a.sw + 4 && a.x < x + sw + 4 && y < a.y + a.sh + 4 && a.y < y + sh + 4)) continue;
      if (busy.some((u) => u.x > x - 1 && u.x < x + sw + 1 && u.y > y - 1 && u.y < y + sh + 1)) continue;
      if (!best || ds < best.ds) best = { x, y, sw, sh, ds, cx: c.x, cy: c.y };
    }
  }
  return best;
}

// A private 12x14 test base; the Shaper hero is moved to its free bottom rows (test setup).
// Slots 0..8 are 4x4 cells in 3 columns (room for a 2x2 or 3x3 structure plus a corridor);
// rows 12-13 (and 10-11 next to 2x2 structures) stay free for walking.
function makeBase(w, pid) {
  const a = findArea(w, 12, 14, { avoid: w.__areas }) || findArea(w, 12, 14, { avoid: w.__areas, minShop: 12 });
  if (!a) throw new Error('no free 12x14 area on the survival map');
  w.__areas.push(a);
  const b = {
    ...a,
    slot: (i) => ({ bx: a.x + (i % 3) * 4, by: a.y + Math.floor(i / 3) * 4 }),
    home: { x: a.x + 6.5, y: a.y + 12.5 },
  };
  const h = heroOf(w, pid);
  if (h) put(h, b.home.x, b.home.y);
  return b;
}

// a 3x3 depot spot outside the gold lock whose nearest mineral field is a gold one
function depotNearGold(w) {
  const { width: W, height: H } = w.map;
  const clear = clearTable(w);
  const shop = shopPos(w);
  const all = fields(w);
  const gold = all.filter((r) => r.rich);
  let best = null;
  for (let y = 2; y < H - 6; y++) {
    for (let x = 2; x < W - 6; x++) {
      if (!clear(x - 1, y - 1, 5, 5)) continue;
      const c = { x: x + 1.5, y: y + 1.5 };
      if (dist(c, shop) < 14) continue;
      let dg = Infinity;
      for (const r of gold) dg = Math.min(dg, rectGap(x, y, 3, 3, r));
      if (dg < 11.5) continue;
      let nf = null;
      for (const r of all) if (!nf || dist(r, c) < dist(nf, c)) nf = r;
      if (!nf || !nf.rich) continue;
      if (!best || dg < best.dg) best = { bx: x, by: y, dg };
    }
  }
  return best;
}

// a 2x2 spot well inside the gold lock (a few cells from a gold field)
function goldSpot(w) {
  const { width: W, height: H } = w.map;
  const clear = clearTable(w);
  const shop = shopPos(w);
  const gold = fields(w).filter((r) => r.rich);
  for (let y = 2; y < H - 3; y++) {
    for (let x = 2; x < W - 3; x++) {
      if (!clear(x, y, 2, 2)) continue;
      if (dist({ x: x + 1, y: y + 1 }, shop) < 12) continue;
      let dg = Infinity;
      for (const r of gold) dg = Math.min(dg, rectGap(x, y, 2, 2, r));
      if (dg >= 2 && dg <= 5) return { bx: x, by: y };
    }
  }
  return null;
}

// a low open cell with a higher open cell 4-6.5 cells away (not visible from below)
function cliffSpot(w) {
  const { width: W, height: H, level, flags } = w.map;
  const g = w.grid;
  const shop = shopPos(w);
  const open = (x, y) => {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (!g.pathable(x + ox, y + oy) || flags[(y + oy) * W + x + ox] & CELL_RAMP) return false;
      }
    }
    return true;
  };
  for (let y = 3; y < H - 3; y++) {
    for (let x = 3; x < W - 3; x++) {
      if (Math.hypot(x - shop.x, y - shop.y) < 16 || !open(x, y)) continue;
      const l = level[y * W + x];
      for (let oy = -6; oy <= 6; oy++) {
        for (let ox = -6; ox <= 6; ox++) {
          const d = Math.hypot(ox, oy);
          if (d < 4 || d > 6.5) continue;
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 3 || ny < 3 || nx >= W - 3 || ny >= H - 3) continue;
          const hl = level[ny * W + nx];
          if (hl <= l || !open(nx, ny)) continue;
          let same = true;
          for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (level[(ny + a) * W + nx + b] !== hl) same = false;
          if (same) return { low: { x: x + 0.5, y: y + 0.5 }, high: { x: nx + 0.5, y: ny + 0.5 } };
        }
      }
    }
  }
  return null;
}

// ------------------------------------------------------------------ hooks (test setup only)

// random gas bonus pickups would disturb exact gas bookkeeping
function stripGasBonuses(w) {
  const k = w.pickups;
  if (!Array.isArray(k)) return;
  for (let i = k.length - 1; i >= 0; i--) if (k[i].type === 'gasBonus') k.splice(i, 1);
}

// moves the Lancer, as soon as it arrives, as far as possible from the Shop and every Shaper entity
function parkLancer(w) {
  const L = lancerHero(w);
  if (!L || L.__parked) return;
  L.__parked = true;
  const others = w.entities.filter(
    (e) => !e.dead && e.owner >= 0 && e.owner !== L.owner && (e.kind === 'unit' || e.kind === 'building'),
  );
  const shop = shopPos(w);
  const g = w.grid;
  let best = null;
  let bestD = -1;
  for (let y = 3; y < w.map.height - 4; y += 2) {
    for (let x = 3; x < w.map.width - 4; x += 2) {
      if (!g.pathable(x, y) || !g.pathable(x + 1, y) || !g.pathable(x, y + 1) || !g.pathable(x + 1, y + 1)) continue;
      let d = Math.hypot(x - shop.x, y - shop.y);
      for (const e of others) d = Math.min(d, Math.hypot(e.x - x, e.y - y));
      if (d > bestD) {
        bestD = d;
        best = { x: x + 1, y: y + 1 };
      }
    }
  }
  if (best) put(L, best.x, best.y);
}

// ------------------------------------------------------------------ game factory & commands

function game(o = {}) {
  const { shapers = 1, lancer = true, seed = 7, pace, duration, bases = true, bonuses = false, park = false } = o;
  let players = o.players;
  if (!players) {
    players = [];
    for (let i = 0; i < shapers; i++) players.push({ name: `Shaper ${i + 1}`, type: 'human', role: 'shaper' });
    if (lancer) players.push({ name: 'Lancer', type: 'human', role: 'lancer' });
  }
  const opts = { mapId: MAP, players, seed, mode: 'survival' };
  if (pace !== undefined) opts.pace = pace;
  if (duration !== undefined) opts.duration = duration;
  const w = new World(opts);
  w.__hooks = [];
  w.__areas = [];
  w.__bases = {};
  if (!bonuses) w.__hooks.push(stripGasBonuses);
  if (park) w.__hooks.push(parkLancer);
  if (bases) for (const p of w.players) if (p.role === 'shaper') w.__bases[p.id] = makeBase(w, p.id);
  return w;
}
const base = (w, pid) => w.__bases[pid];

const buildCmd = (w, pid, type, s, extra = {}) => ({ type: 'build', ids: heroIds(w, pid), building: type, bx: s.bx, by: s.by, ...extra });

function placeAt(w, pid, type, s, extra = {}, maxSec = 20) {
  w.issue(pid, buildCmd(w, pid, type, s, extra));
  return until(w, () => findB(w, pid, type, s.bx, s.by), maxSec);
}

function buildAt(w, pid, type, s, extra = {}, maxSec = 45) {
  const b = placeAt(w, pid, type, s, extra);
  if (!b) return null;
  until(w, () => b.built || b.dead, maxSec);
  return b.built && !b.dead ? b : null;
}

const upgradeCmd = (w, pid, b) => ({ type: 'upgrade', ids: heroIds(w, pid), id: b.id });
const salvageCmd = (w, pid, b) => ({ type: 'salvage', ids: heroIds(w, pid), id: b.id });
const tradeCmd = (w, pid, op, lots) => ({ type: 'trade', ids: heroIds(w, pid), op, lots });

function upgradeTo(w, pid, b, level, perStep = 15) {
  while (b && !b.dead && b.level < level) {
    const from = b.level;
    w.issue(pid, upgradeCmd(w, pid, b));
    if (!until(w, () => b.level > from && !(b.upgrading > 0), perStep)) return false;
  }
  return !!b && b.level === level;
}

// issues an upgrade, reports whether it started, and lets it finish
function tryUpgrade(w, pid, b) {
  const from = b.level;
  w.issue(pid, upgradeCmd(w, pid, b));
  sec(w, 0.5);
  const started = b.level !== from || b.upgrading > 0;
  if (started) until(w, () => !(b.upgrading > 0), 15);
  return started;
}

function pick(w, pid, a) {
  w.issue(pid, { type: 'pickAbilities', ids: heroIds(w, pid), a });
  sec(w, 0.1);
}
const cast = (w, pid, ability, extra = {}) => w.issue(pid, { type: 'ability', ids: heroIds(w, pid), ability, ...extra });
const shopCmd = (w, pid, cmd) => w.issue(pid, { ids: heroIds(w, pid), ...cmd });

function digest(w) {
  const r = (v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);
  return JSON.stringify({
    tick: w.tick,
    over: w.over,
    winner: w.winnerTeam,
    sv: w.survival && [w.survival.phase, r(w.survival.price), w.survival.winner],
    players: w.players.map((p) => [p.role, p.form, p.team, p.alive, r(p.gas), r(p.minerals), p.items, p.abilities, p.heroId]),
    units: w.units.filter((u) => !u.dead).map((u) => [u.id, u.type, u.owner, r(u.x), r(u.y), r(u.hp), r(u.barrier)]),
    buildings: w.buildings
      .filter((b) => !b.dead)
      .map((b) => [b.id, b.type, b.owner, b.bx, b.by, b.level, r(b.hp), b.built, r(b.upgrading)]),
    pickups: (w.pickups || []).map((k) => [k.id, k.type, r(k.x), r(k.y), r(k.amount)]),
  });
}

// =========================================================================================

describe('survival data tables (sections 4, 7, 15)', () => {
  it('exposes the SURVIVAL constants from the spec', () => {
    expect(data.SURVIVAL).toMatchObject({
      lancerSpawn: 40,
      unlockTime: 300,
      shopRadius: 8,
      shopHealPct: 0.25,
      lancerStartMinerals: 40,
      passiveIncome: 1,
      marketStartPrice: 155,
      marketStep: 5,
      marketMinPrice: 20,
      gasBonusEvery: 40,
      gasBonusMax: 6,
      gasBonusAmount: 10,
      palletLife: 90,
      salvageTime: 3,
      maxMiners: 15,
      minersPerField: 3,
      goldLockRadius: 10,
      spiritRespawn: 60,
      spiritInvuln: 30,
      hunterRespawn: 20,
      formChoiceTime: 15,
      abilityPickTime: 20,
      maxItems: 6,
      gasExchangeRate: 64000,
    });
    expect(sim.SHAPER_TEAM).toBe(1);
    expect(sim.LANCER_TEAM).toBe(2);
  });

  it('Generator levels: costs, minerals from level 6, income, pallets, HP, 92% DR from level 5 and requirements', () => {
    const G = data.GENERATOR_LEVELS;
    expect(G).toHaveLength(10);
    for (const r of GEN) {
      const g = G[r.level - 1];
      const tag = `Generator ${r.level}`;
      expect(g.level, tag).toBe(r.level);
      expect(g.gas, `${tag} gas`).toBe(r.gas);
      expect(g.minerals ?? 0, `${tag} minerals`).toBe(r.minerals);
      expect(g.income, `${tag} income`).toBe(r.income);
      expect(g.pallet || 0, `${tag} pallet`).toBe(r.pallet);
      expect(g.hp, `${tag} hp`).toBe(r.hp);
      expect(g.dr ?? 0, `${tag} dr`).toBeCloseTo(r.level >= 5 ? 0.92 : 0, 6);
      if (!r.req) expect(g.requires ?? null, `${tag} requires`).toBeNull();
      else expect(g.requires, `${tag} requires`).toMatchObject({ type: r.req[0], level: r.req[1] });
    }
  });

  it('Wall tiers: costs, HP, shields, damage reduction, names and build times', () => {
    const W = data.WALL_LEVELS;
    expect(W).toHaveLength(18);
    for (const r of WALLS) {
      const wl = W[r.level - 1];
      const tag = r.name;
      expect(wl.level, tag).toBe(r.level);
      expect(wl.name, tag).toBe(r.name);
      expect(data.wallName(r.level), tag).toBe(r.name);
      expect(wl.gas, `${tag} gas`).toBe(r.gas);
      expect(wl.minerals ?? 0, `${tag} minerals`).toBe(r.minerals);
      expect(wl.hp, `${tag} hp`).toBe(r.hp);
      expect(wl.shield ?? 0, `${tag} shield`).toBe(r.shield);
      expect(wl.dr ?? 0, `${tag} dr`).toBeCloseTo(r.dr, 6);
      expect(wl.time, `${tag} time`).toBe(wallTime(r.level));
    }
  });

  it('Market levels', () => {
    const M = data.MARKET_LEVELS;
    expect(M).toHaveLength(3);
    for (const [level, name, gas, hp] of MARKETS) {
      expect(M[level - 1]).toMatchObject({ level, name, gas, hp });
      expect(M[level - 1].time).toBe(level === 1 ? 5 : 3);
    }
  });

  it('Turret levels and the direct Turret 6 / Turret 11 builds', () => {
    const TL = data.TURRET_LEVELS;
    expect(TL).toHaveLength(14);
    for (const r of TURRETS) {
      const t = TL[r.level - 1];
      const tag = `Turret ${r.level}`;
      expect(t.level, tag).toBe(r.level);
      expect(t.gas, `${tag} gas`).toBe(r.gas);
      expect(t.minerals ?? 0, `${tag} minerals`).toBe(r.minerals);
      expect(t.damage, `${tag} damage`).toBe(r.damage);
      expect(t.cooldown, `${tag} cooldown`).toBeCloseTo(r.cooldown, 6);
      expect(t.range, `${tag} range`).toBe(r.range);
      expect(t.hp, `${tag} hp`).toBe(r.hp);
      if (r.level <= 10) expect(t.time, `${tag} time`).toBe(4);
      if (r.level >= 12) expect(t.time, `${tag} time`).toBe(5);
      if (!r.req) expect(t.requires ?? null, `${tag} requires`).toBeNull();
      else if (r.req[0] === 'library') expect(t.requires, `${tag} requires`).toMatchObject({ type: 'library' });
      else expect(t.requires, `${tag} requires`).toMatchObject({ type: 'market', level: r.req[1] });
    }
    expect(data.TURRET_DIRECT).toMatchObject({
      6: { requires: { type: 'market', level: 1 }, time: 20 },
      11: { requires: { type: 'library' }, time: 30 },
    });
  });

  it('Miner tiers, Auto Mine levels and Warden tiers', () => {
    expect(data.MINER_TIERS).toHaveLength(9);
    for (const [tier, name, gas, amount, interval] of MINERS) {
      expect(data.MINER_TIERS[tier - 1], name).toMatchObject({ tier, name, gas, amount, interval, trainTime: tier >= 6 ? 10 : 5 });
    }
    expect(data.AUTOMINE_LEVELS).toHaveLength(8);
    for (const [level, minerals, income] of AUTOMINES) {
      expect(data.AUTOMINE_LEVELS[level - 1], `Auto Mine ${level}`).toMatchObject({ level, minerals, income });
    }
    expect(data.WARDEN_TIERS).toHaveLength(4);
    for (const [tier, gas, minerals, dps, hp] of WARDENS) {
      expect(data.WARDEN_TIERS[tier - 1], `Warden ${tier}`).toMatchObject({ tier, gas, minerals, dps, hp });
    }
  });

  it('static building definitions: sizes, fixed HP, build times and salvageability', () => {
    const SB = data.SURVIVAL_BUILDINGS;
    const sizes = { generator: 2, wall: 2, turret: 2, market: 2, depot: 3, autoMine: 2, library: 3, detector: 2, shop: 5 };
    for (const [id, size] of Object.entries(sizes)) expect(SB[id]?.size, id).toBe(size);
    expect(SB.depot).toMatchObject({ hp: 200, buildTime: 10 });
    expect(SB.autoMine).toMatchObject({ hp: 100, buildTime: 5 });
    expect(SB.library).toMatchObject({ hp: 300, buildTime: 20 });
    expect(SB.detector).toMatchObject({ hp: 200, buildTime: 10 });
    expect(SB.generator.buildTime).toBe(2);
    expect(SB.market.buildTime).toBe(5);
    expect(SB.turret.buildTime).toBe(4);
    for (const id of ['generator', 'wall', 'turret', 'market', 'depot', 'library']) expect(SB[id].salvage, id).toBe(true);
    expect(SB.autoMine.salvage).toBe(false);
  });

  it('build and cumulative costs', () => {
    const cost = (type, level) => {
      const c = sim.buildCost(type, level);
      return { gas: c.gas ?? 0, minerals: c.minerals ?? 0 };
    };
    expect(cost('generator', 1)).toEqual({ gas: 0, minerals: 0 });
    expect(cost('wall', 1)).toEqual({ gas: 4, minerals: 0 });
    expect(cost('turret', 1)).toEqual({ gas: 8, minerals: 0 });
    expect(cost('turret', 6)).toEqual({ gas: 512, minerals: 0 });
    expect(cost('turret', 11)).toEqual({ gas: 16384, minerals: 15240 });
    expect(cost('market', 1)).toEqual({ gas: 64, minerals: 0 });
    expect(cost('depot', 1)).toEqual({ gas: 256, minerals: 0 });
    expect(cost('library', 1)).toEqual({ gas: 4096, minerals: 256 });
    expect(cost('detector', 1)).toEqual({ gas: 9999, minerals: 1024 });
    expect(cost('autoMine', 1)).toEqual({ gas: 0, minerals: 32 });
    expect(cost('autoMine', 3)).toEqual({ gas: 0, minerals: 1024 });
    expect(data.cumulativeCost(data.TURRET_LEVELS, 6)).toMatchObject({ gas: 512, minerals: 0 });
    expect(data.cumulativeCost(data.GENERATOR_LEVELS, 10)).toMatchObject({ gas: 25550, minerals: 992 });
    expect(data.cumulativeCost(data.WALL_LEVELS, 13)).toMatchObject({ gas: 32764, minerals: 224 });
  });

  it('shop items have the spec prices and stats; weapon, life and regen stack, the rest do not', () => {
    const items = data.SHOP_ITEMS;
    const chk = (id, o) => {
      const it = items[id];
      expect(it, id).toBeTruthy();
      expect(it.id).toBe(id);
      for (const [k, v] of Object.entries(o)) expect(it[k] ?? 0, `${id}.${k}`).toBeCloseTo(v, 6);
    };
    BLADES.forEach(([damage, minerals, gas, as], i) => chk(`blade${i + 1}`, { damage, minerals, gas, as }));
    GLOVES.forEach(([as, minerals], i) => chk(`glove${i + 1}`, { as, minerals, gas: 0, damage: 0 }));
    ARMOR.forEach(([dr, minerals, gas], i) => chk(`armor${i + 1}`, { dr, minerals, gas }));
    LIFE.forEach(([hp, minerals, gas], i) => chk(`life${i + 1}`, { hp, minerals, gas }));
    REGEN.forEach(([regen, minerals, gas], i) => chk(`regen${i + 1}`, { regen, minerals, gas }));
    BOOTS.forEach(([speed, immune, sight, scanR, scanCd, minerals, gas], i) =>
      chk(`boots${i + 1}`, { speed, immune, sight, scanR, scanCd, minerals, gas }),
    );
    chk('immune1', { immune: 3, minerals: 200, gas: 0 });
    chk('sight1', { sight: 7, minerals: 200, gas: 0 });

    const cats = Object.fromEntries(data.SHOP_CATEGORIES.map((c) => [c.id, c]));
    expect(data.SHOP_CATEGORIES[0]).toMatchObject({ id: 'weapon', stack: true });
    expect(items.blade1.cat).toBe('weapon');
    for (const id of ['blade1', 'life1', 'regen1']) expect(cats[items[id].cat]?.stack, id).toBe(true);
    const single = ['glove1', 'armor1', 'boots1', 'immune1', 'sight1'];
    for (const id of single) expect(cats[items[id].cat]?.stack, id).toBe(false);
    expect(new Set(single.map((id) => items[id].cat)).size).toBe(5);
    expect(items.blade17.cat).toBe(items.blade1.cat);
    expect(items.glove8.cat).toBe(items.glove1.cat);
    expect(items.boots12.cat).toBe(items.boots1.cat);
  });

  it('ability tables', () => {
    const S = data.SHAPER_ABILITIES;
    expect(S.stasis).toMatchObject({ row: 'control', range: 8, cooldown: 30, duration: 4 });
    expect(S.overcharge).toMatchObject({ row: 'control', range: 9, cooldown: 12, duration: 4 });
    expect(S.barrierField).toMatchObject({ row: 'control', range: 9, cooldown: 20, duration: 4 });
    expect(S.invuln).toMatchObject({ row: 'control', range: 9, cooldown: 30, duration: 4 });
    expect(S.blink).toMatchObject({ row: 'mobility', range: 8, cooldown: 10 });
    expect(S.farBlink).toMatchObject({ row: 'mobility', range: 8, cooldown: 30 });
    expect(S.recall).toMatchObject({ row: 'mobility', range: 30, cooldown: 45 });
    expect(S.swift).toMatchObject({ row: 'mobility' });
    expect(S.cloak).toMatchObject({ row: 'mobility', cooldown: 45, duration: 10 });
    const L = data.LANCER_ABILITIES;
    expect(L.scan).toMatchObject({ cooldown: 30, duration: 12 });
    expect(L.return).toMatchObject({ cooldown: 180 });
    expect(L.cloak).toMatchObject({ cooldown: 60, duration: 10 });
    const P = data.SPIRIT_ABILITIES;
    expect(P.overcharge).toMatchObject({ cooldown: 12 });
    expect(P.decay).toMatchObject({ range: 7, cooldown: 20, duration: 5 });
    expect(P.cloak).toMatchObject({ cooldown: 30, duration: 10 });
  });

  it('lancerStats: weapons/life/regen add up, attack speed/armor/boots/sight/immunity use the best item', () => {
    const S = data.lancerStats;
    const b = S([]);
    expect(b).toMatchObject({ hp: 500, regen: 0, dr: 0, damage: 5, sight: 9, immune: 6, scanR: 13, scanCd: 30 });
    expect(b.as).toBe(0);
    expect(b.cooldown).toBeCloseTo(1, 6);
    expect(b.speed).toBeCloseTo(4.2, 6);
    expect(S([], 'hunter').hp).toBe(250);
    expect(S(['life1'], 'hunter').hp).toBe(500);
    // damage = 5 + sum of weapons
    expect(S(['blade1', 'blade1', 'blade3']).damage).toBe(17);
    // attack speed bonus = max, cooldown = 1 / (1 + bonus)
    expect(S(['glove1', 'glove2']).as).toBeCloseTo(0.4, 6);
    expect(S(['glove1', 'glove2']).cooldown).toBeCloseTo(1 / 1.4, 6);
    expect(S(['blade9', 'glove8']).as).toBeCloseTo(4, 6);
    expect(S(['blade9', 'glove8']).cooldown).toBeCloseTo(0.2, 6);
    expect(S(['blade17', 'blade9', 'glove1']).cooldown).toBeCloseTo(1 / 25, 6);
    // dr = best armor
    expect(S(['armor1', 'armor3']).dr).toBeCloseTo(0.27, 6);
    // life and regen stack
    expect(S(['life1', 'life1', 'life2']).hp).toBe(1500);
    expect(S(['regen1', 'regen2', 'regen2']).regen).toBe(20);
    // boots: speed bonus is the best one
    expect(S(['boots1', 'boots3']).speed).toBeCloseTo(5.6, 6);
    // Ring of Sight and boots sight don't add up
    expect(S(['sight1']).sight).toBe(16);
    expect(S(['boots6']).sight).toBeCloseTo(12.5, 6);
    expect(S(['sight1', 'boots7']).sight).toBe(16);
    // spell immunity time = 6 + best bonus
    expect(S(['immune1', 'boots2']).immune).toBeCloseTo(9, 6);
    expect(S(['boots5']).immune).toBeCloseTo(9, 6);
    // scan radius / cooldown from the boots
    expect(S(['boots10'])).toMatchObject({ scanR: 19, scanCd: 25 });
    expect(S(['boots12'])).toMatchObject({ scanR: 25, scanCd: 15 });
  });
});

// =========================================================================================

describe('setup and flow (section 1)', () => {
  it('gives the Lancer role to the first player asking for it; everybody else becomes a Shaper', () => {
    const w = game({
      bases: false,
      players: [
        { name: 'A', type: 'human', role: 'lancer' },
        { name: 'B', type: 'human', role: 'lancer' },
        { name: 'C', type: 'human', role: 'shaper' },
      ],
    });
    expect(w.players.map((p) => p.role)).toEqual(['lancer', 'shaper', 'shaper']);
    expect(w.players.map((p) => p.form)).toEqual(['lancer', 'shaper', 'shaper']);
    expect(w.players.map((p) => p.team)).toEqual([2, 1, 1]);
    expect(w.isAllied(1, 2)).toBe(true);
    expect(w.areEnemies(0, 1)).toBe(true);
    expect(heroOf(w, 1)?.type).toBe('builder');
    expect(heroOf(w, 2)?.type).toBe('builder');
    expect(w.players[1].alive).toBe(true);
    expect(w.units.some((u) => u.type === 'lancerHero')).toBe(false);
  });

  it('picks exactly one Lancer with the world rng when nobody asks for it', () => {
    const mk = (seed) =>
      game({
        bases: false,
        seed,
        players: [0, 1, 2, 3].map((i) => (i % 2 ? { name: `P${i}`, type: 'human', role: 'shaper' } : { name: `P${i}`, type: 'human' })),
      });
    for (let seed = 1; seed <= 6; seed++) {
      const roles = mk(seed).players.map((p) => p.role);
      expect(roles.filter((r) => r === 'lancer'), `seed ${seed}`).toHaveLength(1);
      expect(roles.filter((r) => r === 'shaper'), `seed ${seed}`).toHaveLength(3);
    }
    expect(mk(9).players.map((p) => p.role)).toEqual(mk(9).players.map((p) => p.role));
  });

  it('accepts the legacy role names builder and hunter', () => {
    const w = game({
      bases: false,
      players: [
        { name: 'B', type: 'human', role: 'builder' },
        { name: 'H', type: 'human', role: 'hunter' },
      ],
    });
    expect(w.players.map((p) => p.role)).toEqual(['shaper', 'lancer']);
  });

  it('places a neutral, invulnerable, blocking 5x5 Shop at map.cage and rings every Shaper around it', () => {
    const players = [];
    for (let i = 0; i < 9; i++) players.push({ name: `S${i}`, type: 'human', role: 'shaper' });
    players.push({ name: 'L', type: 'human', role: 'lancer' });
    const w = game({ bases: false, players });
    const shop = shopOf(w);
    expect(shop).toBeTruthy();
    expect(shop.owner).toBe(-1);
    expect(shop.w).toBe(5);
    expect(shop.h).toBe(5);
    expect(dist(shop, w.map.cage)).toBeLessThanOrEqual(1);
    expect(w.grid.pathable(Math.floor(shop.x), Math.floor(shop.y))).toBe(false);
    const hp = shop.hp;
    applyDamage(w, shop, 1e6, null);
    expect(shop.dead).toBe(false);
    expect(shop.hp).toBe(hp);

    const heroes = w.players.filter((p) => p.role === 'shaper').map((p) => heroOf(w, p.id));
    expect(heroes).toHaveLength(9);
    for (const h of heroes) {
      expect(h.type).toBe('builder');
      expect(h.maxHp).toBe(20);
      expect(h.maxBarrier).toBe(20);
      expect(h.hp).toBe(20);
      expect(h.barrier).toBe(20);
      expect(h.r).toBeCloseTo(0.4, 6);
      const d = dist(h, shop);
      expect(d).toBeGreaterThanOrEqual(5);
      expect(d).toBeLessThanOrEqual(10);
    }
    for (let i = 0; i < heroes.length; i++) for (let j = i + 1; j < heroes.length; j++) expect(dist(heroes[i], heroes[j])).toBeGreaterThan(0.5);
  });

  it('starts Shapers at 0 gas / 0 minerals and the Lancer at 40 minerals; the Lancer arrives at the Shop at 0:40', () => {
    const w = game();
    const lp = lancerPid(w);
    expect(lp).toBe(1);
    expect(w.players[0].gas).toBe(0);
    expect(w.players[0].minerals).toBe(0);
    expect(w.players[lp].minerals).toBe(40);
    expect(w.players[lp].items).toEqual([]);
    expect(w.players[0].abilities).toEqual([]);
    expect(Array.isArray(w.pickups)).toBe(true);
    const sv = w.survival;
    expect(sv.phase).toBe('pregame');
    expect(sv.price).toBe(155);
    expect(sv.endTick).toBe(-1);
    expect(Math.abs(sv.lancerTick - 40 * T)).toBeLessThanOrEqual(1);
    expect(Math.abs(sv.unlockTick - 300 * T)).toBeLessThanOrEqual(1);

    sec(w, 39);
    expect(lancerHero(w)).toBeNull();
    expect(sim.gameTime(w)).toBeCloseTo(39, 6);
    const log = record(w, () => until(w, () => lancerHero(w), 2.5));
    const L = lancerHero(w);
    expect(L).toBeTruthy();
    near(w.tick / T, 40, 0.6);
    expect(L.owner).toBe(lp);
    expect(w.players[lp].heroId).toBe(L.id);
    expect(w.players[lp].alive).toBe(true);
    expect(dist(L, shopPos(w))).toBeLessThanOrEqual(8);
    expect(L.maxHp).toBe(500);
    expect(L.hp).toBe(500);
    expect(L.r).toBeCloseTo(0.9, 6);
    expect(L.damage).toBe(5);
    expect(L.strikeCooldown).toBeCloseTo(1, 6);
    expect(L.dr ?? 0).toBe(0);
    expect(L.regen ?? 0).toBe(0);
    expect(w.survival.phase).toBe('hunt');
    expect(log.some((e) => e.e === 'lancerArrives')).toBe(true);
  });

  it('lets the Lancer shop before arriving', () => {
    const w = game();
    const lp = lancerPid(w);
    const Lp = w.players[lp];
    sec(w, 5);
    Lp.minerals += 100; // test setup
    const m = Lp.minerals;
    w.issue(lp, { type: 'buy', ids: [], item: 'blade1' });
    sec(w, 0.2);
    expect(Lp.items).toEqual(['blade1']);
    near(Lp.minerals, m - 100, 0.5);
    const L = waitLancer(w);
    expect(L).toBeTruthy();
    expect(L.damage).toBe(7);
  });
});

// =========================================================================================

describe('Shaper economy (section 4)', () => {
  it('builds a free Generator 1 (2x2, 200 HP, 2 s) that yields 1 gas per second', () => {
    const w = game();
    const p = w.players[0];
    const gen = placeAt(w, 0, 'generator', base(w, 0).slot(0));
    expect(gen).toBeTruthy();
    expect(p.gas).toBe(0);
    const placed = w.tick;
    until(w, () => gen.built, 5);
    expect(gen.built).toBe(true);
    near((w.tick - placed) / T, 2, 0.6);
    expect(gen.w).toBe(2);
    expect(gen.h).toBe(2);
    expect(gen.level).toBe(1);
    expect(gen.maxHp).toBe(200);
    expect(gen.dr ?? 0).toBe(0);
    expect(gen.invested).toMatchObject({ gas: 0, minerals: 0 });
    const g0 = p.gas;
    sec(w, 10);
    near(p.gas - g0, 10, 1);
  });

  it('multiplies generator income by the pace option', () => {
    for (const pace of [2, 4]) {
      const w = game({ pace });
      expect(w.options.pace).toBe(pace);
      const gen = buildAt(w, 0, 'generator', base(w, 0).slot(0));
      expect(gen, `pace ${pace}`).toBeTruthy();
      const p = w.players[0];
      const g0 = p.gas;
      sec(w, 10);
      near(p.gas - g0, 10 * pace, pace);
    }
  });

  it('allows only one Generator per Shaper, counting one under construction', () => {
    const w = game();
    const B = base(w, 0);
    const first = placeAt(w, 0, 'generator', B.slot(0));
    expect(first).toBeTruthy();
    expect(first.built).toBe(false);
    const log = record(w, () => {
      w.issue(0, buildCmd(w, 0, 'generator', B.slot(2)));
      sec(w, 5);
    });
    expect(first.built).toBe(true);
    expect(w.buildings.filter((b) => !b.dead && b.owner === 0 && b.type === 'generator')).toHaveLength(1);
    expect(errorsOf(log, 0).some((m) => /one generator/i.test(m))).toBe(true);
    expect(sim.canPlaceSurvival(w, 0, 'generator', B.slot(2).bx, B.slot(2).by, 1).ok).toBe(false);
  });

  it(
    'enforces every Generator upgrade requirement and charges the table cost (minerals from level 6)',
    () => {
      const w = game();
      const p = w.players[0];
      const B = base(w, 0);
      p.gas = 200000; // test setup
      p.minerals = 2000;
      const gen = buildAt(w, 0, 'generator', B.slot(0));
      expect(gen).toBeTruthy();
      let wall = null;
      let market = null;
      const satisfy = ([type, level]) => {
        if (type === 'wall') {
          if (!wall) wall = buildAt(w, 0, 'wall', B.slot(1));
          expect(wall).toBeTruthy();
          expect(upgradeTo(w, 0, wall, level), `Wall ${level}`).toBe(true);
        } else {
          if (!market) market = buildAt(w, 0, 'market', B.slot(2));
          expect(market).toBeTruthy();
          expect(upgradeTo(w, 0, market, level), `Market ${level}`).toBe(true);
        }
      };
      for (let L = 2; L <= 10; L++) {
        const row = GEN[L - 1];
        const old = GEN[L - 2];
        // without the wall / market the upgrade doesn't start
        expect(tryUpgrade(w, 0, gen), `Generator ${L} without ${row.req.join(' ')}`).toBe(false);
        expect(gen.level).toBe(L - 1);
        satisfy(row.req);
        if (L === 6) {
          const m = p.minerals;
          p.minerals = 31; // one short of the 32 minerals
          expect(tryUpgrade(w, 0, gen), 'Generator 6 without 32 minerals').toBe(false);
          p.minerals = m;
        }
        const before = { gas: p.gas, minerals: p.minerals };
        const startTick = w.tick;
        w.issue(0, upgradeCmd(w, 0, gen));
        tick(w);
        expect(gen.upgrading, `Generator ${L} upgrade started`).toBeGreaterThan(4);
        expect(gen.upgrading).toBeLessThanOrEqual(5);
        const spent = before.gas - p.gas;
        expect(spent, `Generator ${L} gas`).toBeGreaterThanOrEqual(row.gas - old.income - 0.01);
        expect(spent, `Generator ${L} gas`).toBeLessThanOrEqual(row.gas + 0.01);
        expect(before.minerals - p.minerals, `Generator ${L} minerals`).toBeCloseTo(row.minerals, 6);
        if (L === 2) {
          // keeps producing at the old rate while upgrading
          const g0 = p.gas;
          sec(w, 4);
          near(p.gas - g0, 4, 1);
        }
        until(w, () => gen.level === L && !(gen.upgrading > 0), 8);
        expect(gen.level).toBe(L);
        near((w.tick - startTick) / T, 5, 0.6);
        expect(gen.maxHp, `Generator ${L} hp`).toBe(row.hp);
        expect(gen.hp).toBeCloseTo(row.hp, 6);
        expect(gen.dr ?? 0, `Generator ${L} dr`).toBeCloseTo(L >= 5 ? 0.92 : 0, 6);
        const g0 = p.gas;
        sec(w, 1);
        near(p.gas - g0, row.income, row.income * 0.1 + 0.5);
      }
      expect(tryUpgrade(w, 0, gen)).toBe(false); // max level
      expect(gen.level).toBe(10);
      expect(gen.invested).toMatchObject({ gas: 25550, minerals: 992 });
      expect(wall.level).toBe(13);
      expect(wall.maxHp).toBe(40960);
      expect(wall.dr).toBeCloseTo(0.16, 6);
      expect(wall.invested).toMatchObject({ gas: 32764, minerals: 224 });
      expect(market.level).toBe(2);
      expect(market.invested).toMatchObject({ gas: 320, minerals: 0 });
      expect(p.minerals).toBeCloseTo(2000 - 992 - 224, 6);
      // 92% damage reduction
      applyDamage(w, gen, 1000, null);
      expect(gen.hp).toBeCloseTo(6000 - 80, 4);
    },
    LONG,
  );

  it('builds Walls at level 1 for 4 gas and upgrades them in place, raising HP by the max-HP difference', () => {
    const w = game();
    const p = w.players[0];
    p.gas = 1000;
    const wall = placeAt(w, 0, 'wall', base(w, 0).slot(1));
    expect(wall).toBeTruthy();
    expect(p.gas).toBe(996);
    const placed = w.tick;
    until(w, () => wall.built, 4);
    near((w.tick - placed) / T, 2, 0.6);
    expect(wall.level).toBe(1);
    expect(wall.maxHp).toBe(50);
    expect(wall.dr ?? 0).toBe(0);
    wall.hp = 40; // test setup: a damaged wall
    const log = record(w, () => {
      w.issue(0, upgradeCmd(w, 0, wall));
      sec(w, 0.1);
      expect(wall.upgrading).toBeGreaterThan(1.5);
      expect(wall.upgrading).toBeLessThanOrEqual(2);
      expect(p.gas).toBe(988);
      until(w, () => wall.level === 2 && !(wall.upgrading > 0), 4);
    });
    expect(wall.level).toBe(2);
    expect(wall.maxHp).toBe(70);
    expect(wall.hp).toBeCloseTo(60, 6);
    expect(log.some((e) => e.e === 'upgraded' && e.id === wall.id && e.owner === 0 && e.level === 2)).toBe(true);
    expect(upgradeTo(w, 0, wall, 5)).toBe(true);
    // Ultra Wall upgrades take 3 s
    const t0 = w.tick;
    expect(upgradeTo(w, 0, wall, 6)).toBe(true);
    near((w.tick - t0) / T, 3, 0.6);
    expect(wall.maxHp).toBe(320);
    expect(wall.dr).toBeCloseTo(0.02, 6);
    expect(p.gas).toBe(1000 - 4 - 8 - 16 - 32 - 64 - 128);
    expect(wall.invested).toMatchObject({ gas: 252, minerals: 0 });
    // damage reduction applies
    const hp = wall.hp;
    applyDamage(w, wall, 100, null);
    expect(hp - wall.hp).toBeCloseTo(98, 4);
  });

  it('trades minerals at the global price: 155 start, +5 per bought lot, sells 10 below, floor 20', () => {
    const w = game();
    const p = w.players[0];
    p.gas = 5000;
    const trade = (op, lots) => {
      w.issue(0, tradeCmd(w, 0, op, lots));
      sec(w, 0.1);
    };
    trade('buy', 1); // no Market
    expect(p.minerals).toBe(0);
    expect(p.gas).toBe(5000);
    const m = placeAt(w, 0, 'market', base(w, 0).slot(0));
    expect(m).toBeTruthy();
    expect(p.gas).toBe(4936);
    trade('buy', 1); // still under construction
    expect(p.minerals).toBe(0);
    until(w, () => m.built, 7);
    expect(m.built).toBe(true);
    expect(m.level).toBe(1);
    expect(m.maxHp).toBe(20);
    expect(w.survival.price).toBe(155);
    const log = record(w, () => trade('buy', 1));
    expect(p.gas).toBe(4781);
    expect(p.minerals).toBe(10);
    expect(w.survival.price).toBe(160);
    expect(log.some((e) => e.e === 'trade' && e.owner === 0 && e.op === 'buy')).toBe(true);
    trade('buy', 10); // 160 + 165 + ... + 205
    expect(p.gas).toBe(4781 - 1825);
    expect(p.minerals).toBe(110);
    expect(w.survival.price).toBe(210);
    trade('sell', 1); // receives 210 - 10
    expect(p.gas).toBe(2956 + 200);
    expect(p.minerals).toBe(100);
    expect(w.survival.price).toBe(205);
    trade('sell', 10); // 195 + 190 + ... + 150
    expect(p.gas).toBe(3156 + 1725);
    expect(p.minerals).toBe(0);
    expect(w.survival.price).toBe(155);
    trade('sell', 1); // nothing to sell
    expect(p.gas).toBe(4881);
    expect(w.survival.price).toBe(155);
    // the price never drops below 20
    w.survival.price = 25; // test setup
    p.minerals = 30;
    trade('sell', 1);
    expect(p.gas).toBe(4881 + 15);
    expect(w.survival.price).toBe(20);
    trade('sell', 1);
    expect(p.gas).toBe(4896 + 10);
    expect(w.survival.price).toBe(20);
    expect(p.minerals).toBe(10);
    // can't buy without the gas
    p.gas = 19;
    trade('buy', 1);
    expect(p.minerals).toBe(10);
    expect(p.gas).toBe(19);
    expect(w.survival.price).toBe(20);
  });

  it('cancels a structure under construction for a full refund', () => {
    const w = game();
    const p = w.players[0];
    p.gas = 1000;
    const m = placeAt(w, 0, 'market', base(w, 0).slot(0));
    expect(m).toBeTruthy();
    expect(m.built).toBe(false);
    expect(p.gas).toBe(936);
    w.issue(0, { type: 'cancel', ids: heroIds(w, 0), id: m.id, building: m.id });
    sec(w, 0.2);
    expect(gone(w, m)).toBe(true);
    expect(p.gas).toBe(1000);
  });

  it('shares gas and minerals with another Shaper, never with the Lancer', () => {
    const w = game({ shapers: 2 });
    const [a, b] = w.players;
    const lp = lancerPid(w);
    a.gas = 100;
    a.minerals = 20;
    w.issue(0, { type: 'share', ids: heroIds(w, 0), to: 1, gas: 30, minerals: 5 });
    sec(w, 0.1);
    expect([a.gas, a.minerals, b.gas, b.minerals]).toEqual([70, 15, 30, 5]);
    const lm = w.players[lp].minerals;
    w.issue(0, { type: 'share', ids: heroIds(w, 0), to: lp, gas: 10, minerals: 5 });
    sec(w, 0.1);
    expect([a.gas, a.minerals]).toEqual([70, 15]);
    near(w.players[lp].minerals, lm, 0.2);
  });
});

// =========================================================================================

describe('turrets (section 4.4)', () => {
  it('shoot a visible Lancer for table damage once per second, not while upgrading, not on cease fire, not out of range', () => {
    const w = game();
    const p = w.players[0];
    const B = base(w, 0);
    const h = heroOf(w, 0);
    const lp = lancerPid(w);
    p.gas = 1000;
    const t = buildAt(w, 0, 'turret', B.slot(4));
    expect(t).toBeTruthy();
    expect(p.gas).toBe(992);
    expect(t.level).toBe(1);
    expect(t.maxHp).toBe(20);
    expect(t.weaponDamage).toBe(1);
    expect(t.weaponRange).toBe(6);
    expect(t.weaponCooldown).toBeCloseTo(1, 6);
    const L = waitLancer(w);
    expect(L).toBeTruthy();
    // test setup: the Lancer stands 4 cells from the turret on hold; the Shaper gives vision
    put(L, B.x + 1, B.y + 5);
    w.issue(lp, { type: 'hold', ids: [L.id] });
    put(h, t.x + 1.5, t.y + 2.5);
    sec(w, 0.5);
    let hp = L.hp;
    sec(w, 5);
    near(hp - L.hp, 5, 1);
    // upgrading: no shots for the 4 s, then Turret 2 hits for 2
    w.issue(0, upgradeCmd(w, 0, t));
    tick(w);
    expect(t.upgrading).toBeGreaterThan(3.5);
    expect(p.gas).toBe(968);
    hp = L.hp;
    sec(w, 3.5);
    expect(L.hp).toBe(hp);
    until(w, () => t.level === 2 && !(t.upgrading > 0), 2);
    expect(t.level).toBe(2);
    expect(t.weaponDamage).toBe(2);
    sec(w, 0.2);
    hp = L.hp;
    sec(w, 5);
    near(hp - L.hp, 10, 2);
    // cease fire
    w.issue(0, { type: 'ceaseFire', ids: heroIds(w, 0), id: t.id, on: true });
    sec(w, 0.2);
    expect(t.ceaseFire).toBe(true);
    hp = L.hp;
    sec(w, 3);
    expect(L.hp).toBe(hp);
    w.issue(0, { type: 'ceaseFire', ids: heroIds(w, 0), id: t.id, on: false });
    sec(w, 3);
    expect(t.ceaseFire).toBe(false);
    expect(L.hp).toBeLessThan(hp);
    // out of range (~9.7 cells away), still visible
    put(L, B.x + 11, B.y + 12.6);
    w.issue(lp, { type: 'hold', ids: [L.id] });
    put(h, B.x + 8.5, B.y + 12.5);
    sec(w, 0.5);
    hp = L.hp;
    sec(w, 3);
    expect(L.hp).toBe(hp);
  });

  it(
    'need a Market for Turret 3-4, an Underground Market for 5-6, a Global Market (and minerals) for 7-10 and a Library from 11',
    () => {
      const w = game();
      const p = w.players[0];
      const B = base(w, 0);
      p.gas = 20000;
      const t = buildAt(w, 0, 'turret', B.slot(0));
      expect(t).toBeTruthy();
      const check = (L) => {
        const r = TURRETS[L - 1];
        expect(t.level).toBe(L);
        expect(t.weaponDamage, `Turret ${L} damage`).toBe(r.damage);
        expect(t.weaponRange, `Turret ${L} range`).toBe(r.range);
        expect(t.weaponCooldown, `Turret ${L} cooldown`).toBeCloseTo(r.cooldown, 6);
        expect(t.maxHp, `Turret ${L} hp`).toBe(r.hp);
      };
      check(1);
      expect(upgradeTo(w, 0, t, 2)).toBe(true);
      check(2);
      expect(tryUpgrade(w, 0, t), 'Turret 3 without a Market').toBe(false);
      const m = buildAt(w, 0, 'market', B.slot(1));
      expect(m).toBeTruthy();
      expect(upgradeTo(w, 0, t, 4)).toBe(true);
      check(4);
      expect(tryUpgrade(w, 0, t), 'Turret 5 without an Underground Market').toBe(false);
      expect(upgradeTo(w, 0, m, 2)).toBe(true);
      expect(upgradeTo(w, 0, t, 6)).toBe(true);
      check(6);
      expect(tryUpgrade(w, 0, t), 'Turret 7 without a Global Market').toBe(false);
      expect(upgradeTo(w, 0, m, 3)).toBe(true);
      expect(m.maxHp).toBe(130);
      expect(tryUpgrade(w, 0, t), 'Turret 7 without 16 minerals').toBe(false);
      p.minerals = 1000;
      expect(upgradeTo(w, 0, t, 10)).toBe(true);
      check(10);
      expect(tryUpgrade(w, 0, t), 'Turret 11 without a Library').toBe(false);
      const turretGas = TURRETS.slice(0, 10).reduce((s, r) => s + r.gas, 0);
      expect(p.gas).toBe(20000 - turretGas - (64 + 256 + 1024));
      expect(p.minerals).toBe(1000 - (16 + 32 + 64 + 128));
      expect(t.invested).toMatchObject({ gas: turretGas, minerals: 240 });
    },
    LONG,
  );

  it('can be built directly as Turret 6 (512 gas, 20 s) once a Market exists', () => {
    const w = game();
    const p = w.players[0];
    const B = base(w, 0);
    p.gas = 2000;
    const log = record(w, () => {
      w.issue(0, buildCmd(w, 0, 'turret', B.slot(1), { level: 6 }));
      sec(w, 5);
    });
    expect(w.buildings.some((b) => !b.dead && b.owner === 0 && b.type === 'turret')).toBe(false);
    expect(p.gas).toBe(2000);
    expect(errorsOf(log, 0).some((m) => /market/i.test(m))).toBe(true);
    const m = buildAt(w, 0, 'market', B.slot(0));
    expect(m).toBeTruthy();
    const t = placeAt(w, 0, 'turret', B.slot(1), { level: 6 });
    expect(t).toBeTruthy();
    expect(p.gas).toBe(2000 - 64 - 512);
    const placed = w.tick;
    sec(w, 18.5);
    expect(t.built).toBe(false);
    until(w, () => t.built, 3);
    expect(t.built).toBe(true);
    near((w.tick - placed) / T, 20, 1);
    expect(t.level).toBe(6);
    expect(t.weaponDamage).toBe(32);
    expect(t.weaponRange).toBe(6);
    expect(t.invested).toMatchObject({ gas: 512, minerals: 0 });
  });

  it(
    'can be built directly as Turret 11 (cumulative cost, 30 s) with a Library; salvage refunds gas and minerals',
    () => {
      const w = game();
      const p = w.players[0];
      const B = base(w, 0);
      p.gas = 50000;
      p.minerals = 20000;
      w.issue(0, buildCmd(w, 0, 'turret', B.slot(2), { level: 11 }));
      sec(w, 5);
      expect(w.buildings.some((b) => !b.dead && b.owner === 0 && b.type === 'turret')).toBe(false);
      const lib = placeAt(w, 0, 'library', B.slot(0));
      expect(lib).toBeTruthy();
      expect(lib.w).toBe(3);
      expect(p.gas).toBe(50000 - 4096);
      expect(p.minerals).toBe(20000 - 256);
      const placedLib = w.tick;
      until(w, () => lib.built, 22);
      near((w.tick - placedLib) / T, 20, 1);
      const t = placeAt(w, 0, 'turret', B.slot(2), { level: 11 });
      expect(t).toBeTruthy();
      expect(p.gas).toBe(50000 - 4096 - 16384);
      expect(p.minerals).toBe(20000 - 256 - 15240);
      const placed = w.tick;
      until(w, () => t.built, 33);
      expect(t.built).toBe(true);
      near((w.tick - placed) / T, 30, 1.5);
      expect(t.level).toBe(11);
      expect(t.weaponDamage).toBe(40960);
      expect(t.weaponRange).toBe(9);
      // salvage gives back everything invested, gas and minerals
      const g = p.gas;
      const m = p.minerals;
      const log = record(w, () => {
        w.issue(0, salvageCmd(w, 0, t));
        until(w, () => gone(w, t), 4);
      });
      expect(gone(w, t)).toBe(true);
      expect(p.gas).toBe(g + 16384);
      expect(p.minerals).toBe(m + 15240);
      expect(log.some((e) => e.e === 'salvaged' && e.id === t.id && e.gas === 16384 && e.minerals === 15240)).toBe(true);
      w.issue(0, salvageCmd(w, 0, lib));
      until(w, () => gone(w, lib), 4);
      expect(p.gas).toBe(g + 16384 + 4096);
      expect(p.minerals).toBe(m + 15240 + 256);
      expect(pickupsOf(w, 'pallet')).toHaveLength(0);
    },
    LONG,
  );
});

// =========================================================================================

describe('salvage and pickups (sections 2, 4.7)', () => {
  it('salvages in 3 s for everything invested; only a Generator of level 2+ drops a pallet', () => {
    const w = game();
    const p = w.players[0];
    const B = base(w, 0);
    p.gas = 1000;
    const wall = buildAt(w, 0, 'wall', B.slot(1));
    expect(upgradeTo(w, 0, wall, 3)).toBe(true);
    expect(p.gas).toBe(1000 - 28);
    expect(wall.invested).toMatchObject({ gas: 28, minerals: 0 });
    const lost = p.stats.structuresLost;
    let log = record(w, () => {
      w.issue(0, salvageCmd(w, 0, wall));
      sec(w, 0.1);
      expect(wall.salvaging).toBeGreaterThan(2.5);
      expect(wall.salvaging).toBeLessThanOrEqual(3);
      sec(w, 2.3);
      expect(gone(w, wall)).toBe(false);
      until(w, () => gone(w, wall), 1.5);
    });
    expect(gone(w, wall)).toBe(true);
    expect(p.gas).toBe(1000);
    expect(log.some((e) => e.e === 'salvaged' && e.id === wall.id && e.owner === 0 && e.gas === 28 && e.minerals === 0)).toBe(true);
    expect(p.stats.structuresLost).toBe(lost);
    expect(pickupsOf(w, 'pallet')).toHaveLength(0);

    // Generator 1: nothing to refund, no pallet
    const gen1 = buildAt(w, 0, 'generator', B.slot(0));
    expect(gen1).toBeTruthy();
    w.issue(0, salvageCmd(w, 0, gen1));
    until(w, () => gone(w, gen1), 4);
    expect(gone(w, gen1)).toBe(true);
    expect(pickupsOf(w, 'pallet')).toHaveLength(0);

    // Generator 2: refunds 50 gas and leaves a 100-mineral pallet for 90 s
    const wall2 = buildAt(w, 0, 'wall', B.slot(2));
    expect(wall2).toBeTruthy();
    const gen2 = buildAt(w, 0, 'generator', B.slot(3));
    expect(gen2).toBeTruthy();
    expect(upgradeTo(w, 0, gen2, 2)).toBe(true);
    expect(gen2.invested).toMatchObject({ gas: 50, minerals: 0 });
    const g0 = p.gas;
    log = record(w, () => {
      w.issue(0, salvageCmd(w, 0, gen2));
      until(w, () => gone(w, gen2), 4);
    });
    expect(gone(w, gen2)).toBe(true);
    expect(log.some((e) => e.e === 'salvaged' && e.id === gen2.id && e.gas === 50)).toBe(true);
    expect(p.gas - g0).toBeGreaterThanOrEqual(50);
    expect(p.gas - g0).toBeLessThanOrEqual(50 + 2 * 3.5 + 0.1);
    const pallets = pickupsOf(w, 'pallet');
    expect(pallets).toHaveLength(1);
    expect(pallets[0].amount).toBe(100);
    expect(dist(pallets[0], gen2)).toBeLessThanOrEqual(1.5);
    near(pallets[0].expires - w.tick, 90 * T, 1 * T);
  });

  it('gives nothing back when the structure dies while salvaging', () => {
    const w = game();
    const p = w.players[0];
    p.gas = 100;
    const wall = buildAt(w, 0, 'wall', base(w, 0).slot(1));
    expect(wall).toBeTruthy();
    w.issue(0, salvageCmd(w, 0, wall));
    sec(w, 1);
    expect(wall.salvaging).toBeGreaterThan(0);
    w.kill(wall, null);
    sec(w, 3);
    expect(p.gas).toBe(96);
  });

  it('lets only the Lancer (or a Hunter) pick up a pallet', () => {
    const w = game();
    const p = w.players[0];
    const B = base(w, 0);
    const h = heroOf(w, 0);
    const lp = lancerPid(w);
    p.gas = 500;
    const wall = buildAt(w, 0, 'wall', B.slot(1));
    const gen = buildAt(w, 0, 'generator', B.slot(0));
    expect(wall && gen).toBeTruthy();
    expect(upgradeTo(w, 0, gen, 2)).toBe(true);
    w.issue(0, salvageCmd(w, 0, gen));
    until(w, () => gone(w, gen), 4);
    const pal = pickupsOf(w, 'pallet')[0];
    expect(pal).toBeTruthy();
    // a Shaper walking over it changes nothing
    put(h, pal.x, pal.y);
    sec(w, 1);
    expect(pickupsOf(w, 'pallet').some((k) => k.id === pal.id)).toBe(true);
    put(h, B.home.x, B.home.y);
    // the Lancer takes it
    const L = waitLancer(w);
    expect(L).toBeTruthy();
    // out of reach at 1.8 cells (the pickup distance is <= 1.5)
    put(L, pal.x, pal.y + 1.8);
    w.issue(lp, { type: 'hold', ids: [L.id] });
    sec(w, 0.5);
    expect(pickupsOf(w, 'pallet').some((k) => k.id === pal.id)).toBe(true);
    const m0 = w.players[lp].minerals;
    put(L, pal.x, pal.y + 1.4);
    w.issue(lp, { type: 'hold', ids: [L.id] });
    const log = record(w, () => sec(w, 0.5));
    expect(pickupsOf(w, 'pallet').some((k) => k.id === pal.id)).toBe(false);
    near(w.players[lp].minerals - m0, 100 + 0.5, 0.6);
    expect(log.some((e) => e.e === 'pickup' && e.type === 'pallet' && e.owner === lp && e.amount === 100)).toBe(true);
  });

  it(
    'removes an untouched pallet after 90 s',
    () => {
      const w = game();
      const p = w.players[0];
      const B = base(w, 0);
      p.gas = 500;
      buildAt(w, 0, 'wall', B.slot(1));
      const gen = buildAt(w, 0, 'generator', B.slot(0));
      expect(upgradeTo(w, 0, gen, 2)).toBe(true);
      w.issue(0, salvageCmd(w, 0, gen));
      until(w, () => gone(w, gen), 4);
      const pal = pickupsOf(w, 'pallet')[0];
      expect(pal).toBeTruthy();
      sec(w, 88.5);
      expect(pickupsOf(w, 'pallet').some((k) => k.id === pal.id)).toBe(true);
      sec(w, 2.5);
      expect(pickupsOf(w, 'pallet').some((k) => k.id === pal.id)).toBe(false);
    },
    LONG,
  );

  it('spawns gas bonus pickups every 40 s at least 15 cells from the Shop; a Shaper hero takes +10 gas, the Lancer cannot', () => {
    const w = game({ bonuses: true });
    const p = w.players[0];
    const h = heroOf(w, 0);
    const lp = lancerPid(w);
    sec(w, 41);
    const list = pickupsOf(w, 'gasBonus');
    expect(list.length).toBeGreaterThanOrEqual(1);
    const shop = shopPos(w);
    const W = w.map.width;
    for (const k of list) {
      expect(dist(k, shop)).toBeGreaterThanOrEqual(15 - 0.75);
      const i = Math.floor(k.y) * W + Math.floor(k.x);
      expect(w.grid.terrainPathable(Math.floor(k.x), Math.floor(k.y))).toBe(true);
      expect(w.map.flags[i] & CELL_RAMP).toBe(0);
      expect(k.expires).toBe(-1);
    }
    const k = list[0];
    // the Lancer can't take it
    const L = lancerHero(w);
    expect(L).toBeTruthy();
    const L0 = { x: L.x, y: L.y };
    const lg = w.players[lp].gas ?? 0;
    put(L, k.x, k.y);
    w.issue(lp, { type: 'hold', ids: [L.id] });
    sec(w, 0.5);
    expect(pickupsOf(w, 'gasBonus').some((x) => x.id === k.id)).toBe(true);
    expect(w.players[lp].gas ?? 0).toBe(lg);
    put(L, L0.x, L0.y);
    w.issue(lp, { type: 'hold', ids: [L.id] });
    sec(w, 0.2);
    // the Shaper does
    const g0 = p.gas;
    put(h, k.x, k.y);
    const log = record(w, () => sec(w, 0.3));
    expect(pickupsOf(w, 'gasBonus').some((x) => x.id === k.id)).toBe(false);
    expect(p.gas - g0).toBeCloseTo(10, 6);
    expect(log.some((e) => e.e === 'pickup' && e.type === 'gasBonus' && e.owner === 0)).toBe(true);
    // touching = within 1.2 cells: a pickup placed in the test base (test setup) stays at 1.6, goes at 1.1
    const B = base(w, 0);
    const mine = { id: w.nextId++, type: 'gasBonus', x: B.x + 3.5, y: B.y + 12.5, amount: 10, expires: -1 };
    w.pickups.push(mine);
    put(h, mine.x + 1.6, mine.y);
    sec(w, 0.3);
    expect(pickupsOf(w, 'gasBonus').some((x) => x.id === mine.id)).toBe(true);
    put(h, mine.x + 1.1, mine.y);
    sec(w, 0.3);
    expect(pickupsOf(w, 'gasBonus').some((x) => x.id === mine.id)).toBe(false);
  });

  it('multiplies gas bonus pickups by the pace', () => {
    const w = game({ bonuses: true, pace: 2 });
    const p = w.players[0];
    sec(w, 41);
    const k = pickupsOf(w, 'gasBonus')[0];
    expect(k).toBeTruthy();
    const g0 = p.gas;
    put(heroOf(w, 0), k.x, k.y);
    sec(w, 0.3);
    expect(p.gas - g0).toBeCloseTo(20, 6);
  });

  it(
    'keeps at most 6 gas bonus pickups on the map; with no duration the game keeps going',
    () => {
      const w = game({ bonuses: true });
      sec(w, 330);
      expect(pickupsOf(w, 'gasBonus')).toHaveLength(6);
      expect(w.over).toBe(false);
    },
    LONG,
  );
});

// =========================================================================================

describe('Collection Depot, miners and auto mines (section 4.5)', () => {
  it(
    'trains miners at a 256-gas depot; they gather their tier amount on their own and gold doubles tiers 1-4 only',
    () => {
      const w = game({ park: true });
      const p = w.players[0];
      p.gas = 100000;
      const spot = depotNearGold(w);
      expect(spot, 'a depot spot whose nearest field is gold').toBeTruthy();
      const nf = w.grid.nearestFree(spot.bx + 1.5, spot.by + 4.5, 6);
      put(heroOf(w, 0), nf[0] + 0.5, nf[1] + 0.5);
      const depot = placeAt(w, 0, 'depot', spot);
      expect(depot).toBeTruthy();
      expect(p.gas).toBe(100000 - 256);
      expect(depot.w).toBe(3);
      expect(depot.maxHp).toBe(200);
      const placed = w.tick;
      until(w, () => depot.built, 12);
      expect(depot.built).toBe(true);
      near((w.tick - placed) / T, 10, 1);

      const g1 = p.gas;
      w.issue(0, { type: 'trainMiner', ids: heroIds(w, 0), id: depot.id, tier: 4 });
      sec(w, 0.1);
      expect(p.gas).toBe(g1 - 4096);
      const t1 = w.tick;
      const m4 = until(w, () => unitsOf(w, 0, 'miner').find((u) => u.tier === 4), 8);
      expect(m4).toBeTruthy();
      near((w.tick - t1) / T, 5, 1);
      until(w, () => p.minerals > 0, 25);
      expect(p.minerals).toBeGreaterThan(0);
      sec(w, 1);
      const field = nearestField(w, m4);
      expect(field.rich, 'tier 1-4 miners prefer gold').toBe(true);
      let m0 = p.minerals;
      sec(w, 10);
      near(p.minerals - m0, 20, 2.5); // 1 per second, doubled on gold

      w.issue(0, { type: 'trainMiner', ids: heroIds(w, 0), id: depot.id, tier: 5 });
      sec(w, 0.1);
      expect(p.gas).toBe(g1 - 4096 - 15360);
      const m5 = until(w, () => unitsOf(w, 0, 'miner').find((u) => u.tier === 5), 8);
      expect(m5).toBeTruthy();
      sec(w, 10);
      m0 = p.minerals;
      sec(w, 10);
      near(p.minerals - m0, 80, 8); // 2/s from the tier 4 + 6/s (never doubled) from the tier 5
    },
    LONG,
  );

  it(
    'caps miners at 15 per Shaper (alive + queued), queues 5 per depot and lets the owner dismiss one',
    () => {
      const w = game({ park: true });
      const p = w.players[0];
      const B = base(w, 0);
      p.gas = 100000;
      const depots = [0, 1, 2, 3].map((i) => buildAt(w, 0, 'depot', B.slot(i)));
      expect(depots.every(Boolean)).toBe(true);
      const g0 = p.gas;
      const train = (d) => w.issue(0, { type: 'trainMiner', ids: heroIds(w, 0), id: d.id, tier: 1 });
      for (let k = 0; k < 6; k++) train(depots[0]); // the 6th doesn't fit in the queue
      for (let k = 0; k < 5; k++) train(depots[1]);
      for (let k = 0; k < 5; k++) train(depots[2]);
      sec(w, 0.1);
      expect(p.gas).toBe(g0 - 15 * 512);
      const log = record(w, () => {
        train(depots[3]);
        sec(w, 0.1);
      });
      expect(p.gas).toBe(g0 - 15 * 512);
      expect(errorsOf(log, 0).some((m) => /15/.test(m))).toBe(true);
      until(w, () => unitsOf(w, 0, 'miner').length >= 15, 30);
      sec(w, 1);
      expect(unitsOf(w, 0, 'miner')).toHaveLength(15);
      const victim = unitsOf(w, 0, 'miner')[0];
      w.issue(0, { type: 'dismiss', ids: [victim.id] });
      sec(w, 0.1);
      expect(gone(w, victim)).toBe(true);
      expect(unitsOf(w, 0, 'miner')).toHaveLength(14);
      train(depots[3]);
      sec(w, 0.1);
      expect(p.gas).toBe(g0 - 16 * 512);
    },
    LONG,
  );

  it('builds Auto Mines with minerals next to a completed depot; they make gas forever and can only be dismissed', () => {
    const w = game();
    const p = w.players[0];
    const B = base(w, 0);
    p.gas = 1000;
    p.minerals = 2000;
    const log = record(w, () => {
      w.issue(0, buildCmd(w, 0, 'autoMine', B.slot(4), { level: 1 }));
      sec(w, 5);
    });
    expect(w.buildings.some((b) => !b.dead && b.owner === 0 && b.type === 'autoMine')).toBe(false);
    expect(p.minerals).toBe(2000);
    expect(errorsOf(log, 0).some((m) => /depot/i.test(m))).toBe(true);
    const depot = buildAt(w, 0, 'depot', B.slot(0));
    expect(depot).toBeTruthy();
    const a1 = placeAt(w, 0, 'autoMine', B.slot(4), { level: 1 });
    expect(a1).toBeTruthy();
    expect(p.minerals).toBe(2000 - 32);
    const placed = w.tick;
    until(w, () => a1.built, 7);
    near((w.tick - placed) / T, 5, 1);
    expect(a1.level).toBe(1);
    expect(a1.maxHp).toBe(100);
    let g0 = p.gas;
    sec(w, 10);
    near(p.gas - g0, 10, 1);
    const a2 = buildAt(w, 0, 'autoMine', B.slot(5), { level: 2 });
    expect(a2).toBeTruthy();
    expect(a2.level).toBe(2);
    expect(p.minerals).toBe(2000 - 32 - 256);
    g0 = p.gas;
    sec(w, 10);
    near(p.gas - g0, 90, 3);
    // not salvageable, not upgradable
    w.issue(0, salvageCmd(w, 0, a2));
    w.issue(0, upgradeCmd(w, 0, a2));
    sec(w, 4);
    expect(gone(w, a2)).toBe(false);
    expect(a2.level).toBe(2);
    expect(p.minerals).toBe(2000 - 32 - 256);
    // dismiss destroys it
    w.issue(0, { type: 'dismiss', ids: [a2.id] });
    sec(w, 0.2);
    expect(gone(w, a2)).toBe(true);
    g0 = p.gas;
    sec(w, 5);
    near(p.gas - g0, 5, 0.6);
  });
});

// =========================================================================================

describe('damage and feed (section 5)', () => {
  it('feeds the Lancer minerals equal to the damage actually dealt (after damage reduction, capped by what was left)', () => {
    const w = game({ shapers: 2 });
    const p = w.players[0];
    p.gas = 1000;
    const wall = buildAt(w, 0, 'wall', base(w, 0).slot(0));
    expect(upgradeTo(w, 0, wall, 6)).toBe(true); // Ultra Wall 1: 320 HP, 2% DR
    const L = waitLancer(w);
    const lp = L.owner;
    const Lp = w.players[lp];
    const fed0 = Lp.stats.fed ?? 0;
    let m0 = Lp.minerals;
    applyDamage(w, wall, 10, L);
    expect(wall.hp).toBeCloseTo(320 - 9.8, 6);
    expect(Lp.minerals - m0).toBeCloseTo(9.8, 6);
    expect(Lp.stats.fed - fed0).toBeCloseTo(9.8, 6);
    wall.hp = 3; // test setup
    m0 = Lp.minerals;
    applyDamage(w, wall, 100, L);
    expect(wall.dead).toBe(true);
    expect(Lp.minerals - m0).toBeCloseTo(3, 6);
    // a Shaper hero: barrier first, then hull
    const h1 = heroOf(w, 1);
    m0 = Lp.minerals;
    applyDamage(w, h1, 15, L);
    expect(h1.barrier).toBeCloseTo(5, 6);
    expect(h1.hp).toBe(20);
    expect(Lp.minerals - m0).toBeCloseTo(15, 6);
    m0 = Lp.minerals;
    applyDamage(w, h1, 100, L);
    expect(h1.dead).toBe(true);
    expect(Lp.minerals - m0).toBeCloseTo(25, 6);
    expect(Lp.stats.fed - fed0).toBeCloseTo(9.8 + 3 + 15 + 25, 6);
    // damage from anything else feeds nobody
    m0 = Lp.minerals;
    applyDamage(w, heroOf(w, 0), 5, null);
    expect(Lp.minerals).toBe(m0);
  });

  it('multiplies feed by the pace', () => {
    const w = game({ pace: 2 });
    w.players[0].gas = 100;
    const wall = buildAt(w, 0, 'wall', base(w, 0).slot(0));
    expect(wall).toBeTruthy();
    const L = waitLancer(w);
    const Lp = w.players[L.owner];
    const m0 = Lp.minerals;
    applyDamage(w, wall, 10, L);
    expect(Lp.minerals - m0).toBeCloseTo(20, 6);
  });

  it('a Lancer hacking a Wall 1 strikes for 5 once per second and is fed its 50 HP', () => {
    const w = game();
    const p = w.players[0];
    p.gas = 100;
    const wall = buildAt(w, 0, 'wall', base(w, 0).slot(4));
    expect(wall).toBeTruthy();
    const L = waitLancer(w);
    const lp = L.owner;
    const Lp = w.players[lp];
    put(L, wall.x, wall.y + 2.5);
    w.issue(lp, { type: 'hold', ids: [L.id] });
    sec(w, 0.25); // the Lancer's team has to see the wall before it can be ordered to attack it
    const fed0 = Lp.stats.fed ?? 0;
    const m0 = Lp.minerals;
    const t0 = w.tick;
    w.issue(lp, { type: 'attack', ids: [L.id], target: wall.id });
    until(w, () => wall.dead, 15);
    expect(wall.dead).toBe(true);
    const elapsed = (w.tick - t0) / T;
    expect(elapsed).toBeGreaterThan(8);
    expect(elapsed).toBeLessThan(12.5);
    expect(Lp.stats.fed - fed0).toBeCloseTo(50, 3);
    near(Lp.minerals - m0, 50 + elapsed, 1);
  });

  it('gives the Lancer 1 mineral per second (times the pace)', () => {
    for (const pace of [1, 4]) {
      const w = game({ pace });
      const L = waitLancer(w);
      expect(L).toBeTruthy();
      const Lp = w.players[L.owner];
      sec(w, 1);
      const m0 = Lp.minerals;
      sec(w, 10);
      near(Lp.minerals - m0, 10 * pace, 0.6 * pace);
    }
  });

  it('heals the Lancer by 25% of max HP per second within 8 cells of the Shop and nowhere else', () => {
    const w = game();
    const L = waitLancer(w);
    L.hp = 100; // test setup
    sec(w, 1);
    near(L.hp, 225, 15);
    sec(w, 3);
    near(L.hp, L.maxHp, 0.01);
    const B = base(w, 0);
    put(L, B.x + 1, B.y + 1);
    L.hp = 100;
    sec(w, 2);
    expect(L.hp).toBeCloseTo(100, 6);
  });
});

// =========================================================================================

describe('Lancer shop (section 7.2)', () => {
  it('buys and sells only within 8 cells of the Shop and refunds the full price', () => {
    const w = game();
    const L = waitLancer(w);
    const lp = L.owner;
    const Lp = w.players[lp];
    const atShop = { x: L.x, y: L.y };
    Lp.minerals = 1000; // test setup
    let m = Lp.minerals;
    let log = record(w, () => {
      shopCmd(w, lp, { type: 'buy', item: 'blade1' });
      sec(w, 0.1);
    });
    expect(Lp.items).toEqual(['blade1']);
    near(Lp.minerals, m - 100, 0.3);
    expect(L.damage).toBe(7);
    expect(log.some((e) => e.e === 'bought' && e.owner === lp && e.item === 'blade1')).toBe(true);
    // away from the Shop
    const B = base(w, 0);
    put(L, B.x + 1, B.y + 1);
    m = Lp.minerals;
    log = record(w, () => {
      shopCmd(w, lp, { type: 'buy', item: 'blade2' });
      shopCmd(w, lp, { type: 'sell', slot: 0 });
      sec(w, 0.1);
    });
    expect(Lp.items).toEqual(['blade1']);
    near(Lp.minerals, m, 0.3);
    expect(errorsOf(log, lp).some((e) => /shop/i.test(e))).toBe(true);
    // back at the Shop: full refund
    put(L, atShop.x, atShop.y);
    m = Lp.minerals;
    log = record(w, () => {
      shopCmd(w, lp, { type: 'sell', slot: 0 });
      sec(w, 0.1);
    });
    expect(Lp.items).toEqual([]);
    near(Lp.minerals, m + 100, 0.3);
    expect(L.damage).toBe(5);
    expect(log.some((e) => e.e === 'sold' && e.owner === lp && e.item === 'blade1')).toBe(true);
  });

  it('has 6 slots: armor/gloves/boots replace the old piece, weapons/life/regen need a slot or replace a cheaper one', () => {
    const w = game();
    const L = waitLancer(w);
    const lp = L.owner;
    const Lp = w.players[lp];
    Lp.minerals = 100000; // test setup
    const buy = (item) => {
      shopCmd(w, lp, { type: 'buy', item });
      tick(w);
    };
    const count = (id) => Lp.items.filter((x) => x === id).length;
    let m = Lp.minerals;
    buy('armor1');
    near(Lp.minerals, m - 100, 0.2);
    expect(L.dr).toBeCloseTo(0.09, 6);
    m = Lp.minerals;
    buy('armor2'); // the old armor is sold for its full price
    expect(Lp.items).toEqual(['armor2']);
    near(Lp.minerals, m - 200 + 100, 0.2);
    expect(L.dr).toBeCloseTo(0.18, 6);
    for (let k = 0; k < 5; k++) buy('blade1');
    expect(Lp.items).toHaveLength(6);
    expect(count('blade1')).toBe(5);
    // full: a stacking item with nothing cheaper of its kind to replace
    m = Lp.minerals;
    const log = record(w, () => buy('life1'));
    expect(Lp.items).toHaveLength(6);
    expect(count('life1')).toBe(0);
    near(Lp.minerals, m, 0.2);
    expect(errorsOf(log, lp).some((e) => /full/i.test(e))).toBe(true);
    buy('blade1'); // not cheaper than the new one either
    expect(count('blade1')).toBe(5);
    near(Lp.minerals, m, 0.2);
    // a better blade replaces the cheapest blade
    m = Lp.minerals;
    buy('blade3');
    expect(Lp.items).toHaveLength(6);
    expect(count('blade1')).toBe(4);
    expect(count('blade3')).toBe(1);
    near(Lp.minerals, m - 400 + 100, 0.2);
    // non-stacking items swap in place even when full
    m = Lp.minerals;
    buy('armor3');
    expect(Lp.items).toHaveLength(6);
    expect(count('armor3')).toBe(1);
    expect(count('armor2')).toBe(0);
    near(Lp.minerals, m - 400 + 200, 0.2);
    expect(L.damage).toBe(5 + 4 * 2 + 8);
    expect(L.dr).toBeCloseTo(0.27, 6);
    // armor reduces damage
    const hp = L.hp;
    applyDamage(w, L, 100, null);
    expect(hp - L.hp).toBeCloseTo(73, 4);
  });

  it('exchanges 64000 minerals for 1 gas (or 640000 for 10) to buy gas items', () => {
    const w = game();
    const L = waitLancer(w);
    const lp = L.owner;
    const Lp = w.players[lp];
    const ex = (n) => {
      shopCmd(w, lp, { type: 'exchange', n });
      tick(w);
    };
    Lp.minerals = 700000; // test setup
    const g0 = Lp.gas ?? 0;
    ex(1);
    expect(Lp.gas - g0).toBe(1);
    near(Lp.minerals, 636000, 0.2);
    ex(10); // not enough for 10
    expect(Lp.gas - g0).toBe(1);
    near(Lp.minerals, 636000, 0.2);
    Lp.minerals = 650000;
    ex(10);
    expect(Lp.gas - g0).toBe(11);
    near(Lp.minerals, 10000, 0.2);
    shopCmd(w, lp, { type: 'buy', item: 'blade10' });
    tick(w);
    expect(Lp.items).toEqual(['blade10']);
    expect(Lp.gas - g0).toBe(10);
    expect(L.damage).toBe(5 + 1280);
    expect(L.strikeCooldown).toBeCloseTo(0.2, 6);
  });
});

// =========================================================================================

describe('Shaper abilities (section 6)', () => {
  it('lets each Shaper pick one control and one mobility ability once; unpicked Shapers get Stasis + Blink after 20 s', () => {
    const w = game({ shapers: 2 });
    const [a, b] = w.players;
    pick(w, 0, ['stasis', 'invuln']); // two control abilities
    expect(a.abilities).toEqual([]);
    pick(w, 0, ['blink', 'cloak']); // two mobility abilities
    expect(a.abilities).toEqual([]);
    pick(w, 0, ['invuln', 'recall']);
    expect(a.abilities).toEqual(['invuln', 'recall']);
    pick(w, 0, ['stasis', 'blink']); // only once per game
    expect(a.abilities).toEqual(['invuln', 'recall']);
    sec(w, 18);
    expect(b.abilities).toEqual([]);
    sec(w, 3);
    expect(b.abilities).toEqual(['stasis', 'blink']);
    expect(a.abilities).toEqual(['invuln', 'recall']);
  });

  it('Stasis Prison locks the Lancer for 4 s (no move, attack, Return or damage), then spell immunity blocks a recast', () => {
    const w = game();
    const p = w.players[0];
    const B = base(w, 0);
    const h = heroOf(w, 0);
    p.gas = 500;
    pick(w, 0, ['stasis', 'blink']);
    const wall = buildAt(w, 0, 'wall', B.slot(7));
    expect(upgradeTo(w, 0, wall, 4)).toBe(true);
    const L = waitLancer(w);
    const lp = L.owner;
    put(L, wall.x, wall.y + 3.5);
    w.issue(lp, { type: 'hold', ids: [L.id] });
    put(h, wall.x + 4, wall.y + 3.5);
    sec(w, 0.3);
    const log = record(w, () => {
      cast(w, 0, 'stasis', { target: L.id });
      sec(w, 0.25);
    });
    expect(L.stasisUntil - w.tick).toBeGreaterThan(3.4 * T);
    expect(L.stasisUntil - w.tick).toBeLessThanOrEqual(4 * T + 1);
    near(p.cd.stasis, 30 - 0.25, 0.3);
    expect(log.some((e) => e.e === 'ability' && e.owner === 0 && e.ability === 'stasis')).toBe(true);
    const at = { x: L.x, y: L.y };
    // no Return
    w.issue(lp, { type: 'ability', ids: [L.id], ability: 'return' });
    sec(w, 0.25);
    expect(dist(L, at)).toBeLessThan(0.05);
    // no moving or attacking
    w.issue(lp, { type: 'attack', ids: [L.id], target: wall.id });
    sec(w, 2);
    expect(dist(L, at)).toBeLessThan(0.05);
    expect(wall.hp).toBe(wall.maxHp);
    // no damage
    const hp = L.hp;
    applyDamage(w, L, 100, null);
    expect(L.hp).toBe(hp);
    // free again after 4 s
    until(w, () => !(L.stasisUntil > w.tick), 2);
    expect(L.stasisUntil > w.tick).toBe(false);
    w.issue(lp, { type: 'attack', ids: [L.id], target: wall.id });
    until(w, () => wall.hp < wall.maxHp, 4);
    expect(wall.hp).toBeLessThan(wall.maxHp);
    // spell immunity (6 s)
    expect(L.immuneUntil - w.tick).toBeGreaterThan(3 * T);
    p.cd.stasis = 0; // test setup: skip the cooldown
    const log2 = record(w, () => {
      cast(w, 0, 'stasis', { target: L.id });
      sec(w, 0.25);
    });
    expect(L.stasisUntil > w.tick).toBe(false);
    expect(errorsOf(log2, 0).some((e) => /immune/i.test(e))).toBe(true);
    until(w, () => !(L.immuneUntil > w.tick), 7);
    p.cd.stasis = 0;
    cast(w, 0, 'stasis', { target: L.id });
    sec(w, 0.25);
    expect(L.stasisUntil).toBeGreaterThan(w.tick);
  });

  it('Blink teleports up to 8 cells to a visible point, then cools down for 10 s', () => {
    const w = game();
    const p = w.players[0];
    const B = base(w, 0);
    const h = heroOf(w, 0);
    pick(w, 0, ['stasis', 'blink']);
    expect(p.abilities).toEqual(['stasis', 'blink']);
    put(h, B.x + 1.5, B.y + 12.5);
    sec(w, 0.3);
    const to = { x: B.x + 6.5, y: B.y + 12.5 };
    cast(w, 0, 'blink', to);
    sec(w, 0.2);
    expect(dist(h, to)).toBeLessThan(0.75);
    near(p.cd.blink, 10 - 0.2, 0.3);
    const at = { x: h.x, y: h.y };
    cast(w, 0, 'blink', { x: B.x + 2.5, y: B.y + 12.5 }); // still cooling down
    sec(w, 0.2);
    expect(dist(h, at)).toBeLessThan(0.3);
    p.cd.blink = 0; // test setup
    put(h, B.x + 0.5, B.y + 12.5);
    sec(w, 0.1);
    cast(w, 0, 'blink', { x: B.x + 11.5, y: B.y + 12.5 }); // 11 cells away
    sec(w, 0.2);
    expect(h.x - (B.x + 0.5)).toBeLessThanOrEqual(8.3);
  });

  it('Blink needs vision of the destination (e.g. high ground), Far Blink does not', () => {
    for (const [ability, lands] of [
      ['blink', false],
      ['farBlink', true],
    ]) {
      const w = game();
      pick(w, 0, ['stasis', ability]);
      const spot = cliffSpot(w);
      expect(spot, 'a low cell next to a cliff').toBeTruthy();
      const h = heroOf(w, 0);
      put(h, spot.low.x, spot.low.y);
      sec(w, 0.5);
      expect(visibleCell(w, 0, spot.high), 'high ground is hidden from below').toBe(false);
      cast(w, 0, ability, { x: spot.high.x, y: spot.high.y });
      sec(w, 0.3);
      if (lands) expect(dist(h, spot.high), ability).toBeLessThan(0.75);
      else expect(dist(h, spot.high), ability).toBeGreaterThan(2);
    }
  });

  it('Cloak hides the Shaper from the Lancer for 10 s and makes it 50% faster; a Scan reveals it', () => {
    const w = game();
    const p = w.players[0];
    const B = base(w, 0);
    const h = heroOf(w, 0);
    pick(w, 0, ['stasis', 'cloak']);
    put(h, B.x + 11.5, B.y + 12.5);
    const L = waitLancer(w);
    const lp = L.owner;
    put(L, B.x + 10.5, B.y + 9.5);
    w.issue(lp, { type: 'hold', ids: [L.id] });
    sec(w, 0.5);
    expect(w.isVisibleTo(h, lp)).toBe(true);
    cast(w, 0, 'cloak');
    sec(w, 0.5);
    near(h.cloakUntil - w.tick, 9.5 * T, 0.3 * T);
    near(p.cd.cloak, 45 - 0.5, 0.3);
    expect(w.isVisibleTo(h, lp)).toBe(false);
    w.issue(0, { type: 'move', ids: [h.id], x: B.x + 0.5, y: B.y + 12.5 });
    tick(w);
    const x0 = h.x;
    sec(w, 1);
    near(x0 - h.x, 3.94 * 1.5, 0.4);
    cast(w, lp, 'scan', { x: h.x, y: h.y });
    sec(w, 0.3);
    expect(w.isVisibleTo(h, lp)).toBe(true);
    sec(w, 9);
    expect(h.cloakUntil > w.tick).toBe(false);
  });

  it('Swiftness is a passive +50% movement speed (base Shaper speed 3.94)', () => {
    for (const [abilities, speed] of [
      [['stasis', 'blink'], 3.94],
      [['stasis', 'swift'], 3.94 * 1.5],
    ]) {
      const w = game();
      pick(w, 0, abilities);
      const B = base(w, 0);
      const h = heroOf(w, 0);
      put(h, B.x + 0.5, B.y + 12.5);
      sec(w, 0.2);
      w.issue(0, { type: 'move', ids: [h.id], x: B.x + 11.5, y: B.y + 12.5 });
      tick(w);
      const x0 = h.x;
      sec(w, 1);
      near(h.x - x0, speed, 0.35);
    }
  });

  it('Overcharge makes an own Generator produce 30% faster for 4 s', () => {
    const w = game();
    const p = w.players[0];
    pick(w, 0, ['overcharge', 'blink']);
    const gen = buildAt(w, 0, 'generator', base(w, 0).slot(7));
    expect(gen).toBeTruthy();
    sec(w, 1);
    let g0 = p.gas;
    sec(w, 4);
    near(p.gas - g0, 4, 0.3);
    cast(w, 0, 'overcharge', { target: gen.id });
    tick(w);
    near(gen.overchargeUntil - w.tick, 4 * T, 2);
    near(p.cd.overcharge, 12, 0.2);
    g0 = p.gas;
    sec(w, 3.5);
    near(p.gas - g0, 3.5 * 1.3, 0.35);
  });

  it('Invulnerability protects an own structure for 4 s', () => {
    const w = game();
    const p = w.players[0];
    p.gas = 100;
    pick(w, 0, ['invuln', 'blink']);
    const wall = buildAt(w, 0, 'wall', base(w, 0).slot(7));
    expect(wall).toBeTruthy();
    cast(w, 0, 'invuln', { target: wall.id });
    sec(w, 0.1);
    near(wall.invulnUntil - w.tick, 3.9 * T, 2);
    near(p.cd.invuln, 30 - 0.1, 0.2);
    applyDamage(w, wall, 30, null);
    expect(wall.hp).toBe(50);
    sec(w, 4.2);
    applyDamage(w, wall, 30, null);
    expect(wall.hp).toBe(20);
  });

  it('Barrier Field drops an impassable 2x2 blocker for 4 s, never on top of units', () => {
    const w = game();
    const p = w.players[0];
    const B = base(w, 0);
    const h = heroOf(w, 0);
    pick(w, 0, ['barrierField', 'blink']);
    const blockedAround = (pt) => {
      let n = 0;
      const cx = Math.floor(pt.x);
      const cy = Math.floor(pt.y);
      for (let y = cy - 2; y < cy + 2; y++) for (let x = cx - 2; x < cx + 2; x++) if (!w.grid.pathable(x, y)) n++;
      return n;
    };
    const pt = { x: B.x + 10, y: B.y + 12 };
    expect(blockedAround(pt)).toBe(0);
    cast(w, 0, 'barrierField', pt);
    sec(w, 0.2);
    expect(blockedAround(pt)).toBe(4);
    near(p.cd.barrierField, 20 - 0.2, 0.3);
    sec(w, 4.3);
    expect(blockedAround(pt)).toBe(0);
    p.cd.barrierField = 0; // test setup
    const self = { x: h.x, y: h.y };
    cast(w, 0, 'barrierField', self);
    sec(w, 0.2);
    expect(blockedAround(self)).toBe(0);
  });

  it('Recall teleports the Shaper next to an own structure', () => {
    const w = game();
    const p = w.players[0];
    p.gas = 100;
    pick(w, 0, ['stasis', 'recall']);
    const wall = buildAt(w, 0, 'wall', base(w, 0).slot(0));
    expect(wall).toBeTruthy();
    const h = heroOf(w, 0);
    put(h, base(w, 0).home.x, base(w, 0).home.y);
    expect(rectDist(h, wall)).toBeGreaterThan(8);
    cast(w, 0, 'recall', { target: wall.id });
    sec(w, 0.2);
    expect(rectDist(h, wall)).toBeLessThanOrEqual(2.5);
    near(p.cd.recall, 45 - 0.2, 0.3);
  });
});

// =========================================================================================

describe('Lancer abilities (section 7.1)', () => {
  it('Scan reveals a radius-13 circle for 12 s and recharges for 30 s', () => {
    const w = game();
    const h = heroOf(w, 0);
    const L = waitLancer(w);
    const lp = L.owner;
    const Lp = w.players[lp];
    sec(w, 0.3);
    expect(w.isVisibleTo(h, lp)).toBe(false);
    const log = record(w, () => {
      cast(w, lp, 'scan', { x: h.x, y: h.y });
      sec(w, 0.3);
    });
    const sc = w.survival.scans.find((s) => s.owner === lp);
    expect(sc).toBeTruthy();
    expect(sc.r).toBe(13);
    expect(sc.team).toBe(2);
    near(sc.until - w.tick, 11.7 * T, 2);
    expect(w.isVisibleTo(h, lp)).toBe(true);
    near(Lp.cd.scan, 30 - 0.3, 0.3);
    expect(log.some((e) => e.e === 'scan' && e.owner === lp)).toBe(true);
    cast(w, lp, 'scan', { x: h.x + 20, y: h.y }); // on cooldown
    sec(w, 0.3);
    expect(w.survival.scans.filter((s) => s.owner === lp && s.until > w.tick)).toHaveLength(1);
    sec(w, 12);
    expect(w.survival.scans.some((s) => s.owner === lp && s.until > w.tick)).toBe(false);
    expect(w.isVisibleTo(h, lp)).toBe(false);
  });

  it('Return teleports the Lancer to the Shop and recharges for 180 s', () => {
    const w = game();
    const L = waitLancer(w);
    const lp = L.owner;
    const B = base(w, 0);
    put(L, B.x + 1, B.y + 1);
    cast(w, lp, 'return');
    sec(w, 0.25);
    expect(dist(L, shopPos(w))).toBeLessThanOrEqual(8.5);
    near(w.players[lp].cd.return, 180 - 0.25, 0.3);
    put(L, B.x + 1, B.y + 1);
    cast(w, lp, 'return');
    sec(w, 0.25);
    expect(dist(L, { x: B.x + 1, y: B.y + 1 })).toBeLessThan(0.5);
  });

  it('Cloak hides the Lancer from Shapers and turrets until it attacks', () => {
    const w = game();
    const p = w.players[0];
    const B = base(w, 0);
    const h = heroOf(w, 0);
    p.gas = 500;
    const t = buildAt(w, 0, 'turret', B.slot(7));
    const wall = buildAt(w, 0, 'wall', B.slot(8));
    expect(t && wall).toBeTruthy();
    expect(upgradeTo(w, 0, wall, 4)).toBe(true);
    const L = waitLancer(w);
    const lp = L.owner;
    put(L, t.x, t.y + 3.5);
    w.issue(lp, { type: 'hold', ids: [L.id] });
    put(h, B.x + 10.5, B.y + 12.5);
    sec(w, 1.5);
    expect(w.isVisibleTo(L, 0)).toBe(true);
    expect(L.hp).toBeLessThan(L.maxHp); // the turret works
    cast(w, lp, 'cloak');
    sec(w, 0.5);
    near(L.cloakUntil - w.tick, 9.5 * T, 0.3 * T);
    expect(w.isVisibleTo(L, 0)).toBe(false);
    const hp = L.hp;
    sec(w, 3);
    expect(L.hp).toBe(hp);
    near(w.players[lp].cd.cloak, 60 - 3.5, 0.3);
    w.issue(lp, { type: 'attack', ids: [L.id], target: wall.id });
    until(w, () => wall.hp < wall.maxHp, 4);
    expect(wall.hp).toBeLessThan(wall.maxHp);
    sec(w, 0.3);
    expect(L.cloakUntil > w.tick).toBe(false);
    expect(w.isVisibleTo(L, 0)).toBe(true);
  });
});

// =========================================================================================

describe('late game and Spirit spells (sections 4.6, 8)', () => {
  it('the Lancer Detector needs a Library and reveals a cloaked Lancer to Shapers and turrets', () => {
    const w = game();
    const p = w.players[0];
    const B = base(w, 0);
    const h = heroOf(w, 0);
    p.gas = 30000;
    p.minerals = 5000;
    w.issue(0, buildCmd(w, 0, 'detector', B.slot(1)));
    sec(w, 4);
    expect(w.buildings.some((b) => !b.dead && b.owner === 0 && b.type === 'detector')).toBe(false);
    expect(p.gas).toBe(30000);
    const lib = buildAt(w, 0, 'library', B.slot(0));
    expect(lib).toBeTruthy();
    const det = placeAt(w, 0, 'detector', B.slot(1));
    expect(det).toBeTruthy();
    expect(p.gas).toBe(30000 - 4096 - 9999);
    expect(p.minerals).toBe(5000 - 256 - 1024);
    const placed = w.tick;
    until(w, () => det.built, 12);
    near((w.tick - placed) / T, 10, 1);
    expect(det.maxHp).toBe(200);
    const t = buildAt(w, 0, 'turret', B.slot(7));
    expect(t).toBeTruthy();
    const L = waitLancer(w);
    const lp = L.owner;
    put(L, t.x, t.y + 3.5);
    w.issue(lp, { type: 'hold', ids: [L.id] });
    put(h, B.x + 10.5, B.y + 12.5);
    sec(w, 0.5);
    cast(w, lp, 'cloak');
    sec(w, 0.5);
    expect(L.cloakUntil).toBeGreaterThan(w.tick);
    expect(w.isVisibleTo(L, 0)).toBe(true);
    const hp = L.hp;
    sec(w, 3);
    expect(L.hp).toBeLessThan(hp);
  });

  it(
    'Wardens trained at the Library (20 s) shoot down a visible Lancer',
    () => {
      const w = game();
      const p = w.players[0];
      const B = base(w, 0);
      p.gas = 200000;
      p.minerals = 100000;
      const lib = buildAt(w, 0, 'library', B.slot(0));
      expect(lib).toBeTruthy();
      const g0 = p.gas;
      const m0 = p.minerals;
      w.issue(0, { type: 'trainWarden', ids: heroIds(w, 0), id: lib.id, tier: 1 });
      sec(w, 0.1);
      expect(p.gas).toBe(g0 - 35000);
      expect(p.minerals).toBe(m0 - 25000);
      const t0 = w.tick;
      const wd = until(w, () => unitsOf(w, 0, 'warden')[0], 22);
      expect(wd).toBeTruthy();
      near((w.tick - t0) / T, 20, 1);
      expect(wd.tier).toBe(1);
      expect(wd.maxHp).toBe(20000);
      const L = waitLancer(w);
      const spot = w.grid.nearestFree(wd.x + 4, wd.y, 4);
      put(L, spot[0] + 0.5, spot[1] + 0.5);
      w.issue(L.owner, { type: 'hold', ids: [L.id] });
      until(w, () => w.over, 5);
      expect(w.over).toBe(true);
      expect(w.winnerTeam).toBe(1);
    },
    LONG,
  );

  it('a Spirit casts Decay: the Lancer strikes 50% slower for 5 s; spell immunity blocks it', () => {
    const w = game({ shapers: 2 });
    const B = base(w, 1);
    const p0 = w.players[0];
    const p1 = w.players[1];
    p1.gas = 500;
    pick(w, 1, ['stasis', 'blink']);
    const wall = buildAt(w, 1, 'wall', B.slot(4));
    expect(upgradeTo(w, 1, wall, 4)).toBe(true); // 170 HP
    w.kill(heroOf(w, 0), null); // Shaper 1 dies before 5:00 and becomes a Spirit
    const spirit = until(w, () => unitsOf(w, 0, 'spirit')[0], 2);
    expect(spirit).toBeTruthy();
    const L = waitLancer(w);
    const lp = L.owner;
    put(L, wall.x, wall.y + 2.5);
    w.issue(lp, { type: 'hold', ids: [L.id] });
    sec(w, 0.25); // let the Lancer's team see the wall
    w.issue(lp, { type: 'attack', ids: [L.id], target: wall.id });
    put(spirit, wall.x + 3.5, wall.y + 3.5);
    until(w, () => wall.hp < wall.maxHp, 3);
    cast(w, 0, 'decay', { target: L.id });
    sec(w, 0.2);
    near(L.decayUntil - w.tick, 4.8 * T, 2);
    near(p0.cd.decay, 20 - 0.2, 0.3);
    let hp = wall.hp;
    sec(w, 4);
    near(hp - wall.hp, 10, 5.5); // ~2 strikes instead of ~4
    sec(w, 1);
    hp = wall.hp;
    sec(w, 4);
    near(hp - wall.hp, 20, 5.5);
    // Stasis then 6 s of spell immunity: Decay fails
    cast(w, 1, 'stasis', { target: L.id });
    sec(w, 0.2);
    expect(L.stasisUntil).toBeGreaterThan(w.tick);
    until(w, () => !(L.stasisUntil > w.tick), 5);
    sec(w, 0.2);
    expect(L.immuneUntil).toBeGreaterThan(w.tick);
    p0.cd.decay = 0; // test setup
    cast(w, 0, 'decay', { target: L.id });
    sec(w, 0.2);
    expect(L.decayUntil > w.tick).toBe(false);
  });
});

// =========================================================================================

describe('movement (section 9)', () => {
  it('PathGrid clearance 2 refuses a 1-cell gap that clearance 1 accepts', () => {
    const W = 20;
    const H = 20;
    const grid = (gaps) => {
      const g = new PathGrid({ width: W, height: H, flags: new Array(W * H).fill(CELL_PATHABLE | CELL_BUILDABLE) });
      for (let y = 0; y < H; y++) if (!gaps.includes(y)) g.setRect(10, y, 1, 1, 999);
      return g;
    };
    const goal = [15.5, 9.5];
    const last = (path) => (path && path.length ? path[path.length - 1] : null);
    const one = grid([9]);
    const p1 = one.findPath(4.5, 9.5, goal[0], goal[1], { radius: 0.4 });
    expect(Math.hypot(last(p1)[0] - goal[0], last(p1)[1] - goal[1])).toBeLessThan(0.75);
    const p2 = one.findPath(4.5, 9.5, goal[0], goal[1], { radius: 0.9, clearance: 2 });
    expect(!p2 || p2.every((pt) => pt[0] < 10)).toBe(true);
    const two = grid([9, 10]);
    const p3 = two.findPath(4.5, 9.5, goal[0], goal[1], { radius: 0.9, clearance: 2 });
    expect(p3).toBeTruthy();
    expect(Math.hypot(last(p3)[0] - goal[0], last(p3)[1] - goal[1])).toBeLessThan(1.5);
  });

  it('a Shaper walks through a 1-cell gap in a 2x2 wall ring, the Lancer cannot', () => {
    const w = game();
    const B = base(w, 0);
    const h = heroOf(w, 0);
    // ring of 2x2 walls around a 6x6 courtyard; the top side has a 1-cell gap at column rx + 4
    const rx = B.x + 1;
    const ry = B.y + 4;
    const blocks = [
      [0, 0], [2, 0], [5, 0], [7, 0],
      [0, 2], [0, 4], [0, 6], [0, 8],
      [8, 2], [8, 4], [8, 6], [8, 8],
      [2, 8], [4, 8], [6, 8],
    ];
    const ring = blocks.map(([ox, oy]) => w.createBuilding('wall', 0, rx + ox, ry + oy, true, { hp: 100000, level: 1 }));
    expect(ring.every((b) => b && !b.dead)).toBe(true);
    const inside = (u) => u.x > rx + 2 && u.x < rx + 8 && u.y > ry + 2 && u.y < ry + 8;
    const start = { x: rx + 4.5, y: B.y + 1.5 };
    const centre = { x: rx + 5, y: ry + 5 };
    expect(w.grid.pathable(rx + 4, ry)).toBe(true);
    expect(w.grid.pathable(rx + 3, ry)).toBe(false);
    expect(w.grid.pathable(rx + 5, ry)).toBe(false);
    put(h, start.x, start.y);
    w.issue(0, { type: 'move', ids: [h.id], x: centre.x, y: centre.y });
    until(w, () => inside(h), 8);
    expect(inside(h)).toBe(true);

    const L = waitLancer(w);
    const lp = L.owner;
    put(L, start.x, start.y);
    w.issue(lp, { type: 'move', ids: [L.id], x: centre.x, y: centre.y });
    let entered = false;
    for (let i = 0; i < 8 * T; i++) {
      tick(w);
      if (inside(L)) entered = true;
    }
    expect(entered).toBe(false);
    expect(inside(L)).toBe(false);
  });

  it('the Lancer paths around a 1-cell gap to a 2-cell opening (clearance-2 pathing)', () => {
    const w = game();
    const B = base(w, 0);
    // 8x8 ring around a 4x4 courtyard: 1-cell gap at the top (column rx + 4), 2-cell opening at the
    // bottom (columns rx + 4..5); 2-cell corridors all around inside the test base
    const rx = B.x + 2;
    const ry = B.y + 3;
    const blocks = [
      [0, 0], [2, 0], [5, 0],
      [0, 2], [0, 4], [0, 6],
      [6, 2], [6, 4], [6, 6],
      [2, 6],
    ];
    const ring = blocks.map(([ox, oy]) => w.createBuilding('wall', 0, rx + ox, ry + oy, true, { hp: 100000, level: 1 }));
    expect(ring.every((b) => b && !b.dead)).toBe(true);
    expect(w.grid.pathable(rx + 4, ry)).toBe(true);
    expect(w.grid.pathable(rx + 3, ry)).toBe(false);
    expect(w.grid.pathable(rx + 5, ry)).toBe(false);
    const inside = (u) => u.x > rx + 2 && u.x < rx + 6 && u.y > ry + 2 && u.y < ry + 6;
    const start = { x: rx + 4.5, y: ry - 1.5 };
    const centre = { x: rx + 4, y: ry + 4 };
    const L = waitLancer(w);
    const lp = L.owner;
    const away = w.grid.nearestFree(shopPos(w).x + 8, shopPos(w).y, 8); // keep the Shaper out of the way
    put(heroOf(w, 0), away[0] + 0.5, away[1] + 0.5);
    put(L, start.x, start.y);
    w.issue(lp, { type: 'move', ids: [L.id], x: centre.x, y: centre.y });
    let squeezed = false;
    let entryY = null;
    for (let i = 0; i < 14 * T && entryY === null && !w.over; i++) {
      tick(w);
      if (Math.abs(L.x - (rx + 4.5)) < 1 && L.y > ry + 0.5 && L.y < ry + 2) squeezed = true;
      if (inside(L)) entryY = L.y;
    }
    expect(squeezed).toBe(false);
    expect(entryY, 'the Lancer reached the courtyard').not.toBeNull();
    expect(entryY).toBeGreaterThan(ry + 4); // came in from the bottom opening
  });
});

// =========================================================================================

describe('death, Spirits and Hunters (section 8)', () => {
  it(
    'turns a Shaper killed before 5:00 into an invulnerable Spirit at once, removes its structures and miners, and respawns Spirits after 60 s',
    () => {
      const w = game({ shapers: 2, park: true });
      const p = w.players[0];
      const B = base(w, 0);
      p.gas = 2000;
      const gen = buildAt(w, 0, 'generator', B.slot(0));
      const wall = buildAt(w, 0, 'wall', B.slot(1));
      const depot = buildAt(w, 0, 'depot', B.slot(3));
      expect(gen && wall && depot).toBeTruthy();
      w.issue(0, { type: 'trainMiner', ids: heroIds(w, 0), id: depot.id, tier: 1 });
      const miner = until(w, () => unitsOf(w, 0, 'miner')[0], 8);
      expect(miner).toBeTruthy();
      expect(sim.gameTime(w)).toBeLessThan(300);
      const h = heroOf(w, 0);
      const log = record(w, () => {
        w.kill(h, null);
        sec(w, 0.5);
      });
      expect(p.alive).toBe(false);
      expect(p.form).toBe('spirit');
      expect(p.team).toBe(1);
      expect(log.some((e) => e.e === 'shaperDown' && e.owner === 0)).toBe(true);
      expect(ownedBuildings(w, 0)).toHaveLength(0);
      expect(unitsOf(w, 0, 'miner')).toHaveLength(0);
      expect(pickupsOf(w, 'pallet')).toHaveLength(0);
      const spirit = until(w, () => unitsOf(w, 0, 'spirit')[0], 1);
      expect(spirit).toBeTruthy();
      expect(spirit.maxHp).toBe(60);
      expect(spirit.invulnUntil - w.tick).toBeGreaterThan(28 * T);
      const hp = spirit.hp;
      applyDamage(w, spirit, 1000, null);
      expect(spirit.hp).toBe(hp);
      expect(spirit.dead).toBe(false);
      // Spirits can't build
      p.gas = 100;
      w.issue(0, buildCmd(w, 0, 'wall', B.slot(2)));
      sec(w, 3);
      expect(ownedBuildings(w, 0)).toHaveLength(0);
      expect(w.over).toBe(false);
      // dead Spirits come back after 60 s
      sec(w, 28);
      const log2 = record(w, () => {
        w.kill(spirit, null);
        sec(w, 0.2);
      });
      expect(log2.some((e) => e.e === 'spiritDown')).toBe(true);
      expect(unitsOf(w, 0, 'spirit')).toHaveLength(0);
      sec(w, 58);
      expect(unitsOf(w, 0, 'spirit')).toHaveLength(0);
      expect(until(w, () => unitsOf(w, 0, 'spirit')[0], 3)).toBeTruthy();
      expect(w.over).toBe(false);
    },
    LONG,
  );

  it(
    'after 5:00 a dead Shaper may become a Hunter (team 2, at the Shop, own items, respawns in 20 s) or defaults to a Spirit after 15 s',
    () => {
      const w = game({ shapers: 3, park: true });
      const lp = lancerPid(w);
      const [p0, p1] = w.players;
      sec(w, 299);
      const log = record(w, () => sec(w, 2));
      expect(log.some((e) => e.e === 'unlock')).toBe(true);
      w.kill(heroOf(w, 0), lancerHero(w));
      w.kill(heroOf(w, 1), null);
      sec(w, 0.5);
      for (const p of [p0, p1]) {
        expect(p.alive).toBe(false);
        expect(p.pendingForm).toBeGreaterThan(w.tick);
        expect(p.pendingForm - w.tick).toBeLessThanOrEqual(15 * T);
      }
      expect(unitsOf(w, 0, 'hunter').length + unitsOf(w, 0, 'spirit').length).toBe(0);
      const log2 = record(w, () => {
        w.issue(0, { type: 'chooseForm', form: 'hunter' });
        sec(w, 0.5);
      });
      expect(p0.form).toBe('hunter');
      expect(p0.team).toBe(2);
      expect(log2.some((e) => e.e === 'form' && e.owner === 0 && e.form === 'hunter')).toBe(true);
      const hunter = unitsOf(w, 0, 'hunter')[0];
      expect(hunter).toBeTruthy();
      w.issue(0, { type: 'hold', ids: [hunter.id] });
      expect(hunter.maxHp).toBe(250);
      expect(dist(hunter, shopPos(w))).toBeLessThanOrEqual(8.5);
      expect(p0.items).toEqual([]);
      expect(p0.minerals).toBeLessThan(1);
      expect(w.areEnemies(0, 2)).toBe(true);
      expect(w.areEnemies(0, lp)).toBe(false);
      // p1 never chose: Spirit
      until(w, () => p1.form === 'spirit' && unitsOf(w, 1, 'spirit').length > 0, 16);
      expect(p1.form).toBe('spirit');
      expect(unitsOf(w, 1, 'spirit')).toHaveLength(1);
      // Hunters get the passive income and their own 6 slots
      const m0 = p0.minerals;
      sec(w, 5);
      near(p0.minerals - m0, 5, 0.6);
      p0.minerals = 500; // test setup
      shopCmd(w, 0, { type: 'buy', item: 'blade1' });
      sec(w, 0.1);
      expect(p0.items).toEqual(['blade1']);
      expect(hunter.damage).toBe(7);
      expect(w.players[lp].items).toEqual([]);
      // no Scan for Hunters
      cast(w, 0, 'scan', { x: hunter.x + 20, y: hunter.y });
      sec(w, 0.2);
      expect(w.survival.scans.some((s) => s.owner === 0)).toBe(false);
      // respawns at the Shop after 20 s with its items
      const log3 = record(w, () => {
        w.kill(hunter, null);
        sec(w, 0.2);
      });
      expect(log3.some((e) => e.e === 'hunterDown')).toBe(true);
      sec(w, 18.5);
      expect(unitsOf(w, 0, 'hunter')).toHaveLength(0);
      const back = until(w, () => unitsOf(w, 0, 'hunter')[0], 3);
      expect(back).toBeTruthy();
      expect(dist(back, shopPos(w))).toBeLessThanOrEqual(8.5);
      expect(p0.items).toEqual(['blade1']);
      expect(back.damage).toBe(7);
      // Hunters are not the Lancer: killing the Lancer still wins for the Shapers
      expect(w.over).toBe(false);
      w.kill(lancerHero(w), heroOf(w, 2));
      sec(w, 1.1);
      expect(w.over).toBe(true);
      expect(w.winnerTeam).toBe(1);
    },
    LONG,
  );
});

// =========================================================================================

describe('gold lock (section 2)', () => {
  it(
    'forbids building within 10 cells of a gold field before 5:00',
    () => {
      const w = game({ park: true });
      const p = w.players[0];
      const B = base(w, 0);
      const h = heroOf(w, 0);
      p.gas = 1000;
      const s = goldSpot(w);
      expect(s, 'a buildable spot next to gold').toBeTruthy();
      const chk = sim.canPlaceSurvival(w, 0, 'wall', s.bx, s.by, 1);
      expect(chk.ok).toBe(false);
      expect(chk.reason).toMatch(/5:00/);
      expect(sim.canPlaceSurvival(w, 0, 'wall', B.slot(0).bx, B.slot(0).by, 1).ok).toBe(true);
      const nf = w.grid.nearestFree(s.bx + 1, s.by + 3.5, 6);
      put(h, nf[0] + 0.5, nf[1] + 0.5);
      const log = record(w, () => {
        w.issue(0, buildCmd(w, 0, 'wall', s));
        sec(w, 4);
      });
      expect(findB(w, 0, 'wall', s.bx, s.by)).toBeNull();
      expect(p.gas).toBe(1000);
      expect(errorsOf(log, 0).some((m) => /5:00/.test(m))).toBe(true);
      sec(w, 300 - sim.gameTime(w) + 1);
      expect(sim.canPlaceSurvival(w, 0, 'wall', s.bx, s.by, 1).ok).toBe(true);
      put(h, nf[0] + 0.5, nf[1] + 0.5);
      expect(placeAt(w, 0, 'wall', s, {}, 5)).toBeTruthy();
    },
    LONG,
  );
});

// =========================================================================================

describe('victory (section 1)', () => {
  it('Shapers win when the Lancer hero dies', () => {
    const w = game();
    const L = waitLancer(w);
    const log = record(w, () => {
      w.kill(L, heroOf(w, 0));
      sec(w, 1.1);
    });
    expect(w.over).toBe(true);
    expect(w.winnerTeam).toBe(1);
    expect(w.survival.winner).toBe(1);
    expect(log.some((e) => e.e === 'lancerDown')).toBe(true);
    expect(log.some((e) => e.e === 'gameOver')).toBe(true);
  });

  it('the Lancer wins once no Shaper hero is alive (Spirits do not count)', () => {
    const w = game({ shapers: 2 });
    w.kill(heroOf(w, 0), null);
    sec(w, 1.1);
    expect(w.over).toBe(false);
    w.kill(heroOf(w, 1), null);
    sec(w, 1.1);
    expect(w.over).toBe(true);
    expect(w.winnerTeam).toBe(2);
    expect(w.survival.winner).toBe(2);
  });

  it('Shapers win when the Lancer player leaves', () => {
    const w = game();
    w.issue(lancerPid(w), { type: 'surrender' });
    sec(w, 1.1);
    expect(w.over).toBe(true);
    expect(w.winnerTeam).toBe(1);
  });

  it('Shapers win when the optional time limit runs out', () => {
    const w = game({ duration: 60 });
    expect(Math.abs(w.survival.endTick - 60 * T)).toBeLessThanOrEqual(1);
    sec(w, 59);
    expect(w.over).toBe(false);
    until(w, () => w.over, 2.5);
    expect(w.over).toBe(true);
    expect(w.winnerTeam).toBe(1);
    expect(w.survival.reason).toBeTruthy();
  });
});

// =========================================================================================

describe('module helpers (section 15)', () => {
  it('upgradeInfo reports cost, time and the missing requirement', () => {
    const w = game();
    const p = w.players[0];
    const B = base(w, 0);
    p.gas = 1000;
    const gen = buildAt(w, 0, 'generator', B.slot(0));
    expect(gen).toBeTruthy();
    let info = sim.upgradeInfo(w, gen);
    expect(info.ok).toBe(false);
    expect(info.reason).toMatch(/wall 1/i);
    expect(info.gas).toBe(50);
    expect(info.minerals ?? 0).toBe(0);
    expect(info.time).toBe(5);
    const wall = buildAt(w, 0, 'wall', B.slot(1));
    expect(wall).toBeTruthy();
    info = sim.upgradeInfo(w, gen);
    expect(info.ok).toBe(true);
    info = sim.upgradeInfo(w, wall);
    expect(info.ok).toBe(true);
    expect(info.gas).toBe(8);
    expect(info.time).toBe(2);
  });
});

// =========================================================================================

describe('combat timing and the Shaper hero (sections 3, 7.2, 14.2)', () => {
  // test setup: the Lancer stands below an unkillable Wall and has seen it, then attacks it
  function lancerAtWall(w) {
    w.players[0].gas = 100;
    const wall = buildAt(w, 0, 'wall', base(w, 0).slot(4));
    expect(wall).toBeTruthy();
    wall.hp = wall.maxHp = 1e15;
    const L = waitLancer(w);
    put(L, wall.x, wall.y + 2.5);
    w.issue(L.owner, { type: 'hold', ids: [L.id] });
    sec(w, 0.25);
    w.issue(L.owner, { type: 'attack', ids: [L.id], target: wall.id });
    sec(w, 1);
    return { wall, L, Lp: w.players[L.owner] };
  }

  it('strikes come exactly every 1 / (1 + attack speed) seconds on average (gloves, Pro Blade, Decay)', () => {
    const w = game();
    const { wall, L, Lp } = lancerAtWall(w);
    const cases = [[], ['glove1'], ['glove2'], ['glove3'], ['glove4'], ['glove5'], ['glove6'], ['glove7'], ['glove8'], ['blade9']];
    for (const items of cases) {
      Lp.items = items; // test setup: owned items
      sim.recomputeLancer(w, L);
      const period = 1 / (1 + data.lancerStats(items).as);
      expect(L.strikeCooldown).toBeCloseTo(period, 9);
      const hp = wall.hp;
      const log = record(w, () => sec(w, 10));
      const strikes = log.filter((e) => e.e === 'strike' && e.a === L.id).length;
      near(strikes, 10 / period, 1);
      expect(hp - wall.hp).toBeCloseTo(strikes * L.damage, 3);
    }
    // Decay doubles the period: Final Blade (+2400%) under Decay strikes every 0.08 s, not every 0.1 s
    Lp.items = ['blade17'];
    sim.recomputeLancer(w, L);
    L.decayUntil = w.tick + 20 * T; // test setup: a Spirit's Decay
    sec(w, 0.2);
    const log = record(w, () => sec(w, 10));
    near(log.filter((e) => e.e === 'strike' && e.a === L.id).length, 125, 1);
  });

  it('a Shaper hero (20 HP + 20 barrier) dies to 2 base strikes, or 1 with 11 damage; feed is what it had', () => {
    for (const [items, strikesToKill] of [[[], 2], [['blade1', 'blade2'], 1]]) {
      const w = game();
      const S = heroOf(w, 0);
      expect(S.maxHp).toBe(20);
      expect(S.maxBarrier).toBe(20);
      const L = waitLancer(w);
      const Lp = w.players[L.owner];
      Lp.items = items; // test setup
      sim.recomputeLancer(w, L);
      put(L, S.x, S.y - 1.4);
      w.issue(L.owner, { type: 'hold', ids: [L.id] });
      w.issue(0, { type: 'hold', ids: [S.id] });
      sec(w, 0.25);
      const fed = Lp.stats.fed;
      const log = record(w, () => {
        w.issue(L.owner, { type: 'attack', ids: [L.id], target: S.id });
        until(w, () => S.dead, 5);
      });
      expect(S.dead).toBe(true);
      expect(log.filter((e) => e.e === 'strike' && e.a === L.id)).toHaveLength(strikesToKill);
      expect(Lp.stats.fed - fed).toBeCloseTo(40, 6);
    }
  });

  it('a slightly faster Lancer catches a Shaper walking away in a straight line and keeps striking it', () => {
    const w = game({ bases: false });
    const S = heroOf(w, 0);
    const L = waitLancer(w);
    const a = findArea(w, 30, 5, { minShop: 12 });
    expect(a, 'an open 30x5 strip').toBeTruthy();
    S.barrier = S.maxBarrier = 1e6; // test setup: survive the chase so the strikes can be counted
    put(S, a.x + 3.6, a.y + 2.5);
    put(L, a.x + 2, a.y + 2.5);
    w.issue(0, { type: 'hold', ids: [S.id] });
    w.issue(L.owner, { type: 'hold', ids: [L.id] });
    sec(w, 0.25);
    put(S, a.x + 3.6, a.y + 2.5);
    put(L, a.x + 2, a.y + 2.5);
    w.issue(0, { type: 'move', ids: [S.id], x: a.x + 29.5, y: a.y + 2.5 });
    w.issue(L.owner, { type: 'attack', ids: [L.id], target: S.id });
    sec(w, 0.5);
    const log = record(w, () => sec(w, 5.5));
    expect(S.x).toBeGreaterThan(a.x + 20); // it kept fleeing
    expect(log.filter((e) => e.e === 'strike' && e.a === L.id).length).toBeGreaterThanOrEqual(3);
  });
});

describe('targeting, reach and hidden information (sections 4.4, 6, 9)', () => {
  it('turrets and auto-targeting skip units in a Stasis Prison or invulnerable ones', () => {
    const w = game({ shapers: 2 });
    const B = base(w, 1);
    const p1 = w.players[1];
    p1.gas = 1000;
    pick(w, 1, ['stasis', 'blink']);
    const gen = buildAt(w, 1, 'generator', B.slot(4));
    const t = buildAt(w, 1, 'turret', B.slot(0));
    expect(gen && t).toBeTruthy();
    // a turret holds its fire while the only Lancer in range is in a Stasis Prison
    const L = waitLancer(w);
    const lp = L.owner;
    put(L, t.x + 3, t.y + 2.5);
    w.issue(lp, { type: 'hold', ids: [L.id] });
    put(heroOf(w, 1), t.x + 4, t.y + 5);
    sec(w, 0.5);
    cast(w, 1, 'stasis', { target: L.id });
    sec(w, 0.1);
    expect(L.stasisUntil).toBeGreaterThan(w.tick + 3 * T);
    const log = record(w, () => sec(w, 3.5));
    expect(log.filter((e) => e.e === 'bolt' && e.from === t.id)).toHaveLength(0);
    const log2 = record(w, () => sec(w, 2));
    expect(log2.filter((e) => e.e === 'bolt' && e.from === t.id).length).toBeGreaterThan(0);
    // an idle Lancer next to an invulnerable Spirit (Shaper 0 died before 5:00) hits the Generator instead
    w.kill(heroOf(w, 0), null);
    const spirit = until(w, () => unitsOf(w, 0, 'spirit')[0], 2);
    expect(spirit.invulnUntil).toBeGreaterThan(w.tick + 20 * T);
    put(L, gen.x, gen.y + 3.9);
    put(spirit, L.x + 1.4, L.y);
    put(heroOf(w, 1), B.x + 11.5, B.y + 0.5);
    w.issue(lp, { type: 'stop', ids: [L.id] });
    const log3 = record(w, () => sec(w, 3));
    expect(log3.filter((e) => e.e === 'swing' && e.a === L.id && e.t === spirit.id)).toHaveLength(0);
    expect(gen.hp).toBeLessThan(gen.maxHp);
  });

  it('a Lancer ordered to attack a Generator inside a closed wall ring hits the ring; with nothing to break it gives up', () => {
    const w = game();
    const p = w.players[0];
    const B = base(w, 0);
    p.gas = 1000;
    const gx = B.x + 5;
    const gy = B.y + 3;
    const gen = buildAt(w, 0, 'generator', { bx: gx, by: gy });
    expect(gen).toBeTruthy();
    const walls = [];
    for (let dy = -2; dy <= 2; dy += 2) {
      for (let dx = -2; dx <= 2; dx += 2) if (dx || dy) walls.push(buildAt(w, 0, 'wall', { bx: gx + dx, by: gy + dy }));
    }
    expect(walls.every(Boolean)).toBe(true);
    const L = waitLancer(w);
    put(L, gx + 1, gy + 6);
    w.issue(L.owner, { type: 'hold', ids: [L.id] });
    sec(w, 0.25);
    w.issue(L.owner, { type: 'attack', ids: [L.id], target: gen.id });
    sec(w, 6);
    expect(walls.some((b) => b.dead || b.hp < b.maxHp)).toBe(true);
    until(w, () => gen.hp < gen.maxHp, 20);
    expect(gen.hp).toBeLessThan(gen.maxHp);

    // a Generator behind blocked terrain (no structure in the way): the attack order ends
    const w2 = game();
    const B2 = base(w2, 0);
    const g2 = buildAt(w2, 0, 'generator', { bx: B2.x + 5, by: B2.y + 3 });
    expect(g2).toBeTruthy();
    for (let y = g2.by - 2; y < g2.by + 4; y++) {
      for (let x = g2.bx - 2; x < g2.bx + 4; x++) if (!(x >= g2.bx && x < g2.bx + 2 && y >= g2.by && y < g2.by + 2)) w2.grid.setRect(x, y, 1, 1, 999999); // test setup: a cliff ring
    }
    const L2 = waitLancer(w2);
    put(L2, g2.x, g2.y + 6);
    w2.issue(L2.owner, { type: 'hold', ids: [L2.id] });
    sec(w2, 0.25);
    const log = record(w2, () => {
      w2.issue(L2.owner, { type: 'attack', ids: [L2.id], target: g2.id });
      until(w2, () => L2.orders.length === 0, 5);
    });
    expect(L2.orders).toHaveLength(0);
    expect(log.filter((e) => e.e === 'swing' && e.a === L2.id)).toHaveLength(0);
  });

  it('entity ids never lead the Lancer to a Shaper or structure its team cannot see', () => {
    const w = game({ park: true });
    const p = w.players[0];
    p.gas = 100;
    pick(w, 0, ['stasis', 'cloak']);
    const wall = buildAt(w, 0, 'wall', base(w, 0).slot(4));
    const S = heroOf(w, 0);
    const L = waitLancer(w);
    const lp = L.owner;
    sec(w, 0.5);
    expect(w.isVisibleTo(S, lp)).toBe(false);
    expect(w.isVisibleTo(wall, lp)).toBe(false);
    const x0 = L.x;
    const y0 = L.y;
    for (const c of [
      { type: 'follow', target: S.id },
      { type: 'gather', target: S.id },
      { type: 'attack', target: S.id },
      { type: 'attack', target: wall.id },
      { type: 'gather', target: wall.id },
    ]) {
      w.issue(lp, { ...c, ids: [L.id] });
      sec(w, 2);
      expect(Math.hypot(L.x - x0, L.y - y0), JSON.stringify(c)).toBeLessThan(0.5);
    }
    // following a visible Shaper stops once it cloaks
    put(L, S.x, S.y - 3);
    w.issue(lp, { type: 'hold', ids: [L.id] });
    sec(w, 0.25);
    expect(w.isVisibleTo(S, lp)).toBe(true);
    w.issue(lp, { type: 'follow', ids: [L.id], target: S.id });
    sec(w, 0.2);
    expect(L.orders[0]?.type).toBe('follow');
    cast(w, 0, 'cloak');
    sec(w, 0.5);
    expect(L.orders).toHaveLength(0);
  });

  it('Turret 11 sees as far as it shoots (no other vision needed at 10 cells)', () => {
    const w = game({ park: true });
    const p = w.players[0];
    const B = base(w, 0);
    p.gas = 1e6;
    p.minerals = 1e6;
    expect(buildAt(w, 0, 'library', B.slot(2))).toBeTruthy();
    const t = buildAt(w, 0, 'turret', B.slot(0), { level: 11 }, 45);
    expect(t).toBeTruthy();
    expect(t.level).toBe(11);
    const L = waitLancer(w);
    L.hp = L.maxHp = 1e9; // test setup
    put(heroOf(w, 0), B.x + 11.5, B.y + 0.5);
    put(L, t.x, t.y + 10);
    w.issue(L.owner, { type: 'hold', ids: [L.id] });
    sec(w, 0.5);
    expect(rectDist(L, t) - L.r).toBeLessThanOrEqual(9);
    expect(w.isVisibleTo(L, 0)).toBe(true);
    const hp = L.hp;
    sec(w, 3);
    expect(hp - L.hp).toBeGreaterThan(40960 * 2);
  });
});

describe('economy edge cases (sections 1, 4.5, 4.7, 6)', () => {
  it('pace only accepts 1, 2 or 4', () => {
    for (const [pace, expected] of [[1, 1], [2, 2], [4, 4], [3, 1], [16, 1], [0.5, 1], [-2, 1]]) {
      expect(game({ pace, bases: false }).options.pace, `pace ${pace}`).toBe(expected);
    }
  });

  it('Barrier Field reaches 9 cells from the Shaper, not further', () => {
    const w = game();
    const p = w.players[0];
    const h = heroOf(w, 0);
    pick(w, 0, ['barrierField', 'blink']);
    const far = { x: h.x, y: h.y - 9.5 };
    const log = record(w, () => {
      cast(w, 0, 'barrierField', far);
      sec(w, 0.2);
    });
    expect(w.survival.fields).toHaveLength(0);
    expect(errorsOf(log, 0)).toContain('Out of range');
    cast(w, 0, 'barrierField', { x: h.x, y: h.y - 8.8 });
    sec(w, 0.2);
    expect(w.survival.fields).toHaveLength(1);
    expect(p.cd.barrierField).toBeGreaterThan(0);
  });

  it('Overcharge does not speed up training at a Collection Depot', () => {
    const w = game({ park: true });
    const p = w.players[0];
    p.gas = 10000;
    pick(w, 0, ['overcharge', 'blink']);
    const depot = buildAt(w, 0, 'depot', base(w, 0).slot(4));
    expect(depot).toBeTruthy();
    w.issue(0, { type: 'trainMiner', ids: heroIds(w, 0), id: depot.id, tier: 1 });
    cast(w, 0, 'overcharge', { target: depot.id });
    const t0 = w.tick;
    sec(w, 0.1);
    expect(depot.overchargeUntil).toBeGreaterThan(w.tick);
    expect(until(w, () => unitsOf(w, 0, 'miner')[0], 8)).toBeTruthy();
    near((w.tick - t0) / T, 5, 0.15);
  });

  it('cancelling a salvage resumes the upgrade it interrupted (paid once)', () => {
    const w = game();
    const p = w.players[0];
    p.gas = 100;
    const wall = buildAt(w, 0, 'wall', base(w, 0).slot(4));
    w.issue(0, upgradeCmd(w, 0, wall));
    sec(w, 0.5);
    expect(wall.upgrading).toBeGreaterThan(1);
    const gas = p.gas;
    w.issue(0, salvageCmd(w, 0, wall));
    sec(w, 0.5);
    expect(wall.salvaging).toBeGreaterThan(0);
    expect(wall.upgrading).toBe(0);
    w.issue(0, { type: 'cancel', ids: heroIds(w, 0), id: wall.id });
    tick(w);
    expect(wall.salvaging).toBe(0);
    expect(wall.upgrading).toBeGreaterThan(1);
    until(w, () => wall.level === 2, 3);
    expect(wall.level).toBe(2);
    expect(p.gas).toBeCloseTo(gas, 6);
    expect(wall.invested.gas).toBe(12);
  });

  it('salvaging a Depot also refunds the miners still in its queue', () => {
    const w = game({ park: true });
    const p = w.players[0];
    p.gas = 10000;
    const depot = buildAt(w, 0, 'depot', base(w, 0).slot(4));
    for (let k = 0; k < 3; k++) w.issue(0, { type: 'trainMiner', ids: heroIds(w, 0), id: depot.id, tier: 2 });
    sec(w, 0.1);
    expect(depot.queue).toHaveLength(3);
    const g0 = p.gas;
    const log = record(w, () => {
      w.issue(0, salvageCmd(w, 0, depot));
      sec(w, 3.5);
    });
    expect(gone(w, depot)).toBe(true);
    expect(unitsOf(w, 0, 'miner')).toHaveLength(0);
    expect(p.gas - g0).toBeCloseTo(256 + 3 * 1024, 6);
    expect(log.find((e) => e.e === 'salvaged')?.gas).toBe(256 + 3 * 1024);
  });

  it('miners skip a walled-in field and prefer gold only when it is about as close as a normal field', () => {
    // a walled-in gold field: the miner goes to a reachable one and mines there
    const w = game({ park: true });
    const p = w.players[0];
    p.gas = 100000;
    const spot = depotNearGold(w);
    const nf = w.grid.nearestFree(spot.bx + 1.5, spot.by + 4.5, 6);
    put(heroOf(w, 0), nf[0] + 0.5, nf[1] + 0.5);
    const depot = buildAt(w, 0, 'depot', spot);
    expect(depot).toBeTruthy();
    const c = { x: depot.x, y: depot.y };
    const gold = fields(w).reduce((a, r) => (!a || dist(r, c) < dist(a, c) ? r : a), null);
    expect(gold.rich).toBe(true);
    for (let y = gold.by - 2; y < gold.by + gold.h + 2; y++) {
      for (let x = gold.bx - 2; x < gold.bx + gold.w + 2; x++) {
        const inside = x >= gold.bx && x < gold.bx + gold.w && y >= gold.by && y < gold.by + gold.h;
        if (!inside && w.grid.pathable(x, y)) w.grid.setRect(x, y, 1, 1, 999999); // test setup: walled in
      }
    }
    w.issue(0, { type: 'trainMiner', ids: heroIds(w, 0), id: depot.id, tier: 1 });
    const m = until(w, () => unitsOf(w, 0, 'miner')[0], 8);
    expect(m).toBeTruthy();
    sec(w, 0.1);
    expect(m.orders[0]?.type).toBe('mine');
    expect(m.orders[0].target).not.toBe(gold.id);
    const m0 = p.minerals;
    sec(w, 40);
    expect(p.minerals).toBeGreaterThan(m0);

    // a depot whose nearest field is normal and gold is much farther: tier 1-4 miners stay home
    const w2 = game({ park: true });
    const p2 = w2.players[0];
    p2.gas = 100000;
    const clear = clearTable(w2);
    const all = fields(w2);
    let spot2 = null;
    for (let y = 2; y < w2.map.height - 6 && !spot2; y++) {
      for (let x = 2; x < w2.map.width - 6 && !spot2; x++) {
        if (!clear(x - 1, y - 1, 5, 5)) continue;
        const cc = { x: x + 1.5, y: y + 1.5 };
        if (dist(cc, shopPos(w2)) < 14) continue;
        const near0 = all.reduce((a, r) => (!a || dist(r, cc) < dist(a, cc) ? r : a), null);
        const g = all.filter((r) => r.rich).reduce((a, r) => (!a || dist(r, cc) < dist(a, cc) ? r : a), null);
        if (!near0.rich && dist(near0, cc) < 8 && dist(g, cc) > dist(near0, cc) + 14 && dist(g, cc) < 40) spot2 = { bx: x, by: y, home: near0 };
      }
    }
    expect(spot2, 'a depot spot near a normal grove, 14-40 cells from gold').toBeTruthy();
    const nf2 = w2.grid.nearestFree(spot2.bx + 1.5, spot2.by + 4.5, 6);
    put(heroOf(w2, 0), nf2[0] + 0.5, nf2[1] + 0.5);
    const d2 = buildAt(w2, 0, 'depot', spot2);
    expect(d2).toBeTruthy();
    w2.issue(0, { type: 'trainMiner', ids: heroIds(w2, 0), id: d2.id, tier: 1 });
    const m2 = until(w2, () => unitsOf(w2, 0, 'miner')[0], 8);
    sec(w2, 0.1);
    const field = w2.byId.get(m2.orders[0]?.target);
    expect(field).toBeTruthy();
    expect(field.rich).toBe(false);
  });

  it('ignores structure, item and ability names that are not in the tables ("__proto__", "toString", ...)', () => {
    const w = game();
    const p = w.players[0];
    p.gas = 1000;
    const s = base(w, 0).slot(4);
    const n0 = w.buildings.length;
    for (const bad of ['__proto__', 'toString', 'valueOf', 'constructor', 'hasOwnProperty', ['wall'], 'shop']) {
      const log = record(w, () => {
        w.issue(0, buildCmd(w, 0, bad, s));
        sec(w, 2);
        w.issue(0, { type: 'gather', ids: heroIds(w, 0), target: w.nextId - 1 });
        sec(w, 1);
      });
      expect(w.buildings.length, String(bad)).toBe(n0);
      expect(errorsOf(log, 0)).toContain('Unknown structure');
      expect(sim.canPlaceSurvival(w, 0, bad, s.bx, s.by).ok).toBe(false);
    }
    expect(sim.buildCost('__proto__')).toEqual({ gas: 0, minerals: 0 });
    expect(p.gas).toBe(1000);
    const L = waitLancer(w);
    const Lp = w.players[L.owner];
    const m0 = Lp.minerals;
    const log = record(w, () => {
      for (const bad of ['__proto__', 'toString', 'constructor']) {
        shopCmd(w, L.owner, { type: 'buy', item: bad });
        shopCmd(w, L.owner, { type: 'ability', ability: bad, x: L.x, y: L.y });
        sec(w, 0.6);
      }
    });
    expect(Lp.items).toHaveLength(0);
    expect(Lp.minerals).toBeGreaterThanOrEqual(m0);
    expect(errorsOf(log, L.owner)).toContain('Unknown item');
    expect(errorsOf(log, L.owner)).toContain('Unknown ability');
    for (const e of [...w.units, ...w.buildings]) expect(Number.isFinite(e.x) && Number.isFinite(e.y)).toBe(true);
  });
});

// =========================================================================================

describe('determinism', () => {
  function scripted(seed) {
    const w = game({ shapers: 2, seed, bonuses: true });
    const A = base(w, 0);
    const Bb = base(w, 1);
    const lp = lancerPid(w);
    w.players[0].gas = 300;
    w.players[1].gas = 300;
    pick(w, 0, ['stasis', 'blink']);
    pick(w, 1, ['invuln', 'swift']);
    w.issue(0, buildCmd(w, 0, 'generator', A.slot(0)));
    w.issue(1, buildCmd(w, 1, 'generator', Bb.slot(0)));
    sec(w, 6);
    w.issue(0, buildCmd(w, 0, 'wall', A.slot(1)));
    w.issue(1, buildCmd(w, 1, 'turret', Bb.slot(1)));
    sec(w, 6);
    const gen = w.buildings.find((b) => b.owner === 0 && b.type === 'generator');
    if (gen) w.issue(0, upgradeCmd(w, 0, gen));
    sec(w, 30);
    w.players[lp].minerals += 300;
    w.issue(lp, { type: 'buy', ids: heroIds(w, lp), item: 'blade1' });
    const L = lancerHero(w);
    if (L) w.issue(lp, { type: 'attackMove', ids: [L.id], x: A.cx, y: A.cy });
    sec(w, 40);
    return digest(w);
  }

  it('the same seed and commands give the same game', () => {
    expect(scripted(5)).toBe(scripted(5));
  });

  it(
    'AI-only games are deterministic and AI Shapers pick their abilities at setup',
    () => {
      const mk = () => {
        const players = [0, 1, 2].map((i) => ({ name: `AI ${i}`, type: 'ai', role: 'shaper', difficulty: 'normal' }));
        players.push({ name: 'AI Lancer', type: 'ai', role: 'lancer', difficulty: 'normal' });
        return new World({ mapId: MAP, mode: 'survival', players, seed: 4 });
      };
      const first = mk();
      for (const p of first.players) if (p.role === 'shaper') expect(p.abilities).toHaveLength(2);
      const run = (w) => {
        for (let i = 0; i < 100 * T && !w.over; i++) {
          w.step();
          w.events.length = 0;
        }
        return digest(w);
      };
      expect(run(first)).toBe(run(mk()));
    },
    LONG,
  );
});
