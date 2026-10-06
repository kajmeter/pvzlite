// pvzlite survival mode rules: Shapers vs the Lancer (docs/design/pvz-mode.md).
// Hooked into World when opts.mode === 'survival'. Deterministic: randomness only via world.rng.
import { TICK_RATE, DT } from '../constants.js';
import { UNITS, BUILDINGS } from '../data/defs.js';
import { CELL_RAMP } from '../maps/mapgen.js';
import {
  SURVIVAL,
  GENERATOR_LEVELS,
  WALL_LEVELS,
  MARKET_LEVELS,
  TURRET_LEVELS,
  TURRET_DIRECT,
  MINER_TIERS,
  AUTOMINE_LEVELS,
  WARDEN_TIERS,
  SURVIVAL_BUILDINGS,
  SHOP_ITEMS,
  SHOP_CATEGORIES,
  SHAPER_ABILITIES,
  SHAPER_CONTROL,
  SHAPER_MOBILITY,
  LANCER_ABILITIES,
  HUNTER_ABILITY_IDS,
  SPIRIT_ABILITIES,
  lancerStats,
  cumulativeCost,
  requirementText,
} from '../data/survival.js';
import { clearOrders } from './behavior.js';
import { applyDamage, untouchable } from './combat.js';
import { pointEdgeDist, rectDist } from './geom.js';

export const SHAPER_TEAM = 1;
export const LANCER_TEAM = 2;

const T = (s) => Math.round(s * TICK_RATE);
const UPGRADABLE = { generator: GENERATOR_LEVELS, wall: WALL_LEVELS, market: MARKET_LEVELS, turret: TURRET_LEVELS };
const isLancerType = (u) => u.type === 'lancerHero' || u.type === 'hunter';
// Command input is untrusted: only own keys of the data tables count ('__proto__', 'toString', ...
// must never resolve to Object.prototype members).
const hasKey = (table, key) => typeof key === 'string' && Object.hasOwn(table, key);
export const isSurvivalStructure = (type) => type !== 'shop' && hasKey(SURVIVAL_BUILDINGS, type) && hasKey(BUILDINGS, type);
const PACES = [1, 2, 4];

export function gameTime(world) {
  return world.tick / TICK_RATE;
}

export function paceOf(world) {
  return world.options.pace || 1;
}

function normRole(r) {
  if (r === 'lancer' || r === 'hunter' || r === 'zealot') return 'lancer';
  return 'shaper';
}

// ================================================================== setup

export function setupSurvival(world, opts) {
  const map = world.map;
  const pace = PACES.includes(Number(opts.pace)) ? Number(opts.pace) : 1; // spec section 1: 1, 2 or 4
  const duration = Number.isFinite(opts.duration) && opts.duration > 0 ? opts.duration : 0;
  world.options = { ...opts, pace, duration };
  const sv = (world.survival = {
    phase: 'pregame',
    lancerTick: T(SURVIVAL.lancerSpawn),
    unlockTick: T(SURVIVAL.unlockTime),
    unlocked: false,
    endTick: duration > 0 ? T(duration) : -1,
    price: SURVIVAL.marketStartPrice,
    reason: '',
    winner: 0,
    scans: [],
    fields: [], // active Barrier Fields { id, owner, bx, by, x, y, until }
    nextGasBonus: T(SURVIVAL.gasBonusEvery),
    shopId: 0,
    shop: null,
    lancerId: -1, // player id of the Lancer
    spirits: [],
    overcharged: [],
  });
  world.pickups = [];

  // ---- roles: exactly one Lancer
  let li = world.players.findIndex((p) => normRole(p.role) === 'lancer');
  if (li < 0) li = world.rng.int(world.players.length);
  sv.lancerId = li;
  for (const p of world.players) {
    const lancer = p.id === li;
    p.role = lancer ? 'lancer' : 'shaper';
    p.form = p.role;
    p.alive = true;
    p.team = lancer ? LANCER_TEAM : SHAPER_TEAM;
    p.gas = 0;
    p.minerals = lancer ? SURVIVAL.lancerStartMinerals : 0;
    p.crystals = 0;
    p.flux = 0;
    p.items = [];
    p.heroId = 0;
    p.abilities = !lancer && p.type === 'ai' ? ['stasis', 'blink'] : [];
    p.cd = {};
    p.pendingForm = -1;
    p.respawnAt = -1;
    p.stats.fed = 0;
    p.stats.gasEarned = 0;
    p.stats.mineralsEarned = 0;
    p.stats.shapersKilled = 0;
    p.stats.salvaged = 0;
    p.stats.deaths = 0;
  }
  world.teamIds = [SHAPER_TEAM, LANCER_TEAM];
  for (const t of world.teamIds) {
    world.vision[t] = new Uint8Array(map.width * map.height);
    // the terrain is known to everyone in survival; only units/structures hide in the fog
    world.explored[t] = new Uint8Array(map.width * map.height).fill(1);
  }

  // ---- the neutral Lancer Shop at the map centre
  const sbx = Math.floor(map.cage.x) - 2;
  const sby = Math.floor(map.cage.y) - 2;
  const shop = world.createBuilding('shop', -1, sbx, sby, false);
  shop.built = true;
  shop.progress = 1;
  shop.hp = shop.maxHp;
  shop.invulnerable = true;
  initBuilding(shop, 'shop', 0);
  sv.shopId = shop.id;
  sv.shop = { x: shop.x, y: shop.y, bx: sbx, by: sby, size: 5, id: shop.id };

  // ---- Shapers spawn in a ring around the Shop
  const shapers = world.players.filter((p) => p.role === 'shaper');
  const a0 = world.rng.next() * Math.PI * 2;
  const [r0, r1] = SURVIVAL.shaperSpawnRing;
  shapers.forEach((p, i) => {
    const a = a0 + (i / Math.max(1, shapers.length)) * Math.PI * 2;
    const r = r0 + world.rng.next() * (r1 - r0);
    const u = spawnUnit(world, 'builder', p.id, shop.x + Math.cos(a) * r, shop.y + Math.sin(a) * r);
    initShaper(world, p, u);
  });
}

function initBuilding(b, type, level) {
  b.level = level;
  b.upgrading = 0;
  b.upgradeTotal = 0;
  b.upgradeTo = 0;
  b.upgradeCost = null;
  b.pausedUpgrade = null; // an upgrade interrupted by a salvage, resumed if the salvage is cancelled
  b.salvaging = 0;
  b.ceaseFire = false;
  b.dr = 0;
  b.invested = { gas: 0, minerals: 0 };
  b.overchargeUntil = 0;
  b.invulnUntil = 0;
  b.aim = 0;
  b.cooldown = 0;
  b.weaponDamage = 0;
  b.weaponRange = 0;
  b.weaponCooldown = 0;
}

function initUnitState(u) {
  u.stasisUntil = 0;
  u.cloakUntil = 0;
  u.immuneUntil = 0;
  u.invulnUntil = 0;
  u.decayUntil = 0;
  u.tier = 0;
  u.dr = 0;
  u.regen = 0;
}

// Spawns a unit at the nearest free spot (a free 2x2 block for 2-cell units).
function spawnUnit(world, type, owner, x, y) {
  const def = UNITS[type];
  let px = x;
  let py = y;
  if (def.clearance === 2) {
    const nb = world.grid.nearestFreeBlock(x, y, 24);
    if (nb) {
      px = nb[0] + 1;
      py = nb[1] + 1;
    }
  } else {
    const nf = world.grid.nearestFree(x, y, 16);
    if (nf) {
      px = nf[0] + 0.5;
      py = nf[1] + 0.5;
    }
  }
  const sv = world.survival;
  const face = sv && sv.shop ? Math.atan2(sv.shop.y - py, sv.shop.x - px) : 0;
  const u = world.createUnit(type, owner, px, py, { supplyCounted: true, facing: face });
  initUnitState(u);
  return u;
}

function initShaper(world, p, u) {
  p.heroId = u.id;
  u.swift = p.abilities.includes('swift');
  u.autocast = {};
}

function spawnLancerHero(world, p, type) {
  const sv = world.survival;
  const u = spawnUnit(world, type, p.id, sv.shop.x, sv.shop.y + sv.shop.size / 2 + 1);
  p.heroId = u.id;
  p.respawnAt = -1;
  u.autocast = {};
  recomputeLancer(world, u, true);
  return u;
}

// Applies item stats to a Lancer / Hunter hero.
export function recomputeLancer(world, u, full = false) {
  const p = world.players[u.owner];
  const st = lancerStats(p.items, u.type === 'hunter' ? 'hunter' : 'lancer');
  const dh = st.hp - u.maxHp;
  u.maxHp = st.hp;
  if (full) u.hp = st.hp;
  else u.hp = Math.min(u.maxHp, u.hp + Math.max(0, dh));
  u.regen = st.regen;
  u.dr = st.dr;
  u.damage = st.damage;
  u.attackSpeed = st.as;
  u.strikeCooldown = st.cooldown;
  u.speedOverride = st.speed;
  u.sight = st.sight;
  u.immune = st.immune;
  u.scanR = st.scanR;
  u.scanCd = st.scanCd;
}

export function heroOf(world, p) {
  if (!p || !p.heroId) return null;
  const u = world.byId.get(p.heroId);
  return u && !u.dead ? u : null;
}

// ================================================================== per tick

export function stepSurvival(world) {
  const sv = world.survival;
  const tick = world.tick;
  const pace = paceOf(world);

  if (sv.phase === 'pregame' && tick >= sv.lancerTick) {
    sv.phase = 'hunt';
    const lp = world.players[sv.lancerId];
    if (lp && !lp.eliminated) {
      const u = spawnLancerHero(world, lp, 'lancerHero');
      world.emit({ e: 'lancerArrives', owner: lp.id, id: u.id, x: u.x, y: u.y });
    }
  }
  if (!sv.unlocked && tick >= sv.unlockTick) {
    sv.unlocked = true;
    world.emit({ e: 'unlock' });
  }

  for (const p of world.players) {
    if (p.eliminated) continue;
    for (const k in p.cd) if (p.cd[k] > 0) p.cd[k] = Math.max(0, p.cd[k] - DT);
    if (p.form === 'shaper' && p.alive && !p.abilities.length && tick >= T(SURVIVAL.abilityPickTime)) {
      pickAbilities(world, p, ['stasis', 'blink']);
    }
    if ((p.form === 'lancer' || p.form === 'hunter') && sv.phase === 'hunt' && heroOf(world, p)) {
      const inc = SURVIVAL.passiveIncome * DT * pace;
      p.minerals += inc;
      p.stats.mineralsEarned += inc;
    }
    if (p.pendingForm >= 0 && tick >= p.pendingForm) becomeSpirit(world, p);
    if (p.respawnAt >= 0 && tick >= p.respawnAt) {
      p.respawnAt = -1;
      if (p.form === 'spirit') spawnSpirit(world, p);
      else if (p.form === 'hunter') {
        const u = spawnLancerHero(world, p, 'hunter');
        world.emit({ e: 'respawn', owner: p.id, id: u.id, x: u.x, y: u.y, form: 'hunter' });
      }
    }
  }

  // units: stasis expiry -> spell immunity, Lancer regeneration and Shop healing
  const spirits = (sv.spirits = []);
  const shop = sv.shop;
  const healR2 = SURVIVAL.shopRadius * SURVIVAL.shopRadius;
  for (const u of world.units) {
    if (u.dead) continue;
    if (u.stasisUntil && tick >= u.stasisUntil) {
      u.stasisUntil = 0;
      u.immuneUntil = tick + T(u.immune || 6);
    }
    if (u.type === 'spirit') spirits.push(u);
    else if (isLancerType(u)) {
      let heal = (u.regen || 0) * DT;
      const dx = u.x - shop.x;
      const dy = u.y - shop.y;
      if (dx * dx + dy * dy <= healR2) heal += u.maxHp * SURVIVAL.shopHealPct * DT;
      if (heal > 0 && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + heal);
    }
  }
  sv.overcharged = world.buildings.filter((b) => b.overchargeUntil > tick && !b.dead);

  // Barrier Fields expire
  if (sv.fields.length) {
    sv.fields = sv.fields.filter((f) => {
      if (f.until > tick) return true;
      world.grid.clearRect(f.bx, f.by, 2, 2, f.id);
      grantImmunityNear(world, f.x, f.y, 3.5);
      return false;
    });
  }
  if (sv.scans.length) sv.scans = sv.scans.filter((s) => s.until > tick);

  stepPickups(world);
}

function grantImmunityNear(world, x, y, r) {
  for (const u of world.units) {
    if (u.dead || !isLancerType(u)) continue;
    if (Math.hypot(u.x - x, u.y - y) <= r + u.r) u.immuneUntil = Math.max(u.immuneUntil, world.tick + T(u.immune || 6));
  }
}

// ---------------------------------------------------------------- pickups

function stepPickups(world) {
  const sv = world.survival;
  const tick = world.tick;
  if (tick >= sv.nextGasBonus) {
    sv.nextGasBonus = tick + T(SURVIVAL.gasBonusEvery);
    if (world.pickups.filter((k) => k.type === 'gasBonus').length < SURVIVAL.gasBonusMax) spawnGasBonus(world);
  }
  if (!world.pickups.length) return;
  const pace = paceOf(world);
  world.pickups = world.pickups.filter((k) => {
    if (k.expires >= 0 && tick >= k.expires) return false;
    for (const p of world.players) {
      if (p.eliminated) continue;
      const h = heroOf(world, p);
      if (!h || h.stasisUntil > tick) continue;
      // spec §2: centre distance <= 1.2 (gas bonus, Shaper hero) / <= 1.5 (pallet, Lancer / Hunters)
      if (k.type === 'gasBonus' && h.type === 'builder' && Math.hypot(h.x - k.x, h.y - k.y) <= SURVIVAL.gasBonusPickup) {
        const amt = k.amount * pace;
        p.gas += amt;
        p.stats.gasEarned += amt;
        world.emit({ e: 'pickup', type: k.type, owner: p.id, amount: amt, x: k.x, y: k.y, id: k.id });
        return false;
      }
      if (k.type === 'pallet' && isLancerType(h) && Math.hypot(h.x - k.x, h.y - k.y) <= SURVIVAL.palletPickup) {
        p.minerals += k.amount;
        p.stats.mineralsEarned += k.amount;
        world.emit({ e: 'pickup', type: k.type, owner: p.id, amount: k.amount, x: k.x, y: k.y, id: k.id });
        return false;
      }
    }
    return true;
  });
}

function spawnGasBonus(world) {
  const map = world.map;
  const sv = world.survival;
  for (let attempt = 0; attempt < 60; attempt++) {
    const x = 2 + world.rng.int(map.width - 4);
    const y = 2 + world.rng.int(map.height - 4);
    if (!world.grid.pathable(x, y)) continue;
    if (map.flags[y * map.width + x] & CELL_RAMP) continue;
    if (Math.hypot(x + 0.5 - sv.shop.x, y + 0.5 - sv.shop.y) < SURVIVAL.gasBonusMinDist) continue;
    const k = { id: world.nextId++, type: 'gasBonus', x: x + 0.5, y: y + 0.5, amount: SURVIVAL.gasBonusAmount, expires: -1 };
    world.pickups.push(k);
    world.emit({ e: 'pickupSpawn', type: k.type, id: k.id, x: k.x, y: k.y });
    return k;
  }
  return null;
}

// ================================================================== deaths & forms

export function onKilled(world, e, attacker) {
  const p = e.owner >= 0 ? world.players[e.owner] : null;
  const killer = attacker && attacker.owner >= 0 ? world.players[attacker.owner] : null;
  if (!p || e.kind !== 'unit' || p.heroId !== e.id) return;
  const by = attacker ? attacker.owner : -1;
  p.heroId = 0;
  p.stats.deaths++;
  if (e.type === 'builder') {
    p.alive = false;
    if (killer && killer.team === LANCER_TEAM) killer.stats.shapersKilled++;
    world.emit({ e: 'shaperDown', owner: p.id, by, x: e.x, y: e.y });
    // all of their structures and units vanish (no pallets, no feed)
    for (const o of world.entities) {
      if (o.owner === p.id && !o.dead && o !== e && (o.kind === 'unit' || o.kind === 'building')) world.kill(o, null, true);
    }
    if (gameTime(world) < SURVIVAL.unlockTime || p.type === 'ai') becomeSpirit(world, p);
    else p.pendingForm = world.tick + T(SURVIVAL.formChoiceTime);
    checkSurvivalVictory(world);
  } else if (e.type === 'lancerHero') {
    p.alive = false;
    world.emit({ e: 'lancerDown', owner: p.id, by, x: e.x, y: e.y });
    checkSurvivalVictory(world);
  } else if (e.type === 'hunter') {
    p.respawnAt = world.tick + T(SURVIVAL.hunterRespawn);
    world.emit({ e: 'hunterDown', owner: p.id, by, x: e.x, y: e.y });
  } else if (e.type === 'spirit') {
    p.respawnAt = world.tick + T(SURVIVAL.spiritRespawn);
    world.emit({ e: 'spiritDown', owner: p.id, by, x: e.x, y: e.y });
  }
}

function becomeSpirit(world, p) {
  p.pendingForm = -1;
  p.form = 'spirit';
  p.team = SHAPER_TEAM;
  p.cd = {};
  world.emit({ e: 'form', owner: p.id, form: 'spirit' });
  spawnSpirit(world, p);
}

function spawnSpirit(world, p) {
  const spawns = world.map.builderSpawns;
  const s = spawns.length ? spawns[world.rng.int(spawns.length)] : world.survival.shop;
  const u = spawnUnit(world, 'spirit', p.id, s.x, s.y);
  u.invulnUntil = world.tick + T(SURVIVAL.spiritInvuln);
  u.autocast = {};
  p.heroId = u.id;
  p.respawnAt = -1;
  world.emit({ e: 'respawn', owner: p.id, id: u.id, x: u.x, y: u.y, form: 'spirit' });
  return u;
}

function becomeHunter(world, p) {
  p.pendingForm = -1;
  p.form = 'hunter';
  p.team = LANCER_TEAM;
  p.gas = 0;
  p.minerals = 0;
  p.items = [];
  p.cd = {};
  world.emit({ e: 'form', owner: p.id, form: 'hunter' });
  const u = spawnLancerHero(world, p, 'hunter');
  world.emit({ e: 'respawn', owner: p.id, id: u.id, x: u.x, y: u.y, form: 'hunter' });
}

export function checkSurvivalVictory(world) {
  if (world.over) return;
  const sv = world.survival;
  const lancer = world.players[sv.lancerId];
  const shapersAlive = world.players.some((p) => p.role === 'shaper' && p.form === 'shaper' && p.alive && !p.eliminated);
  let winner = 0;
  if (!lancer || lancer.eliminated) {
    winner = SHAPER_TEAM;
    sv.reason = 'The Lancer left the game';
  } else if (!lancer.alive) {
    winner = SHAPER_TEAM;
    sv.reason = 'The Lancer was slain';
  } else if (!shapersAlive) {
    winner = LANCER_TEAM;
    sv.reason = 'Every Shaper has fallen';
  } else if (sv.endTick >= 0 && world.tick >= sv.endTick) {
    winner = SHAPER_TEAM;
    sv.reason = 'The Shapers survived until the end';
  }
  if (winner) {
    world.over = true;
    world.winnerTeam = winner;
    sv.winner = winner;
    world.sampleStats();
    world.emit({ e: 'gameOver', winnerTeam: winner, reason: sv.reason });
  }
}

// ================================================================== damage hooks

// Feed: the Lancer / Hunters earn minerals equal to the damage they deal to Shaper property.
export function onSurvivalDamage(world, attacker, target, dealt) {
  if (dealt <= 0 || attacker.kind !== 'unit' || !isLancerType(attacker)) return;
  const tp = world.players[target.owner];
  if (!tp || tp.team !== SHAPER_TEAM) return;
  const ap = world.players[attacker.owner];
  const amt = dealt * paceOf(world);
  ap.minerals += amt;
  ap.stats.fed += amt;
  ap.stats.mineralsEarned += amt;
}

// Cloaked units are visible to a team only inside its Scans or near its Lancer Detectors.
export function isDetected(world, u, team) {
  const sv = world.survival;
  for (const s of sv.scans) {
    if (s.team === team && s.until > world.tick && Math.hypot(u.x - s.x, u.y - s.y) <= s.r) return true;
  }
  for (const b of world.buildings) {
    if (b.type !== 'detector' || !b.built || b.dead || b.owner < 0) continue;
    if (world.players[b.owner].team !== team) continue;
    if (Math.hypot(u.x - b.x, u.y - b.y) <= SURVIVAL.detectorRange) return true;
  }
  return false;
}

// ================================================================== costs & placement

export function buildCost(type, level = 1) {
  if (!isSurvivalStructure(type)) return { gas: 0, minerals: 0 };
  if (type === 'autoMine') {
    const L = AUTOMINE_LEVELS[level - 1];
    return L ? { gas: 0, minerals: L.minerals } : { gas: 0, minerals: 0 };
  }
  const tbl = hasKey(UPGRADABLE, type) ? UPGRADABLE[type] : null;
  if (tbl) return cumulativeCost(tbl, level);
  const sb = SURVIVAL_BUILDINGS[type];
  return sb && sb.cost ? { gas: sb.cost.gas, minerals: sb.cost.minerals } : { gas: 0, minerals: 0 };
}

export function buildTimeOf(type, level = 1) {
  if (type === 'turret' && TURRET_DIRECT[level]) return TURRET_DIRECT[level].time;
  if (type === 'generator') return GENERATOR_LEVELS[0].time;
  if (type === 'wall') return WALL_LEVELS[level - 1]?.time ?? 2;
  if (type === 'market') return MARKET_LEVELS[0].time;
  if (type === 'turret') return TURRET_LEVELS[0].time;
  return isSurvivalStructure(type) ? SURVIVAL_BUILDINGS[type].buildTime ?? 5 : 5;
}

// Max HP / shield / damage reduction of a structure at a level
export function levelStats(type, level) {
  switch (type) {
    case 'generator': {
      const L = GENERATOR_LEVELS[level - 1];
      return { hp: L.hp, shield: 0, dr: L.dr };
    }
    case 'wall': {
      const L = WALL_LEVELS[level - 1];
      return { hp: L.hp, shield: L.shield, dr: L.dr };
    }
    case 'market':
      return { hp: MARKET_LEVELS[level - 1].hp, shield: 0, dr: 0 };
    case 'turret':
      return { hp: TURRET_LEVELS[level - 1].hp, shield: 0, dr: 0 };
    default:
      return { hp: SURVIVAL_BUILDINGS[type]?.hp ?? BUILDINGS[type].hp, shield: 0, dr: 0 };
  }
}

// Owns a completed structure of `type` at `level` or higher
export function hasStructure(world, owner, type, level = 1) {
  for (const b of world.buildings) {
    if (b.owner === owner && b.type === type && b.built && !b.dead && (b.level || 1) >= level) return true;
  }
  return false;
}

function meets(world, owner, r) {
  if (!r) return true;
  return hasStructure(world, owner, r.type, r.level || 1);
}

function validLevel(type, level) {
  if (type === 'turret') return level === 1 || !!TURRET_DIRECT[level];
  if (type === 'autoMine') return level >= 1 && level <= AUTOMINE_LEVELS.length;
  return level === 1;
}

export function canPlaceSurvival(world, owner, type, bx, by, level = 1) {
  const p = world.players[owner];
  level = Math.floor(Number(level) || 1);
  if (!isSurvivalStructure(type)) return { ok: false, reason: 'Unknown structure' };
  if (!p || p.role !== 'shaper' || p.form !== 'shaper' || !p.alive) return { ok: false, reason: 'Only Shapers can build' };
  if (!validLevel(type, level)) return { ok: false, reason: 'Invalid level' };
  // requirements
  if (type === 'generator') {
    if (world.buildings.some((b) => b.owner === owner && b.type === 'generator' && !b.dead)) return { ok: false, reason: 'Only one Generator' };
  } else if (type === 'turret' && TURRET_DIRECT[level]) {
    const r = TURRET_DIRECT[level].requires;
    if (!meets(world, owner, r)) return { ok: false, reason: requirementText(r) };
  } else if (type === 'autoMine' && !hasStructure(world, owner, 'depot')) {
    return { ok: false, reason: requirementText({ type: 'depot' }) };
  } else if (type === 'detector' && !hasStructure(world, owner, 'library')) {
    return { ok: false, reason: requirementText({ type: 'library' }) };
  }
  // terrain & occupancy
  const s = BUILDINGS[type].size;
  const g = world.grid;
  bx = Math.floor(Number(bx) || 0);
  by = Math.floor(Number(by) || 0);
  for (let y = by; y < by + s; y++) for (let x = bx; x < bx + s; x++) if (!g.buildable(x, y)) return { ok: false, reason: "Can't build there" };
  const shop = world.survival.shop;
  if (shop && rectDist(bx, by, s, s, shop.bx, shop.by, shop.size, shop.size) < SURVIVAL.shopClearance) return { ok: false, reason: 'Too close to the Shop' };
  if (!world.survival.unlocked) {
    for (const r of world.resources) {
      if (!r.rich || r.dead) continue;
      if (rectDist(bx, by, s, s, r.bx, r.by, r.w, r.h) < SURVIVAL.goldLockRadius) return { ok: false, reason: 'Gold bases open at 5:00' };
    }
  }
  const near = world.hash.query(bx + s / 2, by + s / 2, s + 2, world._q);
  for (const u of near) {
    if (u.dead || u.hidden || u.owner === owner || u.type === 'miner') continue;
    if (u.x + u.r > bx && u.x - u.r < bx + s && u.y + u.r > by && u.y - u.r < by + s) return { ok: false, reason: 'Something is in the way' };
  }
  const cost = buildCost(type, level);
  if (p.gas < cost.gas - 1e-9) return { ok: false, reason: 'Not enough gas', gas: cost.gas, minerals: cost.minerals };
  if (p.minerals < cost.minerals - 1e-9) return { ok: false, reason: 'Not enough minerals', gas: cost.gas, minerals: cost.minerals };
  return { ok: true, gas: cost.gas, minerals: cost.minerals, time: buildTimeOf(type, level) };
}

// Creates the structure (under construction) when the Shaper reaches the site; pays the cost.
export function placeSurvival(world, owner, type, bx, by, builder, level = 1) {
  level = Math.floor(Number(level) || 1);
  const chk = canPlaceSurvival(world, owner, type, bx, by, level);
  const s = isSurvivalStructure(type) ? BUILDINGS[type].size : 2;
  if (!chk.ok) {
    world.error(owner, chk.reason, bx + s / 2, by + s / 2);
    return chk;
  }
  const p = world.players[owner];
  p.gas -= chk.gas;
  p.minerals -= chk.minerals;
  p.stats.spent += chk.gas + chk.minerals;
  const st = levelStats(type, level);
  const b = world.createBuilding(type, owner, bx, by, false, { hp: st.hp, barrier: st.shield, armor: 0, level });
  initBuilding(b, type, level);
  b.dr = st.dr;
  b.buildTime = chk.time;
  b.invested = { gas: chk.gas, minerals: chk.minerals };
  if (type === 'turret') setTurretStats(b);
  // push own units out of the footprint
  const near = world.hash.query(bx + s / 2, by + s / 2, s + 2, world._q);
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
  world.emit({ e: 'buildStart', id: b.id, owner, type, level });
  return { ok: true, building: b };
}

function setTurretStats(b) {
  const L = TURRET_LEVELS[b.level - 1];
  b.weaponDamage = L.damage;
  b.weaponRange = L.range;
  b.weaponCooldown = L.cooldown;
  // a turret sees at least as far as it shoots (range from its edge + half its size + a Lancer radius)
  b.sight = Math.max(b.def.sight, Math.ceil(L.range + b.w / 2 + 1));
}

// ================================================================== upgrades & salvage

export function upgradeInfo(world, b) {
  const tbl = b ? UPGRADABLE[b.type] : null;
  if (!b || b.dead || !tbl) return { ok: false, reason: 'Cannot be upgraded', gas: 0, minerals: 0, time: 0, next: 0 };
  const next = (b.level || 1) + 1;
  if (next > tbl.length) return { ok: false, reason: 'Max level', gas: 0, minerals: 0, time: 0, next: 0 };
  const L = tbl[next - 1];
  const info = { ok: false, reason: '', gas: L.gas || 0, minerals: L.minerals || 0, time: L.time, next };
  const p = world.players[b.owner];
  if (!b.built) info.reason = 'Under construction';
  else if (b.upgrading > 0) info.reason = 'Already upgrading';
  else if (b.salvaging > 0) info.reason = 'Being salvaged';
  else if (L.requires && !meets(world, b.owner, L.requires)) info.reason = requirementText(L.requires);
  else if (!p || p.gas < info.gas - 1e-9) info.reason = 'Not enough gas';
  else if (p.minerals < info.minerals - 1e-9) info.reason = 'Not enough minerals';
  else info.ok = true;
  return info;
}

export function startUpgrade(world, pid, b) {
  const info = upgradeInfo(world, b);
  if (!info.ok) {
    world.error(pid, info.reason, b?.x, b?.y);
    return false;
  }
  const p = world.players[b.owner];
  p.gas -= info.gas;
  p.minerals -= info.minerals;
  p.stats.spent += info.gas + info.minerals;
  b.invested.gas += info.gas;
  b.invested.minerals += info.minerals;
  b.upgrading = info.time;
  b.upgradeTotal = info.time;
  b.upgradeTo = info.next;
  b.upgradeCost = { gas: info.gas, minerals: info.minerals };
  world.emit({ e: 'upgradeStart', id: b.id, owner: b.owner, type: b.type, level: info.next });
  return true;
}

function finishUpgrade(world, b) {
  const prev = levelStats(b.type, b.level);
  b.level = b.upgradeTo || b.level + 1;
  const st = levelStats(b.type, b.level);
  b.maxHp = st.hp;
  b.hp = Math.min(b.maxHp, b.hp + Math.max(0, st.hp - prev.hp));
  b.maxBarrier = st.shield;
  b.barrier = Math.min(b.maxBarrier, b.barrier + Math.max(0, st.shield - prev.shield));
  b.dr = st.dr;
  b.upgrading = 0;
  b.upgradeTotal = 0;
  b.upgradeTo = 0;
  b.upgradeCost = null;
  if (b.type === 'turret') setTurretStats(b);
  world.emit({ e: 'upgraded', id: b.id, owner: b.owner, type: b.type, level: b.level, x: b.x, y: b.y });
}

export function startSalvage(world, pid, b) {
  if (!SURVIVAL_BUILDINGS[b.type]?.salvage) {
    world.error(pid, 'Cannot be salvaged', b.x, b.y);
    return false;
  }
  if (!b.built) return cancelConstruction(world, b);
  if (b.salvaging > 0) return false;
  // a running upgrade stops (its cost is part of `invested`); cancelling the salvage resumes it
  b.pausedUpgrade = b.upgrading > 0 ? { left: b.upgrading, total: b.upgradeTotal, to: b.upgradeTo, cost: b.upgradeCost } : null;
  b.upgrading = 0;
  b.upgradeTotal = 0;
  b.upgradeTo = 0;
  b.upgradeCost = null;
  b.salvaging = SURVIVAL.salvageTime;
  world.emit({ e: 'salvageStart', id: b.id, owner: b.owner, type: b.type });
  return true;
}

// Paid Depot / Library queue entries (miners, Wardens) are refunded with the building.
function queueRefund(b) {
  let gas = 0;
  let minerals = 0;
  for (const q of b.queue || []) {
    gas += q.gas || 0;
    minerals += q.minerals || 0;
  }
  if (b.queue) b.queue.length = 0;
  return { gas, minerals };
}

function stopSalvage(b) {
  b.salvaging = 0;
  const pu = b.pausedUpgrade;
  b.pausedUpgrade = null;
  if (!pu) return;
  b.upgrading = pu.left;
  b.upgradeTotal = pu.total;
  b.upgradeTo = pu.to;
  b.upgradeCost = pu.cost;
}

function finishSalvage(world, b) {
  const p = world.players[b.owner];
  const q = queueRefund(b);
  const gas = b.invested.gas + q.gas;
  const minerals = b.invested.minerals + q.minerals;
  p.gas += gas;
  p.minerals += minerals;
  p.stats.spent -= gas + minerals;
  p.stats.salvaged++;
  if (b.type === 'generator' && b.level >= 2) {
    const amount = GENERATOR_LEVELS[b.level - 1].pallet;
    const k = { id: world.nextId++, type: 'pallet', x: b.x, y: b.y, amount, expires: world.tick + T(SURVIVAL.palletLife) };
    world.pickups.push(k);
    world.emit({ e: 'pickupSpawn', type: 'pallet', id: k.id, x: k.x, y: k.y, amount });
  }
  b.salvaging = 0;
  world.emit({ e: 'salvaged', id: b.id, owner: b.owner, type: b.type, gas, minerals, x: b.x, y: b.y });
  world.kill(b, null, true);
}

function cancelConstruction(world, b) {
  const p = world.players[b.owner];
  const q = queueRefund(b);
  p.gas += b.invested.gas + q.gas;
  p.minerals += b.invested.minerals + q.minerals;
  p.stats.spent -= b.invested.gas + b.invested.minerals + q.gas + q.minerals;
  world.emit({ e: 'cancelled', id: b.id, owner: b.owner, type: b.type });
  world.kill(b, null, true);
  return true;
}

// ================================================================== structure updates

export function updateSurvivalBuilding(world, b) {
  if (b.type === 'shop' || b.owner < 0) return;
  const tick = world.tick;
  const oc = b.overchargeUntil > tick ? SURVIVAL.overchargeFactor : 1;
  if (b.salvaging > 0) {
    b.salvaging -= DT;
    if (b.salvaging <= 1e-9) {
      finishSalvage(world, b);
      return;
    }
  }
  if (!b.built) {
    const rate = (DT * oc) / (b.buildTime || b.def.buildTime);
    b.progress = Math.min(1, b.progress + rate);
    b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.9 * rate);
    b.barrier = Math.min(b.maxBarrier, b.barrier + b.maxBarrier * 0.9 * rate);
    if (b.progress >= 1 - 1e-9) world.completeBuilding(b);
    return;
  }
  if (b.upgrading > 0) {
    b.upgrading -= DT * oc;
    if (b.upgrading <= 1e-9) finishUpgrade(world, b);
  }
  const p = world.players[b.owner];
  switch (b.type) {
    case 'generator': {
      const g = GENERATOR_LEVELS[b.level - 1].income * DT * paceOf(world) * oc;
      p.gas += g;
      p.stats.gasEarned += g;
      break;
    }
    case 'autoMine': {
      const g = AUTOMINE_LEVELS[b.level - 1].income * DT * paceOf(world) * oc;
      p.gas += g;
      p.stats.gasEarned += g;
      break;
    }
    case 'turret':
      turretFire(world, b, oc);
      break;
    case 'depot':
    case 'library':
      stepQueue(world, b); // Overcharge does not speed up training (spec section 6)
      break;
    default:
      break;
  }
}

function spiritNear(world, team, x, y) {
  for (const s of world.survival.spirits) {
    if (s.dead || world.players[s.owner].team !== team) continue;
    if (Math.hypot(s.x - x, s.y - y) <= SURVIVAL.spiritAuraRadius) return true;
  }
  return false;
}

function turretFire(world, b, oc) {
  if (b.cooldown > 0) b.cooldown -= DT * oc;
  if (b.cooldown > 0) return;
  if (b.upgrading > 0 || b.salvaging > 0 || b.ceaseFire) {
    b.cooldown = 0;
    return;
  }
  let best = null;
  let bd = Infinity;
  const half = b.w / 2;
  const near = world.hash.query(b.x, b.y, b.weaponRange + half + 2, world._q);
  for (const u of near) {
    // units in stasis / invulnerable take no damage: shoot something else
    if (u.dead || u.hidden || !world.areEnemies(b.owner, u.owner) || untouchable(world, u)) continue;
    const d = pointEdgeDist(b.x, b.y, u) - half;
    if (d > b.weaponRange || d >= bd) continue;
    if (!world.isVisibleTo(u, b.owner)) continue;
    bd = d;
    best = u;
  }
  if (!best) {
    b.cooldown = 0;
    return;
  }
  b.cooldown += b.weaponCooldown;
  b.aim = Math.atan2(best.y - b.y, best.x - b.x);
  let dmg = b.weaponDamage;
  if (spiritNear(world, world.players[b.owner].team, b.x, b.y)) dmg *= 1 + SURVIVAL.spiritTurretBonus;
  world.emit({ e: 'bolt', from: b.id, to: best.id, heavy: b.level >= 7 ? 1 : 0 });
  applyDamage(world, best, dmg, b);
}

function stepQueue(world, b) {
  const item = b.queue[0];
  if (!item || b.salvaging > 0) return;
  item.progress += DT;
  if (item.progress < item.time - 1e-9) return;
  b.queue.shift();
  const u = world.spawnFromBuilding(b, item.id);
  initUnitState(u);
  u.tier = item.tier;
  u.autocast = {};
  if (item.id === 'miner') {
    clearOrders(world, u);
    assignMiner(world, u);
  } else if (item.id === 'warden') {
    const W = WARDEN_TIERS[item.tier - 1];
    u.maxHp = W.hp;
    u.hp = W.hp;
    u.damage = W.dps;
  }
}

// ================================================================== miners

export function minerCount(world, owner) {
  let n = 0;
  for (const u of world.units) if (u.owner === owner && u.type === 'miner' && !u.dead) n++;
  for (const b of world.buildings) {
    if (b.owner !== owner || b.dead || b.type !== 'depot') continue;
    for (const q of b.queue) if (q.id === 'miner') n++;
  }
  return n;
}

function fieldLoad(world, except) {
  const load = new Map();
  for (const u of world.units) {
    if (u.dead || u.type !== 'miner' || u === except) continue;
    const o = u.orders[0];
    if (o && o.type === 'mine') load.set(o.target, (load.get(o.target) || 0) + 1);
  }
  return load;
}

const MINER_PATH_TRIES = 4; // fields checked for reachability per assignment

// A miner remembers mineral fields it could not reach (walled in) and skips them for a while.
export function minerAvoid(world, u, r) {
  if (!u.avoidFields) u.avoidFields = new Map();
  u.avoidFields.set(r.id, world.tick + T(SURVIVAL.minerAvoidTime));
}

// Full search (no node budget): can the miner walk next to field r?
export function minerReaches(world, u, r) {
  const path = world.grid.findPath(u.x, u.y, r.x, r.y, {
    rect: { x: r.bx, y: r.by, w: r.w, h: r.h },
    radius: u.r,
    pad: 1,
    maxNodes: world.map.width * world.map.height,
  });
  return !!path && path.reached !== false;
}

// Sends a miner to the nearest reachable field with room. Tiers 1-4 prefer gold (double yield),
// but only when it is at most SURVIVAL.minerGoldPreference cells farther than a normal field, so
// miners of a depot in a far base mine its own grove instead of walking out to the centre.
export function assignMiner(world, u, preferred = null) {
  const load = fieldLoad(world, u);
  const tick = world.tick;
  const open = (r) =>
    r && !r.dead && r.type === 'crystal' && (load.get(r.id) || 0) < SURVIVAL.minersPerField && !(u.avoidFields?.get(r.id) > tick);
  let cands;
  if (open(preferred)) cands = [preferred];
  else {
    const scored = [];
    for (const r of world.resources) {
      if (!open(r)) continue;
      const d = Math.hypot(r.x - u.x, r.y - u.y);
      scored.push({ r, s: d - (r.rich && (u.tier || 1) <= 4 ? SURVIVAL.minerGoldPreference : 0) });
    }
    scored.sort((a, b) => a.s - b.s || a.r.id - b.r.id);
    cands = scored.slice(0, MINER_PATH_TRIES).map((k) => k.r);
  }
  let best = null;
  for (const r of cands) {
    if (minerReaches(world, u, r)) {
      best = r;
      break;
    }
    minerAvoid(world, u, r);
  }
  if (!best) return false;
  clearOrders(world, u);
  u.orders.push({ type: 'mine', target: best.id, phase: 'toField', timer: 0 });
  return true;
}

// Called every tick by a miner standing at its field.
export function minerWork(world, u, res, o) {
  const tier = MINER_TIERS[(u.tier || 1) - 1];
  const sv = world.survival;
  let speed = 1;
  if (sv.spirits.length && spiritNear(world, world.players[u.owner].team, u.x, u.y)) speed += SURVIVAL.spiritMinerBonus;
  for (const b of sv.overcharged) {
    if (b.owner >= 0 && world.isAllied(b.owner, u.owner) && pointEdgeDist(u.x, u.y, b) <= SURVIVAL.minerOverchargeRadius) {
      speed += SURVIVAL.overchargeFactor - 1;
      break;
    }
  }
  o.timer += DT * speed;
  if (o.timer < tier.interval) return;
  o.timer -= tier.interval;
  const gold = res.rich && tier.tier <= 4 ? 2 : 1;
  const amt = tier.amount * gold * paceOf(world);
  const p = world.players[u.owner];
  p.minerals += amt;
  p.stats.crystalsMined += amt;
  p.stats.mineralsEarned += amt;
  u.minedAcc = (u.minedAcc || 0) + amt;
  if (!(u.lastMinedEv > world.tick - T(2))) {
    u.lastMinedEv = world.tick;
    world.emit({ e: 'mined', id: u.id, owner: u.owner, n: Math.round(u.minedAcc * 100) / 100, x: u.x, y: u.y });
    u.minedAcc = 0;
  }
}

// ================================================================== abilities

function pickAbilities(world, p, a) {
  if (!Array.isArray(a) || a.length !== 2) return false;
  const [c, m] = a;
  if (!SHAPER_CONTROL.includes(c) || !SHAPER_MOBILITY.includes(m)) return false;
  p.abilities = [c, m];
  const h = heroOf(world, p);
  if (h && h.type === 'builder') h.swift = m === 'swift';
  world.emit({ e: 'abilitiesPicked', owner: p.id, a: [c, m] });
  return true;
}

function abilityDef(p, id) {
  if (typeof id !== 'string') return null;
  if (p.form === 'shaper') return p.abilities.includes(id) && hasKey(SHAPER_ABILITIES, id) ? SHAPER_ABILITIES[id] : null;
  if (p.form === 'lancer') return hasKey(LANCER_ABILITIES, id) ? LANCER_ABILITIES[id] : null;
  if (p.form === 'hunter') return HUNTER_ABILITY_IDS.includes(id) && hasKey(LANCER_ABILITIES, id) ? LANCER_ABILITIES[id] : null;
  if (p.form === 'spirit') return hasKey(SPIRIT_ABILITIES, id) ? SPIRIT_ABILITIES[id] : null;
  return null;
}

// Finds an enemy Lancer/Hunter by id or near (x, y)
function enemyHeroTarget(world, pid, c) {
  let t = c.target ? world.byId.get(c.target) : null;
  if (!t && Number.isFinite(c.x) && Number.isFinite(c.y)) {
    let bd = 3;
    for (const u of world.units) {
      if (u.dead || !isLancerType(u) || !world.areEnemies(pid, u.owner)) continue;
      const d = Math.hypot(u.x - c.x, u.y - c.y);
      if (d < bd) {
        bd = d;
        t = u;
      }
    }
  }
  if (!t || t.dead || t.kind !== 'unit' || !isLancerType(t) || !world.areEnemies(pid, t.owner)) return null;
  return t;
}

function teleport(world, u, x, y) {
  let px = x;
  let py = y;
  if (u.def.clearance === 2) {
    const nb = world.grid.nearestFreeBlock(x, y, 12);
    if (!nb) return false;
    px = nb[0] + 1;
    py = nb[1] + 1;
  } else if (!world.grid.pathable(Math.floor(x), Math.floor(y))) {
    const nf = world.grid.nearestFree(x, y, 2);
    if (!nf) return false;
    px = nf[0] + 0.5;
    py = nf[1] + 0.5;
  }
  clearOrders(world, u);
  u.swing = null;
  u.x = px;
  u.y = py;
  u.px = px;
  u.py = py;
  u.nav = null;
  return true;
}

function useAbility(world, pid, c) {
  const p = world.players[pid];
  const id = c.ability;
  const def = abilityDef(p, id);
  if (!def) {
    world.error(pid, 'Unknown ability');
    return false;
  }
  if (def.passive) return false;
  const hero = heroOf(world, p);
  if (!hero) {
    world.error(pid, 'Your hero is not on the field');
    return false;
  }
  if (hero.stasisUntil > world.tick) {
    world.error(pid, 'Trapped in a Stasis Prison');
    return false;
  }
  if (p.cd[id] > 0) {
    world.error(pid, `${def.name} is recharging`);
    return false;
  }
  const tick = world.tick;
  const x = Number(c.x);
  const y = Number(c.y);
  const hasPoint = Number.isFinite(x) && Number.isFinite(y);
  const ev = { e: 'ability', owner: pid, ability: id, id: hero.id };
  let cooldown = def.cooldown;
  switch (id) {
    case 'stasis':
    case 'decay': {
      const t = enemyHeroTarget(world, pid, c);
      if (!t || !world.isVisibleTo(t, pid)) {
        world.error(pid, 'Must target a Lancer or Hunter');
        return false;
      }
      if (Math.hypot(t.x - hero.x, t.y - hero.y) - t.r > def.range) {
        world.error(pid, 'Out of range');
        return false;
      }
      if (t.immuneUntil > tick || t.stasisUntil > tick) {
        world.error(pid, 'Target is immune');
        return false;
      }
      if (id === 'stasis') {
        t.stasisUntil = tick + T(def.duration);
        t.swing = null;
        t.nav = null;
      } else t.decayUntil = tick + T(def.duration);
      ev.target = t.id;
      ev.x = t.x;
      ev.y = t.y;
      break;
    }
    case 'overcharge': {
      const b = c.target ? world.byId.get(c.target) : null;
      if (!b || b.dead || b.kind !== 'building' || b.owner < 0 || !world.isAllied(b.owner, pid) || (p.form === 'shaper' && b.owner !== pid)) {
        world.error(pid, 'Must target your own structure');
        return false;
      }
      if (pointEdgeDist(hero.x, hero.y, b) > def.range) {
        world.error(pid, 'Out of range');
        return false;
      }
      b.overchargeUntil = tick + T(def.duration);
      ev.target = b.id;
      ev.x = b.x;
      ev.y = b.y;
      break;
    }
    case 'invuln': {
      const t = c.target ? world.byId.get(c.target) : hero;
      if (!t || t.dead || t.owner !== pid || (t.kind !== 'building' && t !== hero)) {
        world.error(pid, 'Must target your Shaper or own structure');
        return false;
      }
      if (t !== hero && pointEdgeDist(hero.x, hero.y, t) > def.range) {
        world.error(pid, 'Out of range');
        return false;
      }
      t.invulnUntil = tick + T(def.duration);
      ev.target = t.id;
      ev.x = t.x;
      ev.y = t.y;
      break;
    }
    case 'barrierField': {
      if (!hasPoint) return false;
      if (Math.hypot(x - hero.x, y - hero.y) > def.range) {
        world.error(pid, 'Out of range', x, y);
        return false;
      }
      const bx = Math.round(x) - 1;
      const by = Math.round(y) - 1;
      if (!world.grid.blockFree(bx, by)) {
        world.error(pid, "Can't place a Barrier Field there", x, y);
        return false;
      }
      for (const u of world.units) {
        if (u.dead || u.hidden) continue;
        if (u.x + u.r > bx && u.x - u.r < bx + 2 && u.y + u.r > by && u.y - u.r < by + 2) {
          world.error(pid, 'Something is in the way', x, y);
          return false;
        }
        if (isLancerType(u) && world.areEnemies(pid, u.owner) && u.immuneUntil > tick && Math.hypot(u.x - bx - 1, u.y - by - 1) < 3) {
          world.error(pid, 'Target is immune', x, y);
          return false;
        }
      }
      const f = { id: world.nextId++, owner: pid, bx, by, x: bx + 1, y: by + 1, until: tick + T(def.duration) };
      world.grid.setRect(bx, by, 2, 2, f.id);
      world.survival.fields.push(f);
      ev.x = f.x;
      ev.y = f.y;
      ev.target = f.id;
      break;
    }
    case 'blink':
    case 'farBlink': {
      if (!hasPoint) return false;
      let tx = x;
      let ty = y;
      const d = Math.hypot(tx - hero.x, ty - hero.y);
      if (d > def.range) {
        tx = hero.x + ((tx - hero.x) / d) * def.range;
        ty = hero.y + ((ty - hero.y) / d) * def.range;
      }
      if (id === 'blink' && !world.isVisibleTo({ kind: 'point', x: tx, y: ty }, pid)) {
        world.error(pid, 'Location not visible', tx, ty);
        return false;
      }
      const fx = hero.x;
      const fy = hero.y;
      if (!teleport(world, hero, tx, ty)) {
        world.error(pid, "Can't blink there", tx, ty);
        return false;
      }
      ev.x = hero.x;
      ev.y = hero.y;
      ev.fx = fx;
      ev.fy = fy;
      break;
    }
    case 'recall': {
      let b = c.target ? world.byId.get(c.target) : null;
      if (!b && hasPoint) {
        let bd = Infinity;
        for (const o of world.buildings) {
          if (o.owner !== pid || o.dead) continue;
          const dd = Math.hypot(o.x - x, o.y - y);
          if (dd < bd) {
            bd = dd;
            b = o;
          }
        }
      }
      if (!b || b.dead || b.kind !== 'building' || b.owner !== pid) {
        world.error(pid, 'Must target your own structure');
        return false;
      }
      if (pointEdgeDist(hero.x, hero.y, b) > def.range) {
        world.error(pid, 'Out of range');
        return false;
      }
      const nf = world.grid.nearestFree(b.x, b.y, 6);
      if (!nf || !teleport(world, hero, nf[0] + 0.5, nf[1] + 0.5)) {
        world.error(pid, "Can't recall there");
        return false;
      }
      ev.target = b.id;
      ev.x = hero.x;
      ev.y = hero.y;
      break;
    }
    case 'cloak':
      hero.cloakUntil = tick + T(def.duration);
      break;
    case 'scan': {
      if (!hasPoint) return false;
      const r = hero.scanR || 13;
      cooldown = hero.scanCd || def.cooldown;
      const s = { owner: pid, team: p.team, x, y, r, until: tick + T(def.duration) };
      world.survival.scans.push(s);
      world.emit({ e: 'scan', owner: pid, x, y, r, until: s.until });
      ev.x = x;
      ev.y = y;
      break;
    }
    case 'return': {
      const sh = world.survival.shop;
      const fx = hero.x;
      const fy = hero.y;
      if (!teleport(world, hero, sh.x, sh.y + sh.size / 2 + 1)) return false;
      ev.x = hero.x;
      ev.y = hero.y;
      ev.fx = fx;
      ev.fy = fy;
      break;
    }
    default:
      return false;
  }
  p.cd[id] = cooldown;
  world.emit(ev);
  return true;
}

// ================================================================== Lancer shop

function nearShop(world, p) {
  const h = heroOf(world, p);
  if (!h) return true; // pregame Lancer / respawning Hunter shop from the fountain
  const sh = world.survival.shop;
  return Math.hypot(h.x - sh.x, h.y - sh.y) <= SURVIVAL.shopRadius;
}

const itemValue = (id) => {
  const it = SHOP_ITEMS[id];
  return it ? it.minerals + it.gas * SURVIVAL.gasExchangeRate : 0;
};

function buyItem(world, pid, itemId) {
  const p = world.players[pid];
  const it = hasKey(SHOP_ITEMS, itemId) ? SHOP_ITEMS[itemId] : null;
  if (!it) {
    world.error(pid, 'Unknown item');
    return false;
  }
  if (!nearShop(world, p)) {
    world.error(pid, 'Move to the Shop to buy');
    return false;
  }
  const cat = SHOP_CATEGORIES.find((k) => k.id === it.cat);
  const items = p.items;
  let replace = -1;
  if (!cat.stack) {
    replace = items.findIndex((id) => SHOP_ITEMS[id]?.cat === it.cat);
    if (replace >= 0 && items[replace] === itemId) {
      world.error(pid, 'Already owned');
      return false;
    }
    if (replace < 0 && items.length >= SURVIVAL.maxItems) {
      world.error(pid, 'Inventory full');
      return false;
    }
  } else if (items.length >= SURVIVAL.maxItems) {
    let cheapest = Infinity;
    items.forEach((id, i) => {
      if (SHOP_ITEMS[id]?.cat !== it.cat) return;
      const v = itemValue(id);
      if (v < itemValue(itemId) && v < cheapest) {
        cheapest = v;
        replace = i;
      }
    });
    if (replace < 0) {
      world.error(pid, 'Inventory full');
      return false;
    }
  }
  const refund = replace >= 0 ? SHOP_ITEMS[items[replace]] : null;
  const mins = p.minerals + (refund ? refund.minerals : 0);
  const gas = p.gas + (refund ? refund.gas : 0);
  if (mins < it.minerals - 1e-9) {
    world.error(pid, 'Not enough minerals');
    return false;
  }
  if (gas < it.gas - 1e-9) {
    world.error(pid, 'Not enough gas');
    return false;
  }
  if (refund) world.emit({ e: 'sold', owner: pid, item: refund.id });
  p.minerals = mins - it.minerals;
  p.gas = gas - it.gas;
  if (replace >= 0) items[replace] = itemId;
  else items.push(itemId);
  const h = heroOf(world, p);
  if (h) recomputeLancer(world, h);
  world.emit({ e: 'bought', owner: pid, item: itemId });
  return true;
}

function sellItem(world, pid, slot) {
  const p = world.players[pid];
  const id = p.items[slot];
  if (!id) return false;
  if (!nearShop(world, p)) {
    world.error(pid, 'Move to the Shop to sell');
    return false;
  }
  const it = SHOP_ITEMS[id];
  p.items.splice(slot, 1);
  p.minerals += it.minerals;
  p.gas += it.gas;
  const h = heroOf(world, p);
  if (h) recomputeLancer(world, h);
  world.emit({ e: 'sold', owner: pid, item: id });
  return true;
}

// ================================================================== Market

function trade(world, pid, op, lots) {
  const p = world.players[pid];
  const sv = world.survival;
  if (!hasStructure(world, pid, 'market')) {
    world.error(pid, 'Needs a Market');
    return false;
  }
  const n = lots >= 10 ? 10 : 1;
  let done = 0;
  for (let i = 0; i < n; i++) {
    if (op === 'buy') {
      if (p.gas < sv.price - 1e-9) {
        if (!done) world.error(pid, 'Not enough gas');
        break;
      }
      p.gas -= sv.price;
      p.minerals += 10;
      sv.price += SURVIVAL.marketStep;
    } else {
      if (p.minerals < 10 - 1e-9) {
        if (!done) world.error(pid, 'Not enough minerals');
        break;
      }
      p.minerals -= 10;
      p.gas += Math.max(5, sv.price - SURVIVAL.marketSellSpread);
      sv.price = Math.max(SURVIVAL.marketMinPrice, sv.price - SURVIVAL.marketStep);
    }
    done++;
  }
  if (done) world.emit({ e: 'trade', owner: pid, op, lots: done, price: sv.price });
  return done > 0;
}

// ================================================================== commands

// An enemy entity the player can't see right now (fog / cloak).
function hiddenEnemy(world, pid, t) {
  return t.owner >= 0 && world.areEnemies(pid, t.owner) && !world.isVisibleTo(t, pid);
}

function ownBuilding(world, pid, id) {
  const b = world.byId.get(id);
  return b && !b.dead && b.kind === 'building' && b.owner === pid ? b : null;
}

function idList(c) {
  if (c.id !== undefined) return [c.id];
  return Array.isArray(c.ids) ? c.ids.slice(0, 200) : [];
}

export function survivalCommand(world, pid, c, units) {
  const p = world.players[pid];
  switch (c.type) {
    case 'build': {
      if (p.form !== 'shaper' || !p.alive) return true;
      const hero = units.find((u) => u.type === 'builder') || heroOf(world, p);
      if (!hero || hero.type !== 'builder') return true;
      const type = c.building;
      if (!isSurvivalStructure(type)) {
        world.error(pid, 'Unknown structure');
        return true;
      }
      const level = Math.floor(Number(c.level) || 1);
      const bx = Math.floor(Number(c.bx) || 0);
      const by = Math.floor(Number(c.by) || 0);
      const chk = canPlaceSurvival(world, pid, type, bx, by, level);
      if (!chk.ok && chk.reason !== 'Something is in the way') {
        world.error(pid, chk.reason, bx, by);
        return true;
      }
      if (!c.queue) {
        clearOrders(world, hero);
        hero.swing = null;
      }
      hero.orders.push({ type: 'build', building: type, bx, by, level });
      return true;
    }
    case 'upgrade': {
      for (const id of idList(c)) {
        const b = ownBuilding(world, pid, id);
        if (b) startUpgrade(world, pid, b);
      }
      return true;
    }
    case 'salvage': {
      for (const id of idList(c)) {
        const b = ownBuilding(world, pid, id);
        if (b) startSalvage(world, pid, b);
      }
      return true;
    }
    case 'cancel': {
      const b = ownBuilding(world, pid, c.id ?? c.building);
      if (!b) return true;
      if (!b.built) cancelConstruction(world, b);
      else if (b.salvaging > 0) stopSalvage(b);
      else if (b.upgrading > 0) {
        const cost = b.upgradeCost || { gas: 0, minerals: 0 };
        p.gas += cost.gas;
        p.minerals += cost.minerals;
        b.invested.gas -= cost.gas;
        b.invested.minerals -= cost.minerals;
        b.upgrading = 0;
        b.upgradeTotal = 0;
        b.upgradeTo = 0;
        b.upgradeCost = null;
      } else if (b.queue.length) {
        const i = typeof c.index === 'number' && c.index >= 0 && c.index < b.queue.length ? c.index : b.queue.length - 1;
        const q = b.queue.splice(i, 1)[0];
        p.gas += q.gas || 0;
        p.minerals += q.minerals || 0;
      }
      return true;
    }
    case 'ceaseFire': {
      for (const id of idList(c)) {
        const b = ownBuilding(world, pid, id);
        if (b && b.type === 'turret') b.ceaseFire = c.on === undefined ? !b.ceaseFire : !!c.on;
      }
      return true;
    }
    case 'trainMiner':
    case 'trainWarden': {
      const miner = c.type === 'trainMiner';
      const b = ownBuilding(world, pid, c.id ?? (Array.isArray(c.ids) ? c.ids[0] : 0));
      if (!b || b.type !== (miner ? 'depot' : 'library') || !b.built || b.salvaging > 0) return true;
      const tbl = miner ? MINER_TIERS : WARDEN_TIERS;
      const tier = Math.floor(Number(c.tier) || 1);
      const T0 = tbl[tier - 1];
      if (!T0) return true;
      if (miner && minerCount(world, pid) >= SURVIVAL.maxMiners) {
        world.error(pid, `Max ${SURVIVAL.maxMiners} miners`, b.x, b.y);
        return true;
      }
      if (b.queue.length >= SURVIVAL.depotQueue) {
        world.error(pid, 'Queue is full', b.x, b.y);
        return true;
      }
      if (p.gas < T0.gas - 1e-9) {
        world.error(pid, 'Not enough gas', b.x, b.y);
        return true;
      }
      if (p.minerals < (T0.minerals || 0) - 1e-9) {
        world.error(pid, 'Not enough minerals', b.x, b.y);
        return true;
      }
      p.gas -= T0.gas;
      p.minerals -= T0.minerals || 0;
      p.stats.spent += T0.gas + (T0.minerals || 0);
      b.queue.push({ kind: 'unit', id: miner ? 'miner' : 'warden', tier, progress: 0, time: T0.trainTime, started: true, gas: T0.gas, minerals: T0.minerals || 0 });
      return true;
    }
    case 'dismiss': {
      for (const id of Array.isArray(c.ids) ? c.ids : idList(c)) {
        const e = world.byId.get(id);
        if (!e || e.dead || e.owner !== pid) continue;
        if (e.type === 'miner' || e.type === 'autoMine' || e.type === 'warden') world.kill(e, null, true);
      }
      return true;
    }
    case 'trade':
      if (c.op === 'buy' || c.op === 'sell') trade(world, pid, c.op, Number(c.lots) || 1);
      return true;
    case 'ability':
      useAbility(world, pid, c);
      return true;
    case 'pickAbilities':
      if (p.form === 'shaper' && !p.abilities.length) {
        if (!pickAbilities(world, p, c.a)) world.error(pid, 'Pick one control and one mobility ability');
      }
      return true;
    case 'share': {
      if (p.form !== 'shaper' || !p.alive) return true;
      const to = world.players[c.to];
      if (!to || to === p || to.form !== 'shaper' || !to.alive || to.eliminated) {
        world.error(pid, 'Can only share with a living Shaper');
        return true;
      }
      const gas = Math.max(0, Math.min(p.gas, Number(c.gas) || 0));
      const minerals = Math.max(0, Math.min(p.minerals, Number(c.minerals) || 0));
      p.gas -= gas;
      p.minerals -= minerals;
      to.gas += gas;
      to.minerals += minerals;
      if (gas || minerals) world.emit({ e: 'share', owner: to.id, from: pid, gas, minerals });
      return true;
    }
    case 'chooseForm': {
      if (p.pendingForm < 0) return true;
      if (c.form === 'hunter' && world.survival.unlocked) becomeHunter(world, p);
      else becomeSpirit(world, p);
      return true;
    }
    case 'buy':
      if (p.form === 'lancer' || p.form === 'hunter') buyItem(world, pid, c.item);
      return true;
    case 'sell':
      if (p.form === 'lancer' || p.form === 'hunter') sellItem(world, pid, Math.floor(Number(c.slot)));
      return true;
    case 'exchange': {
      if (p.form !== 'lancer' && p.form !== 'hunter') return true;
      const n = Number(c.n) >= 10 ? 10 : 1;
      const cost = n * SURVIVAL.gasExchangeRate;
      if (p.minerals < cost - 1e-9) {
        world.error(pid, 'Not enough minerals');
        return true;
      }
      p.minerals -= cost;
      p.gas += n;
      world.emit({ e: 'exchange', owner: pid, n });
      return true;
    }
    case 'gather': {
      const t = world.byId.get(c.target);
      if (!t || t.dead || hiddenEnemy(world, pid, t) || !Number.isFinite(t.x) || !Number.isFinite(t.y)) return true;
      for (const u of units) {
        if (u.type === 'miner' && t.type === 'crystal') {
          if (!assignMiner(world, u, t)) world.error(pid, 'No free mineral field');
        } else {
          clearOrders(world, u);
          u.orders.push({ type: 'move', x: t.x, y: t.y });
        }
      }
      return true;
    }
    case 'follow': {
      // entity ids are public (every snapshot lists the heroes' ids): never chase an enemy you can't see
      const t = world.byId.get(c.target);
      return !!t && hiddenEnemy(world, pid, t);
    }
    // classic-only commands are ignored in survival
    case 'train':
    case 'research':
    case 'warp':
    case 'overclock':
    case 'returnCargo':
      return true;
    default:
      return false;
  }
}

export { BUILDINGS };
