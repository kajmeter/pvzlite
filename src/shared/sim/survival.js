// pvzlite survival mode rules (Builders vs Hunters). Hooked into World when opts.mode === 'survival'.
import { TICK_RATE, DT } from '../constants.js';
import { BUILDINGS } from '../data/defs.js';
import {
  SURVIVAL,
  levelCost,
  builderStats,
  hunterStats,
  SURVIVAL_BUILDINGS,
  HUNTER_UPGRADES,
  upgradeCost,
} from '../data/survival.js';
import { clearOrders } from './behavior.js';
import { applyDamage } from './combat.js';
import { pointEdgeDist } from './geom.js';

export const BUILDER_TEAM = 1;
export const HUNTER_TEAM = 2;
export const SURVIVAL_MINE_TIME = 2.0;
export const SPRINT = { unlock: 2, duration: 3, cooldown: 18, factor: 1.6 };

export function setupSurvival(world, opts) {
  const map = world.map;
  const sv = (world.survival = {
    phase: 'grace',
    releaseTick: Math.round((opts.graceTime ?? SURVIVAL.graceTime) * TICK_RATE),
    endTick: Math.round((opts.duration ?? SURVIVAL.duration) * TICK_RATE),
    winner: 0,
    ascended: -1,
    reason: '',
  });
  void sv;
  const spawns = map.builderSpawns.slice();
  for (let i = spawns.length - 1; i > 0; i--) {
    const j = world.rng.int(i + 1);
    [spawns[i], spawns[j]] = [spawns[j], spawns[i]];
  }
  let si = 0;
  let hi = 0;
  for (const p of world.players) {
    p.role = p.role === 'hunter' ? 'hunter' : 'builder';
    p.team = p.role === 'hunter' ? HUNTER_TEAM : BUILDER_TEAM;
    p.level = 1;
    p.lives = p.role === 'builder' ? (opts.builderLives ?? SURVIVAL.builderLives) : Infinity;
    p.essence = p.role === 'hunter' ? SURVIVAL.startEssence : 0;
    p.crystals = p.role === 'builder' ? (opts.startCrystals ?? SURVIVAL.startCrystals) : 0;
    p.flux = 0;
    p.hunterUp = { blades: 0, armor: 0, vitality: 0, barrier: 0, swiftness: 0, sunder: 0, lunge: 0 };
    p.heroId = 0;
    p.respawnAt = -1;
    p.sprintCd = 0;
    p.revealCd = 0;
    p.revealUntil = 0;
    p.deaths = 0;
    p.stats.hunterKills = 0;
    p.stats.builderKills = 0;
    if (p.role === 'builder') {
      const sp = spawns[si++ % spawns.length];
      p.homeSpawn = sp;
      spawnHero(world, p, sp);
    } else {
      const a = (hi++ / Math.max(1, world.players.filter((q) => q.role === 'hunter').length)) * Math.PI * 2;
      spawnHero(world, p, { x: map.cage.x + Math.cos(a) * 1.5, y: map.cage.y + Math.sin(a) * 1.5 });
    }
  }
  world.teamIds = [BUILDER_TEAM, HUNTER_TEAM];
  for (const t of world.teamIds) {
    if (!world.vision[t]) {
      world.vision[t] = new Uint8Array(map.width * map.height);
      world.explored[t] = new Uint8Array(map.width * map.height);
    }
  }
}

export function spawnHero(world, p, at) {
  const type = p.role === 'hunter' ? 'hunter' : 'builder';
  let pos = at;
  if (!pos) pos = p.role === 'hunter' ? world.map.cage : safestSpawn(world);
  const nf = world.grid.nearestFree(pos.x, pos.y, 8);
  const x = nf ? nf[0] + 0.5 : pos.x;
  const y = nf ? nf[1] + 0.5 : pos.y;
  const u = world.createUnit(type, p.id, x, y, { supplyCounted: true, facing: Math.atan2(world.map.cage.y - y, world.map.cage.x - x) });
  p.heroId = u.id;
  p.respawnAt = -1;
  if (p.role === 'hunter') {
    recomputeHunter(world, u, true);
    if (world.survival.phase === 'grace') u.caged = true;
  } else {
    recomputeBuilder(world, u, true);
    u.autocast = {};
  }
  return u;
}

function safestSpawn(world) {
  const hunters = world.units.filter((u) => u.type === 'hunter' && !u.dead);
  let best = null;
  let bestD = -1;
  for (const s of world.map.builderSpawns) {
    let d = Infinity;
    for (const h of hunters) d = Math.min(d, Math.hypot(h.x - s.x, h.y - s.y));
    if (!hunters.length) d = world.rng.next() * 100;
    if (d > bestD) {
      bestD = d;
      best = s;
    }
  }
  return best || world.map.builderSpawns[0];
}

export function recomputeBuilder(world, u, full = false) {
  const p = world.players[u.owner];
  const st = builderStats(p.level);
  const dh = st.hp - u.maxHp;
  const db = st.barrier - u.maxBarrier;
  u.maxHp = st.hp;
  u.maxBarrier = st.barrier;
  u.armor = st.armor;
  u.speedOverride = st.speed;
  u.mineYield = st.yield;
  if (full) {
    u.hp = st.hp;
    u.barrier = st.barrier;
  } else {
    u.hp = Math.min(u.maxHp, u.hp + Math.max(0, dh));
    u.barrier = Math.min(u.maxBarrier, u.barrier + Math.max(0, db));
  }
}

export function recomputeHunter(world, u, full = false) {
  const p = world.players[u.owner];
  const st = hunterStats(p.hunterUp);
  const dh = st.hp - u.maxHp;
  const db = st.barrier - u.maxBarrier;
  u.maxHp = st.hp;
  u.maxBarrier = st.barrier;
  u.armor = st.armor;
  u.speedOverride = st.speed;
  u.damage = st.damage;
  u.structureBonus = st.structureBonus;
  u.lungeCooldown = st.lungeCooldown;
  u.lungeRange = st.lungeRange;
  u.regenMult = st.barrierRegen;
  if (full) {
    u.hp = st.hp;
    u.barrier = st.barrier;
  } else {
    u.hp = Math.min(u.maxHp, u.hp + Math.max(0, dh));
    u.barrier = Math.min(u.maxBarrier, u.barrier + Math.max(0, db));
  }
}

// ---------------------------------------------------------------- per tick

export function stepSurvival(world) {
  const sv = world.survival;
  if (sv.phase === 'grace' && world.tick >= sv.releaseTick) {
    sv.phase = 'hunt';
    for (const u of world.units) if (u.caged) u.caged = false;
    world.emit({ e: 'release' });
  }
  // Hunters slowly recover hull out of combat
  if (world.tick % 10 === 0) {
    for (const u of world.units) {
      if (u.type !== 'hunter' || u.dead || u.hp >= u.maxHp) continue;
      if (world.tick - u.lastDamageTick > 7 * TICK_RATE) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.02 * 0.5);
    }
  }
  for (const p of world.players) {
    if (p.eliminated) continue;
    if (p.sprintCd > 0) p.sprintCd = Math.max(0, p.sprintCd - DT);
    if (p.revealCd > 0) p.revealCd = Math.max(0, p.revealCd - DT);
    if (p.role === 'hunter' && sv.phase === 'hunt') p.essence += SURVIVAL.essencePerSecond * DT;
    if (p.respawnAt >= 0 && world.tick >= p.respawnAt) {
      const u = spawnHero(world, p, null);
      world.emit({ e: 'respawn', owner: p.id, id: u.id, x: u.x, y: u.y });
    }
  }
}

export function onKilled(world, e, attacker) {
  const p = e.owner >= 0 ? world.players[e.owner] : null;
  const killer = attacker && attacker.owner >= 0 ? world.players[attacker.owner] : null;
  if (e.kind === 'unit' && p) {
    if (e.type === 'builder' && p.heroId === e.id) {
      p.heroId = 0;
      p.lives--;
      p.deaths++;
      if (killer && killer.role === 'hunter') {
        killer.essence += SURVIVAL.bounty.builderBase + SURVIVAL.bounty.builderPerLevel * p.level;
        killer.stats.builderKills++;
      }
      if (p.lives > 0) {
        p.respawnAt = world.tick + SURVIVAL.builderRespawn * TICK_RATE;
        world.emit({ e: 'builderDown', owner: p.id, lives: p.lives, x: e.x, y: e.y, by: attacker ? attacker.owner : -1 });
      } else {
        world.emit({ e: 'builderDown', owner: p.id, lives: 0, x: e.x, y: e.y, by: attacker ? attacker.owner : -1 });
        world.eliminate(p);
      }
    } else if (e.type === 'hunter' && p.heroId === e.id) {
      p.heroId = 0;
      p.deaths++;
      p.respawnAt = world.tick + SURVIVAL.hunterRespawn * TICK_RATE;
      if (killer && killer.role === 'builder') {
        killer.crystals += 100;
        killer.stats.hunterKills++;
      }
      world.emit({ e: 'hunterDown', owner: p.id, x: e.x, y: e.y, by: attacker ? attacker.owner : -1 });
    }
  } else if (e.kind === 'building' && killer && killer.role === 'hunter') {
    const sb = SURVIVAL_BUILDINGS[e.type];
    if (sb) killer.essence += SURVIVAL.bounty[sb.bounty] || 0;
  }
}

export function checkSurvivalVictory(world) {
  const sv = world.survival;
  const builders = world.players.filter((p) => p.role === 'builder');
  const alive = builders.filter((p) => !p.eliminated);
  let winner = 0;
  if (!alive.length) {
    winner = HUNTER_TEAM;
    sv.reason = 'All Shapers were hunted down';
  } else if (alive.some((p) => p.level >= SURVIVAL.maxLevel)) {
    winner = BUILDER_TEAM;
    const asc = alive.find((p) => p.level >= SURVIVAL.maxLevel);
    sv.ascended = asc.id;
    sv.reason = `${asc.name} reached level ${SURVIVAL.maxLevel}`;
  } else if (world.tick >= sv.endTick) {
    winner = BUILDER_TEAM;
    sv.reason = 'The Shapers survived until the end';
  } else if (!world.players.some((p) => p.role === 'hunter' && !p.eliminated)) {
    winner = BUILDER_TEAM;
    sv.reason = 'All Hunters left the game';
  }
  if (winner) {
    world.over = true;
    world.winnerTeam = winner;
    sv.winner = winner;
    world.sampleStats();
    world.emit({ e: 'gameOver', winnerTeam: winner, reason: sv.reason });
  }
}

// ---------------------------------------------------------------- commands

export function survivalCommand(world, pid, c, units) {
  const p = world.players[pid];
  switch (c.type) {
    case 'levelUp': {
      if (p.role !== 'builder') return true;
      if (p.level >= SURVIVAL.maxLevel) return true;
      const cost = levelCost(p.level);
      if (p.crystals < cost) {
        world.error(pid, 'Not enough crystals');
        return true;
      }
      p.crystals -= cost;
      p.stats.spent += cost;
      p.level++;
      const hero = world.byId.get(p.heroId);
      if (hero) recomputeBuilder(world, hero);
      world.emit({ e: 'levelUp', owner: pid, level: p.level, x: hero?.x, y: hero?.y });
      if (p.level >= SURVIVAL.maxLevel) checkSurvivalVictory(world);
      return true;
    }
    case 'upgrade': {
      if (p.role !== 'hunter') return true;
      const def = HUNTER_UPGRADES[c.upgrade];
      if (!def) return true;
      const lvl = p.hunterUp[def.id] || 0;
      if (lvl >= def.max) {
        world.error(pid, 'Fully upgraded');
        return true;
      }
      const cost = upgradeCost(def.id, lvl);
      if (p.essence < cost) {
        world.error(pid, 'Not enough essence');
        return true;
      }
      p.essence -= cost;
      p.hunterUp[def.id] = lvl + 1;
      const hero = world.byId.get(p.heroId);
      if (hero) recomputeHunter(world, hero);
      world.emit({ e: 'upgraded', owner: pid, id: def.id, level: lvl + 1 });
      return true;
    }
    case 'sprint': {
      const hero = world.byId.get(p.heroId);
      if (!hero || p.role !== 'builder') return true;
      if (p.level < SPRINT.unlock) {
        world.error(pid, `Sprint unlocks at level ${SPRINT.unlock}`);
        return true;
      }
      if (p.sprintCd > 0) {
        world.error(pid, 'Sprint is recharging');
        return true;
      }
      p.sprintCd = SPRINT.cooldown;
      hero.sprintUntil = world.tick + SPRINT.duration * TICK_RATE;
      world.emit({ e: 'sprint', id: hero.id });
      return true;
    }
    case 'reveal': {
      if (p.role !== 'hunter') return true;
      if (p.revealCd > 0) {
        world.error(pid, 'Reveal is recharging');
        return true;
      }
      p.revealCd = SURVIVAL.revealCooldown;
      p.revealUntil = world.tick + SURVIVAL.revealDuration * TICK_RATE;
      const spots = world.units.filter((u) => u.type === 'builder' && !u.dead).map((u) => [Math.round(u.x), Math.round(u.y)]);
      world.emit({ e: 'reveal', owner: pid, spots });
      return true;
    }
    case 'build': {
      const worker = units.find((u) => u.type === 'builder');
      if (!worker) return true;
      const type = c.building;
      const sb = SURVIVAL_BUILDINGS[type];
      if (!sb) return true;
      const bx = Math.floor(Number(c.bx) || 0);
      const by = Math.floor(Number(c.by) || 0);
      const chk = canPlaceSurvival(world, pid, type, bx, by, worker);
      if (!chk.ok && chk.reason !== 'Something is in the way') {
        world.error(pid, chk.reason, bx, by);
        return true;
      }
      if (p.crystals < sb.cost) {
        world.error(pid, 'Not enough crystals', bx, by);
        return true;
      }
      if (!c.queue) {
        clearOrders(world, worker);
        worker.swing = null;
      }
      worker.orders.push({ type: 'build', building: type, bx, by });
      return true;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------- placement

export function survivalPowered(world, owner, x, y) {
  for (const b of world.buildings) {
    if (b.type !== 'barricade' || b.owner !== owner || !b.built || b.dead) continue;
    if (Math.hypot(b.x - x, b.y - y) <= SURVIVAL_BUILDINGS.barricade.powerRadius) return true;
  }
  return false;
}

export function canPlaceSurvival(world, owner, type, bx, by, builder = null) {
  const sb = SURVIVAL_BUILDINGS[type];
  const p = world.players[owner];
  if (!sb) return { ok: false, reason: 'Unknown structure' };
  if (p.role !== 'builder') return { ok: false, reason: 'Only Shapers can build' };
  if (p.level < sb.unlock) return { ok: false, reason: `Unlocks at level ${sb.unlock}` };
  const s = sb.size;
  const g = world.grid;
  for (let y = by; y < by + s; y++) for (let x = bx; x < bx + s; x++) if (!g.buildable(x, y)) return { ok: false, reason: "Can't build there" };
  const cx = bx + s / 2;
  const cy = by + s / 2;
  const cage = world.map.cage;
  const cr = world.map.cageRadius + 2;
  if (Math.abs(cx - cage.x) < cr + 1 && Math.abs(cy - cage.y) < cr + 1) return { ok: false, reason: 'Too close to the Hunter cage' };
  if (!world.isExplored(owner, cx, cy)) return { ok: false, reason: 'Location not explored' };
  if (sb.needsPower && !survivalPowered(world, owner, cx, cy)) return { ok: false, reason: 'Needs a Barricade Ward nearby (power)' };
  const near = world.hash.query(cx, cy, s + 1, world._q);
  for (const u of near) {
    if (u.dead || u.hidden || u === builder) continue;
    if (u.x + u.r > bx && u.x - u.r < bx + s && u.y + u.r > by && u.y - u.r < by + s && u.owner !== owner) {
      return { ok: false, reason: 'Something is in the way' };
    }
  }
  return { ok: true };
}

export function placeSurvival(world, owner, type, bx, by, builder) {
  const sb = SURVIVAL_BUILDINGS[type];
  const p = world.players[owner];
  const chk = canPlaceSurvival(world, owner, type, bx, by, builder);
  if (!chk.ok) {
    world.error(owner, chk.reason, bx + 1, by + 1);
    return chk;
  }
  if (p.crystals < sb.cost) {
    world.error(owner, 'Not enough crystals', bx, by);
    return { ok: false, reason: 'Not enough crystals' };
  }
  p.crystals -= sb.cost;
  p.stats.spent += sb.cost;
  const L = p.level;
  const b = world.createBuilding(type, owner, bx, by, false, { hp: sb.hp(L), barrier: sb.barrier(L), armor: sb.armor(L), level: L });
  if (sb.weapon) {
    b.weaponDamage = sb.weapon.damage(L);
    b.weaponRange = sb.weapon.range;
    b.weaponCooldown = sb.weapon.cooldown;
    b.cooldown = 0;
    b.aim = 0;
  }
  // push own units out of the footprint
  const s = sb.size;
  const near = world.hash.query(bx + s / 2, by + s / 2, s + 1, world._q);
  for (const u of near) {
    if (u.dead || u.hidden) continue;
    if (u.x + u.r > bx && u.x - u.r < bx + s && u.y + u.r > by && u.y - u.r < by + s) {
      const dx = u.x - (bx + s / 2);
      const dy = u.y - (by + s / 2);
      const d = Math.hypot(dx, dy) || 1;
      u.x = bx + s / 2 + (dx / d) * (s * 0.75 + u.r + 0.2);
      u.y = by + s / 2 + (dy / d) * (s * 0.75 + u.r + 0.2);
      u.nav = null;
    }
  }
  world.emit({ e: 'buildStart', id: b.id, owner, type });
  return { ok: true, building: b };
}

// ---------------------------------------------------------------- structures

export function updateSurvivalBuilding(world, b) {
  if (!b.built) return;
  if (b.weaponDamage) {
    if (b.cooldown > 0) b.cooldown -= DT;
    if (b.cooldown > 0) return;
    // acquire the closest Hunter in range
    let best = null;
    let bd = Infinity;
    const near = world.hash.query(b.x, b.y, b.weaponRange + 2, world._q);
    for (const u of near) {
      if (u.dead || u.hidden || u.caged || !world.areEnemies(b.owner, u.owner)) continue;
      const d = pointEdgeDist(b.x, b.y, u) - 1;
      if (d > b.weaponRange || d >= bd) continue;
      if (!world.isVisibleTo(u, b.owner)) continue;
      bd = d;
      best = u;
    }
    if (!best) return;
    b.cooldown = b.weaponCooldown;
    b.aim = Math.atan2(best.y - b.y, best.x - b.x);
    world.emit({ e: 'bolt', from: b.id, to: best.id, heavy: b.type === 'lanceTurret' ? 1 : 0 });
    applyDamage(world, best, b.weaponDamage, b);
  } else if (b.type === 'mender') {
    b.energy = Math.min(b.maxEnergy, b.energy + 1.5 * DT);
    const sb = SURVIVAL_BUILDINGS.mender;
    let target = null;
    let worst = 1;
    const cands = world.buildings.filter((o) => o.owner === b.owner && o !== b && !o.dead && o.maxBarrier > 0);
    const hero = world.byId.get(world.players[b.owner].heroId);
    if (hero) cands.push(hero);
    for (const t of cands) {
      if (t.barrier >= t.maxBarrier) continue;
      if (pointEdgeDist(b.x, b.y, t) > sb.range) continue;
      const f = t.barrier / t.maxBarrier;
      if (f < worst) {
        worst = f;
        target = t;
      }
    }
    if (target && b.energy > 1) {
      const amt = Math.min(sb.rate * DT, target.maxBarrier - target.barrier);
      target.barrier += amt;
      b.energy -= amt * 0.4;
      b.beam = target.id;
    } else b.beam = 0;
  }
}

export function survivalMine(world, u, amount) {
  const p = world.players[u.owner];
  p.crystals += amount;
  p.stats.crystalsMined += amount;
}

export { BUILDINGS };
