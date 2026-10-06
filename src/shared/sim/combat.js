// Damage model, weapon swings and target acquisition.
import { MIN_DAMAGE } from '../constants.js';
import { edgeDist } from './geom.js';

// Applies damage with barrier-first absorption and armor reduction.
// Returns actual damage dealt (barrier + hull).
export function applyDamage(world, target, amount, attacker) {
  if (target.dead || target.hp === undefined) return 0;
  if (target.invulnerable || target.caged) return 0;
  const tp = target.owner >= 0 ? world.players[target.owner] : null;
  const barrierArmor = tp ? tp.upgrades.barrier : 0;
  let armor = target.armor || 0;
  if (tp && target.kind === 'unit') armor += tp.upgrades.armor;
  let remaining = amount;
  let dealt = 0;
  let hitBarrier = false;
  if (target.barrier > 0) {
    hitBarrier = true;
    const d = Math.max(MIN_DAMAGE, remaining - barrierArmor);
    if (d <= target.barrier) {
      target.barrier -= d;
      dealt += d;
      remaining = 0;
    } else {
      dealt += target.barrier;
      remaining = d - target.barrier;
      target.barrier = 0;
    }
  }
  if (remaining > 0) {
    const d = Math.max(MIN_DAMAGE, remaining - armor);
    target.hp -= d;
    dealt += d;
  }
  target.lastDamageTick = world.tick;
  world.emit({ e: 'hit', t: target.id, x: target.x, y: target.y, b: hitBarrier ? 1 : 0, d: Math.round(dealt * 10) / 10 });
  if (attacker && target.owner >= 0 && attacker.owner !== target.owner) {
    target.lastAttacker = attacker.id;
    world.underAttack(target, attacker);
    const as = world.players[attacker.owner];
    if (as) as.stats.damageDealt += dealt;
  }
  if (target.hp <= 0) {
    world.kill(target, attacker);
  }
  return dealt;
}

export function weaponDamage(world, u, target) {
  if (u.damage) return u.damage * (target && target.kind === 'building' ? u.structureBonus || 1 : 1);
  const w = u.def.weapon;
  const p = world.players[u.owner];
  return w.damage + (p ? p.upgrades.weapons * (w.upgradePerLevel || 0) : 0);
}

// Starts a swing if possible. Damage is applied after the windup by updateSwing.
export function startSwing(world, u, target) {
  const w = u.def.weapon;
  if (u.cooldown > 0 || u.swing) return false;
  u.cooldown = w.cooldown;
  u.swing = { target: target.id, t: w.windup, hits: w.hits, interval: w.hitInterval, bonus: u.lungeHit ? u.def.lunge.bonusDamage : 0 };
  u.lungeHit = false;
  u.attackAnim = world.tick;
  world.emit({ e: 'swing', a: u.id, t: target.id });
  return true;
}

export function updateSwing(world, u, dt) {
  const s = u.swing;
  if (!s) return;
  s.t -= dt;
  if (s.t > 0) return;
  const target = world.byId.get(s.target);
  if (!target || target.dead || edgeDist(u, target) > u.def.weapon.range + 0.6) {
    u.swing = null;
    return;
  }
  let dmg = weaponDamage(world, u, target);
  if (s.bonus) {
    dmg += s.bonus;
    s.bonus = 0;
  }
  applyDamage(world, target, dmg, u);
  world.emit({ e: 'strike', a: u.id, t: target.id, n: s.hits });
  s.hits--;
  if (s.hits > 0 && !target.dead) s.t = s.interval;
  else u.swing = null;
}

// Whether `t` is a valid attack target for unit `u` (enemy, alive, visible).
export function canTarget(world, u, t, explicit = false) {
  if (!t || t.dead || t.hp === undefined) return false;
  if (t.kind === 'resource' || t.type === 'beacon') return false;
  if (t.hidden || t.caged) return false;
  if (t.owner === -1) return explicit && t.type === 'rubble';
  if (!world.areEnemies(u.owner, t.owner) && !explicit) return false;
  if (t.owner === u.owner && !explicit) return false;
  return world.isVisibleTo(t, u.owner);
}

// Picks the best enemy target within `range` (edge distance) of unit u.
export function acquireTarget(world, u, range) {
  let best = null;
  let bestScore = -Infinity;
  const near = world.hash.query(u.x, u.y, range + 2, world._q);
  for (let i = 0; i < near.length; i++) {
    const t = near[i];
    if (t === u || t.owner === u.owner || t.dead || t.hidden || t.warping || t.caged) continue;
    if (!world.areEnemies(u.owner, t.owner)) continue;
    const d = edgeDist(u, t);
    if (d > range) continue;
    if (!world.isVisibleTo(t, u.owner)) continue;
    let score = t.def.priority * 100 - d * 4;
    if (t.lastAttacker !== undefined && world.byId.get(t.lastAttacker)?.owner === u.owner) score += 5;
    // prefer targets currently attacking us
    if (t.engaged === u.id) score += 30;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  if (best && best.def.priority >= 20) return best;
  // structures
  for (const b of world.buildings) {
    if (b.dead || b.owner === u.owner || !world.areEnemies(u.owner, b.owner)) continue;
    const d = edgeDist(u, b);
    if (d > range) continue;
    if (!world.isVisibleTo(b, u.owner)) continue;
    const score = b.def.priority * 100 - d * 4;
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  return best;
}
