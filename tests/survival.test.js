import { describe, it, expect } from 'vitest';
import { World } from '../src/shared/sim/world.js';
import { TICK_RATE } from '../src/shared/constants.js';
import { SURVIVAL, levelCost, builderStats } from '../src/shared/data/survival.js';

const sec = (w, s) => w.run(Math.round(s * TICK_RATE));

function game(opts = {}) {
  const players = opts.players || [
    { name: 'Builder', type: 'human', role: 'builder' },
    { name: 'Hunter', type: 'human', role: 'hunter' },
  ];
  return new World({ mapId: opts.map || 'wilds', mode: 'survival', players, seed: opts.seed || 7, ...opts.extra });
}

const hero = (w, pid) => w.byId.get(w.players[pid].heroId);

describe('survival setup', () => {
  it('spawns one Shaper per builder and a caged Lancer per hunter', () => {
    const w = game();
    expect(hero(w, 0).type).toBe('builder');
    expect(hero(w, 1).type).toBe('hunter');
    expect(hero(w, 1).caged).toBe(true);
    expect(w.players[0].crystals).toBe(SURVIVAL.startCrystals);
    expect(w.players[0].team).not.toBe(w.players[1].team);
    expect(w.buildings).toHaveLength(0);
  });

  it('releases hunters after the grace period', () => {
    const w = game();
    sec(w, SURVIVAL.graceTime - 1);
    expect(hero(w, 1).caged).toBe(true);
    sec(w, 2);
    expect(hero(w, 1).caged).toBe(false);
    expect(w.survival.phase).toBe('hunt');
  });

  it('caged hunters cannot move and cannot be hurt', () => {
    const w = game();
    const h = hero(w, 1);
    const x = h.x;
    w.issue(1, { type: 'move', ids: [h.id], x: x + 20, y: h.y });
    sec(w, 3);
    expect(h.x).toBeCloseTo(x, 1);
  });
});

describe('builders', () => {
  it('mine crystals directly from fields (no drop-off)', () => {
    const w = game();
    const b = hero(w, 0);
    const f = w.findNearbyCrystal(b.x, b.y, 80);
    w.issue(0, { type: 'gather', ids: [b.id], target: f.id });
    sec(w, 40);
    expect(w.players[0].stats.crystalsMined).toBeGreaterThan(60);
  });

  it('level up costs crystals and improves stats up to level 11', () => {
    const w = game();
    const b = hero(w, 0);
    const p = w.players[0];
    p.crystals = 100000;
    const hp1 = b.maxHp;
    w.issue(0, { type: 'levelUp' });
    sec(w, 0.1);
    expect(p.level).toBe(2);
    expect(b.maxHp).toBeGreaterThan(hp1);
    expect(p.crystals).toBe(100000 - levelCost(1));
    expect(builderStats(2).yield).toBeGreaterThan(builderStats(1).yield);
  });

  it('reaching level 11 wins the game for the builders', () => {
    const w = game();
    w.players[0].crystals = 100000;
    for (let i = 0; i < 10; i++) w.issue(0, { type: 'levelUp' });
    sec(w, 0.5);
    expect(w.players[0].level).toBe(11);
    expect(w.over).toBe(true);
    expect(w.winnerTeam).toBe(w.players[0].team);
  });

  it('builds barricades and powered turrets', () => {
    const w = game();
    const b = hero(w, 0);
    const p = w.players[0];
    p.crystals = 1000;
    const bx = Math.floor(b.x) + 2;
    const by = Math.floor(b.y) - 1;
    // turret needs power from a barricade
    expect(w.canPlace(0, 'turret', bx + 2, by).ok).toBe(false);
    w.issue(0, { type: 'build', ids: [b.id], building: 'barricade', bx, by });
    sec(w, 6);
    const bar = w.buildings.find((x) => x.type === 'barricade');
    expect(bar && bar.built).toBe(true);
    expect(w.canPlace(0, 'turret', bx + 2, by).ok).toBe(true);
    // higher tiers unlock with levels
    expect(w.canPlace(0, 'lanceTurret', bx + 2, by).ok).toBe(false);
  });

  it('turrets shoot hunters', () => {
    const w = game();
    sec(w, SURVIVAL.graceTime + 1);
    const b = hero(w, 0);
    const t = w.createBuilding('turret', 0, Math.floor(b.x) + 3, Math.floor(b.y), true, { hp: 180, barrier: 100, armor: 1, level: 1 });
    t.weaponDamage = 9;
    t.weaponRange = 7;
    t.weaponCooldown = 1;
    t.cooldown = 0;
    const h = hero(w, 1);
    h.x = t.x + 3;
    h.y = t.y;
    const before = h.hp + h.barrier;
    sec(w, 3);
    expect(h.hp + h.barrier).toBeLessThan(before);
  });

  it('a dead builder respawns while lives remain, then is eliminated', () => {
    const w = game({ players: [
      { name: 'B1', type: 'human', role: 'builder' },
      { name: 'B2', type: 'human', role: 'builder' },
      { name: 'H', type: 'human', role: 'hunter' },
    ] });
    const p = w.players[0];
    w.kill(hero(w, 0), hero(w, 2));
    expect(p.lives).toBe(SURVIVAL.builderLives - 1);
    expect(w.players[2].essence).toBeGreaterThan(SURVIVAL.startEssence);
    sec(w, SURVIVAL.builderRespawn + 1);
    expect(hero(w, 0)).toBeTruthy();
    for (let i = 0; i < SURVIVAL.builderLives; i++) {
      const h = hero(w, 0);
      if (h) w.kill(h, null);
      sec(w, 1);
    }
    expect(p.eliminated).toBe(true);
    expect(w.over).toBe(false); // B2 still alive
  });
});

describe('hunters', () => {
  it('earn essence over time and buy upgrades', () => {
    const w = game();
    sec(w, SURVIVAL.graceTime + 20);
    const p = w.players[1];
    expect(p.essence).toBeGreaterThan(SURVIVAL.startEssence + 50);
    const h = hero(w, 1);
    const dmg = h.damage;
    w.issue(1, { type: 'upgrade', upgrade: 'blades' });
    sec(w, 0.1);
    expect(p.hunterUp.blades).toBe(1);
    expect(h.damage).toBe(dmg + 3);
    const armor = h.armor;
    p.essence += 1000;
    w.issue(1, { type: 'upgrade', upgrade: 'armor' });
    sec(w, 0.1);
    expect(h.armor).toBe(armor + 1);
  });

  it('reveal pulse shows every Shaper to the hunters', () => {
    const w = game();
    sec(w, SURVIVAL.graceTime + 1);
    const b = hero(w, 0);
    expect(w.isVisibleTo(b, 1)).toBe(false);
    w.issue(1, { type: 'reveal' });
    sec(w, 0.5);
    expect(w.isVisibleTo(b, 1)).toBe(true);
    expect(w.players[1].revealCd).toBeGreaterThan(0);
  });

  it('killing every builder wins for the hunters', () => {
    const w = game();
    for (let i = 0; i < SURVIVAL.builderLives; i++) {
      const h = hero(w, 0);
      if (h) w.kill(h, hero(w, 1));
      sec(w, SURVIVAL.builderRespawn + 1);
    }
    expect(w.over).toBe(true);
    expect(w.winnerTeam).toBe(w.players[1].team);
  });

  it('builders win when the timer runs out', () => {
    const w = game({ extra: { duration: 90 } });
    sec(w, 92);
    expect(w.over).toBe(true);
    expect(w.winnerTeam).toBe(w.players[0].team);
  });
});

describe('survival AI', () => {
  it('AI builders fortify and AI hunters hunt; the game always ends', () => {
    const players = [0, 1, 2].map((i) => ({ name: `B${i}`, type: 'ai', role: 'builder', difficulty: 'normal' }));
    players.push({ name: 'H', type: 'ai', role: 'hunter', difficulty: 'normal' });
    const w = new World({ mapId: 'wilds', mode: 'survival', players, seed: 2 });
    sec(w, 120);
    const barricades = w.buildings.filter((b) => b.type === 'barricade').length;
    expect(barricades).toBeGreaterThan(20);
    for (let i = 0; i < TICK_RATE * 60 * 15 && !w.over; i++) {
      w.step();
      w.events.length = 0;
    }
    expect(w.over).toBe(true);
    expect([1, 2]).toContain(w.winnerTeam);
  });
});
