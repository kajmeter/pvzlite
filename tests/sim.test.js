import { describe, it, expect } from 'vitest';
import { World } from '../src/shared/sim/world.js';
import { applyDamage } from '../src/shared/sim/combat.js';
import { TICK_RATE, BARRIER_REGEN_DELAY } from '../src/shared/constants.js';
import { UNITS, BUILDINGS } from '../src/shared/data/defs.js';

const twoPlayers = (a = 'human', b = 'human') => [
  { name: 'A', type: a, difficulty: 'hard' },
  { name: 'B', type: b, difficulty: 'hard' },
];

function sec(w, s) {
  w.run(Math.round(s * TICK_RATE));
}

function emptyArena() {
  // a world where we remove everything except what the test spawns
  const w = new World({ mapId: 'frostgate', players: twoPlayers(), seed: 3 });
  for (const u of [...w.units]) w.kill(u, null, true);
  w.removeDead();
  return w;
}

describe('setup', () => {
  it('starts every player with a Citadel, 12 Shapers and 50 crystals', () => {
    const w = new World({ mapId: 'frostgate', players: twoPlayers(), seed: 1 });
    for (const p of w.players) {
      expect(w.buildings.filter((b) => b.owner === p.id && b.type === 'citadel')).toHaveLength(1);
      expect(w.units.filter((u) => u.owner === p.id && u.type === 'shaper')).toHaveLength(12);
      expect(p.crystals).toBe(50);
      expect(p.supplyUsed).toBe(12);
      expect(p.supplyCap).toBe(15);
    }
  });

  it('places 4-player maps cross-spawn for 1v1', () => {
    const w = new World({ mapId: 'quarry', players: twoPlayers(), seed: 1 });
    const [a, b] = w.players.map((p) => w.map.bases[p.startBase]);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(100);
  });
});

describe('economy', () => {
  it('Shapers mine crystals automatically from the start', () => {
    const w = new World({ mapId: 'frostgate', players: twoPlayers(), seed: 2 });
    sec(w, 60);
    // 12 workers should collect well over 500 crystals in the first minute
    expect(w.players[0].stats.crystalsMined).toBeGreaterThan(500);
    expect(w.players[0].stats.crystalsMined).toBeLessThan(1100);
  });

  it('trains a Shaper for 50 crystals in 12 seconds', () => {
    const w = new World({ mapId: 'frostgate', players: twoPlayers(), seed: 2 });
    const c = w.buildings.find((b) => b.owner === 0 && b.type === 'citadel');
    w.issue(0, { type: 'train', ids: [c.id], unit: 'shaper' });
    sec(w, 0.1);
    expect(c.queue).toHaveLength(1);
    const before = w.units.filter((u) => u.owner === 0).length;
    sec(w, 12.2);
    expect(w.units.filter((u) => u.owner === 0).length).toBe(before + 1);
    expect(w.players[0].supplyUsed).toBe(13);
  });

  it('refuses to train without enough crystals and refunds cancelled items', () => {
    const w = new World({ mapId: 'frostgate', players: twoPlayers(), seed: 2 });
    const c = w.buildings.find((b) => b.owner === 0 && b.type === 'citadel');
    w.players[0].crystals = 120;
    w.issue(0, { type: 'train', ids: [c.id], unit: 'shaper', count: 5 });
    sec(w, 0.1);
    expect(c.queue).toHaveLength(2);
    w.issue(0, { type: 'cancel', building: c.id });
    sec(w, 0.1);
    expect(c.queue).toHaveLength(1);
    expect(w.players[0].crystals).toBeGreaterThanOrEqual(70);
  });

  it('harvests flux from a Siphon', () => {
    const w = new World({ mapId: 'frostgate', players: twoPlayers(), seed: 2 });
    const p = w.players[0];
    p.crystals = 500;
    const base = w.map.bases[p.startBase];
    const vent = w.resources.find((r) => r.type === 'vent' && Math.hypot(r.x - base.x, r.y - base.y) < 12);
    const worker = w.units.find((u) => u.owner === 0 && u.type === 'shaper');
    w.issue(0, { type: 'build', ids: [worker.id], building: 'siphon', bx: vent.bx, by: vent.by });
    sec(w, 30);
    const siphon = w.buildings.find((b) => b.owner === 0 && b.type === 'siphon');
    expect(siphon).toBeTruthy();
    expect(siphon.built).toBe(true);
    const workers = w.units.filter((u) => u.owner === 0 && u.type === 'shaper').slice(0, 3);
    w.issue(0, { type: 'gather', ids: workers.map((u) => u.id), target: siphon.id });
    sec(w, 40);
    expect(p.flux).toBeGreaterThan(40);
  });
});

describe('construction', () => {
  it('requires power for a Portal and accepts it near a Conduit', () => {
    const w = new World({ mapId: 'frostgate', players: twoPlayers(), seed: 2 });
    const p = w.players[0];
    p.crystals = 1000;
    const base = w.map.bases[p.startBase];
    // a spot on the main plateau away from the crystal line
    const ax = Math.round(base.x - Math.cos(base.dir) * 9);
    const ay = Math.round(base.y - Math.sin(base.dir) * 9);
    expect(w.canPlace(0, 'portal', ax, ay).ok).toBe(false);
    const worker = w.units.find((u) => u.owner === 0 && u.type === 'shaper');
    w.issue(0, { type: 'build', ids: [worker.id], building: 'conduit', bx: ax - 3, by: ay });
    sec(w, 25);
    const conduit = w.buildings.find((b) => b.owner === 0 && b.type === 'conduit');
    expect(conduit && conduit.built).toBe(true);
    expect(p.supplyCap).toBe(23);
    expect(w.canPlace(0, 'portal', ax, ay).ok).toBe(true);
    expect(w.canPlace(0, 'archive', ax, ay).ok).toBe(false); // needs a Portal first
  });

  it('refunds 75% when construction is cancelled', () => {
    const w = new World({ mapId: 'frostgate', players: twoPlayers(), seed: 2 });
    const p = w.players[0];
    p.crystals = 100;
    const base = w.map.bases[p.startBase];
    const r = w.placeBuilding(0, 'conduit', Math.round(base.x + 5), Math.round(base.y + 5), null);
    expect(r.ok).toBe(true);
    expect(p.crystals).toBe(0);
    w.issue(0, { type: 'cancel', building: r.building.id });
    sec(w, 0.1);
    expect(p.crystals).toBe(75);
  });
});

describe('combat', () => {
  it('barrier absorbs damage before hull, armor reduces hull damage', () => {
    const w = emptyArena();
    const a = w.createUnit('lancer', 0, 60, 60);
    const t = w.createUnit('lancer', 1, 61, 60);
    applyDamage(w, t, 8, a);
    expect(t.barrier).toBe(42);
    expect(t.hp).toBe(100);
    t.barrier = 3;
    applyDamage(w, t, 8, a); // 3 to barrier, remaining 5 - 1 armor = 4 to hull
    expect(t.barrier).toBe(0);
    expect(t.hp).toBe(96);
    applyDamage(w, t, 8, a);
    expect(t.hp).toBe(89);
  });

  it('barrier upgrades reduce barrier damage and armor upgrades reduce hull damage', () => {
    const w = emptyArena();
    const a = w.createUnit('lancer', 0, 60, 60);
    const t = w.createUnit('lancer', 1, 61, 60);
    w.players[1].upgrades.barrier = 2;
    w.players[1].upgrades.armor = 3;
    applyDamage(w, t, 8, a);
    expect(t.barrier).toBe(44);
    t.barrier = 0;
    applyDamage(w, t, 8, a);
    expect(t.hp).toBe(96); // 8 - (1 + 3)
  });

  it('barriers regenerate after the delay', () => {
    const w = emptyArena();
    const a = w.createUnit('lancer', 0, 60, 60);
    const t = w.createUnit('lancer', 1, 80, 80);
    applyDamage(w, t, 20, a);
    expect(t.barrier).toBe(30);
    sec(w, BARRIER_REGEN_DELAY - 1);
    expect(t.barrier).toBe(30);
    sec(w, 5);
    expect(t.barrier).toBeGreaterThan(38);
  });

  it('Lancers strike twice per swing and fight to the death', () => {
    const w = emptyArena();
    const a = w.createUnit('lancer', 0, 60, 60);
    const b = w.createUnit('lancer', 1, 64, 60);
    w.issue(0, { type: 'attack', ids: [a.id], target: b.id });
    let strikes = 0;
    for (let i = 0; i < TICK_RATE * 40 && !b.dead && !a.dead; i++) {
      w.step();
      for (const e of w.drainEvents()) if (e.e === 'strike' && e.a === a.id) strikes++;
    }
    expect(b.dead || a.dead).toBe(true);
    expect(strikes).toBeGreaterThan(4);
  });

  it('a Lancer beats several Shapers', () => {
    const w = emptyArena();
    const l = w.createUnit('lancer', 0, 60, 60);
    const ws = [0, 1, 2].map((i) => w.createUnit('shaper', 1, 63 + i * 0.8, 60));
    w.issue(0, { type: 'attackMove', ids: [l.id], x: 66, y: 60 });
    w.issue(1, { type: 'attackMove', ids: ws.map((u) => u.id), x: 60, y: 60 });
    sec(w, 30);
    expect(l.dead).toBe(false);
    expect(ws.every((u) => u.dead)).toBe(true);
  });

  it('Lunge Drive makes Lancers faster and dash into enemies', () => {
    const w = emptyArena();
    w.players[0].upgrades.lunge = 1;
    const a = w.createUnit('lancer', 0, 60, 60);
    const b = w.createUnit('lancer', 1, 64.5, 60);
    w.issue(0, { type: 'attack', ids: [a.id], target: b.id });
    let lunged = false;
    for (let i = 0; i < TICK_RATE * 2; i++) {
      w.step();
      for (const e of w.drainEvents()) if (e.e === 'lunge' && e.id === a.id) lunged = true;
    }
    expect(lunged).toBe(true);
  });
});

describe('structures & abilities', () => {
  function devBase() {
    const w = new World({ mapId: 'frostgate', players: twoPlayers(), seed: 4 });
    const p = w.players[0];
    p.crystals = 5000;
    p.flux = 5000;
    const base = w.map.bases[p.startBase];
    const ax = Math.round(base.x - Math.cos(base.dir) * 9);
    const ay = Math.round(base.y - Math.sin(base.dir) * 9);
    const conduit = w.createBuilding('conduit', 0, ax - 3, ay, true);
    const portal = w.createBuilding('portal', 0, ax, ay, true);
    w.recomputeSupplyAll();
    return { w, p, base, conduit, portal, ax, ay };
  }

  it('Overclock speeds up production', () => {
    const { w, portal } = devBase();
    const c = w.buildings.find((b) => b.owner === 0 && b.type === 'citadel');
    c.energy = 50;
    w.issue(0, { type: 'train', ids: [portal.id], unit: 'lancer' });
    w.issue(0, { type: 'overclock', target: portal.id, source: c.id });
    sec(w, 20);
    // 27s build time at 1.5x speed finishes in 18s
    expect(w.units.filter((u) => u.owner === 0 && u.type === 'lancer')).toHaveLength(1);
    expect(c.energy).toBeLessThan(50);
  });

  it('Phase Transit turns Portals into Phase Portals that warp into power fields', () => {
    const { w, p, portal, conduit } = devBase();
    w.createBuilding('archive', 0, conduit.bx - 4, conduit.by + 3, true);
    p.upgrades.phaseTransit = 1;
    sec(w, 8);
    expect(portal.phase).toBe(true);
    // outside a power field: refused
    w.issue(0, { type: 'warp', x: 5, y: 5 });
    sec(w, 0.1);
    expect(w.units.filter((u) => u.type === 'lancer')).toHaveLength(0);
    w.issue(0, { type: 'warp', x: conduit.x + 2.5, y: conduit.y - 2 });
    sec(w, 0.1);
    const l = w.units.find((u) => u.type === 'lancer');
    expect(l).toBeTruthy();
    expect(l.warping).toBeGreaterThan(0);
    expect(portal.warpCd).toBeGreaterThan(15);
    sec(w, 17);
    expect(l.warping).toBe(0);
  });

  it('Aegis Well restores barriers of nearby units', () => {
    const { w, conduit } = devBase();
    const well = w.createBuilding('aegis', 0, conduit.bx, conduit.by + 3, true);
    const u = w.createUnit('lancer', 0, well.x + 2, well.y + 2);
    u.barrier = 0;
    u.lastDamageTick = w.tick;
    sec(w, 1.5);
    expect(u.barrier).toBeGreaterThan(40);
    expect(well.energy).toBeLessThan(100);
  });

  it('research costs resources and levels up upgrades', () => {
    const { w, p, conduit } = devBase();
    const f = w.createBuilding('foundry', 0, conduit.bx, conduit.by + 3, true);
    const before = p.crystals;
    w.issue(0, { type: 'research', ids: [f.id], research: 'weapons' });
    sec(w, 0.2);
    expect(p.crystals).toBe(before - 100);
    expect(w.researchStatus(0, 'weapons').ok).toBe(false);
    sec(w, 130);
    expect(p.upgrades.weapons).toBe(1);
    // level 2 needs a Sanctum
    expect(w.researchStatus(0, 'weapons').ok).toBe(false);
    expect(w.researchStatus(0, 'weapons').reason).toMatch(/Sanctum/);
  });
});

describe('victory', () => {
  it('a player is eliminated when all structures are destroyed', () => {
    const w = new World({ mapId: 'proving', players: twoPlayers(), seed: 9 });
    for (const b of w.buildings.filter((x) => x.owner === 1)) w.kill(b, null);
    sec(w, 2);
    expect(w.players[1].eliminated).toBe(true);
    expect(w.over).toBe(true);
    expect(w.winnerTeam).toBe(w.players[0].team);
  });

  it('surrender ends the game', () => {
    const w = new World({ mapId: 'proving', players: twoPlayers(), seed: 9 });
    w.issue(0, { type: 'surrender' });
    sec(w, 1);
    expect(w.over).toBe(true);
    expect(w.winnerTeam).toBe(w.players[1].team);
  });
});

describe('AI', () => {
  it('a Brutal AI defeats an Easy AI', () => {
    const w = new World({ mapId: 'proving', players: [
      { name: 'Brutal', type: 'ai', difficulty: 'brutal' },
      { name: 'Easy', type: 'ai', difficulty: 'easy' },
    ], seed: 12 });
    for (let i = 0; i < TICK_RATE * 60 * 20 && !w.over; i++) {
      w.step();
      w.events.length = 0;
    }
    expect(w.over).toBe(true);
    expect(w.winnerTeam).toBe(0);
  });

  it('AIs build an economy, tech and an army', () => {
    const w = new World({ mapId: 'frostgate', players: [
      { name: 'A', type: 'ai', difficulty: 'hard' },
      { name: 'B', type: 'ai', difficulty: 'hard' },
    ], seed: 5 });
    sec(w, 300);
    for (const p of w.players) {
      const mine = (t) => w.entities.filter((e) => e.owner === p.id && e.type === t).length;
      expect(mine('shaper')).toBeGreaterThan(18);
      expect(mine('portal')).toBeGreaterThan(0);
      expect(mine('conduit')).toBeGreaterThan(2);
      expect(p.stats.unitsMade).toBeGreaterThan(10);
    }
  });
});

describe('determinism', () => {
  it('same seed and commands produce identical games', () => {
    const make = () => new World({ mapId: 'verdant', players: [
      { name: 'A', type: 'ai', difficulty: 'normal' },
      { name: 'B', type: 'ai', difficulty: 'hard' },
    ], seed: 77 });
    const a = make();
    const b = make();
    sec(a, 120);
    sec(b, 120);
    const sig = (w) => w.units.map((u) => `${u.id}:${u.x.toFixed(3)}:${u.y.toFixed(3)}:${u.hp}`).join('|');
    expect(sig(a)).toBe(sig(b));
    expect(a.players[0].crystals).toBe(b.players[0].crystals);
  });
});

describe('data', () => {
  it('unit and structure stats are sane', () => {
    expect(UNITS.lancer.weapon.hits).toBe(2);
    expect(UNITS.shaper.cost.crystals).toBe(50);
    for (const b of Object.values(BUILDINGS)) {
      expect(b.size).toBeGreaterThanOrEqual(2);
      expect(b.hp).toBeGreaterThan(0);
    }
  });
});
