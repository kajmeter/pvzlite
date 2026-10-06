// Structures: placement, construction, production queues, research, energy and special abilities.
import {
  DT,
  QUEUE_LIMIT,
  OVERCLOCK_COST,
  OVERCLOCK_DURATION,
  OVERCLOCK_FACTOR,
  ENERGY_REGEN,
  AEGIS_RANGE,
  AEGIS_RATE,
  AEGIS_ENERGY_PER_BARRIER,
  WARP_FAST,
  WARP_SLOW,
  PORTAL_TRANSFORM_TIME,
  RESOURCE_EXCLUSION,
} from '../constants.js';
import { UNITS, BUILDINGS, RESEARCH } from '../data/defs.js';
import { rectDist, pointEdgeDist } from './geom.js';

// ---------------------------------------------------------------- placement

export function canPlace(world, owner, type, bx, by, builder = null) {
  const def = BUILDINGS[type];
  if (!def) return { ok: false, reason: 'Unknown structure' };
  const p = world.players[owner];
  for (const req of def.requires) {
    if (!world.hasCompleted(owner, req)) return { ok: false, reason: `Requires ${BUILDINGS[req].name}` };
  }
  const s = def.size;
  const g = world.grid;
  if (def.onVent) {
    const vent = world.resources.find((r) => r.type === 'vent' && r.bx === bx && r.by === by && !r.dead);
    if (!vent) return { ok: false, reason: 'Must be placed on a flux vent' };
    if (vent.siphon) return { ok: false, reason: 'Vent already has a Siphon' };
    if (!world.isExplored(owner, vent.x, vent.y)) return { ok: false, reason: 'Location not explored' };
    return { ok: true, vent };
  }
  for (let y = by; y < by + s; y++) {
    for (let x = bx; x < bx + s; x++) {
      if (!g.buildable(x, y)) return { ok: false, reason: "Can't build there" };
    }
  }
  if (!world.isExplored(owner, bx + s / 2, by + s / 2)) return { ok: false, reason: 'Location not explored' };
  // predefined expansion spots are always legal; elsewhere keep distance from resources
  const isBaseSpot = type === 'citadel' && world.map.bases.some((m) => m.tx === bx && m.ty === by);
  if (type === 'citadel' && !isBaseSpot) {
    for (const r of world.resources) {
      if (r.dead) continue;
      if (rectDist(bx, by, s, s, r.bx, r.by, r.w, r.h) < RESOURCE_EXCLUSION) {
        return { ok: false, reason: 'Too close to resources' };
      }
    }
  }
  if (def.needsPower && !world.isPoweredAt(owner, bx + s / 2, by + s / 2)) {
    return { ok: false, reason: 'Must be placed in a power field' };
  }
  // enemy units blocking the footprint
  const near = world.hash.query(bx + s / 2, by + s / 2, s, world._q);
  for (const u of near) {
    if (u.dead || u.hidden || u === builder) continue;
    if (u.x + u.r > bx && u.x - u.r < bx + s && u.y + u.r > by && u.y - u.r < by + s) {
      if (u.owner !== owner) return { ok: false, reason: 'Something is in the way' };
    }
  }
  void p;
  return { ok: true };
}

// Creates a structure under construction. Called when the builder reaches the site.
export function placeBuilding(world, owner, type, bx, by, builder = null) {
  const def = BUILDINGS[type];
  const p = world.players[owner];
  const check = canPlace(world, owner, type, bx, by, builder);
  if (!check.ok) {
    world.error(owner, check.reason, bx + def.size / 2, by + def.size / 2);
    return check;
  }
  if (p.crystals < def.cost.crystals) {
    world.error(owner, 'Not enough crystals', bx, by);
    return { ok: false, reason: 'Not enough crystals' };
  }
  if (p.flux < def.cost.flux) {
    world.error(owner, 'Not enough flux', bx, by);
    return { ok: false, reason: 'Not enough flux' };
  }
  p.crystals -= def.cost.crystals;
  p.flux -= def.cost.flux;
  p.stats.spent += def.cost.crystals + def.cost.flux;
  const b = world.createBuilding(type, owner, bx, by, false);
  if (check.vent) {
    check.vent.siphon = b.id;
    b.vent = check.vent;
  }
  // push own units out of the footprint
  const s = def.size;
  const near = world.hash.query(bx + s / 2, by + s / 2, s + 1, world._q);
  for (const u of near) {
    if (u.dead || u.hidden) continue;
    if (u.x + u.r > bx && u.x - u.r < bx + s && u.y + u.r > by && u.y - u.r < by + s) {
      const cx = bx + s / 2;
      const cy = by + s / 2;
      let dx = u.x - cx;
      let dy = u.y - cy;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      const out = s / 2 + u.r + 0.2;
      u.x = cx + dx * out * 1.42;
      u.y = cy + dy * out * 1.42;
      u.nav = null;
    }
  }
  world.emit({ e: 'buildStart', id: b.id, owner, type });
  return { ok: true, building: b };
}

// ---------------------------------------------------------------- production

export function queueTrain(world, b, unitType) {
  const p = world.players[b.owner];
  const def = UNITS[unitType];
  if (!b.built || b.dead) return false;
  if (!b.def.trains.includes(unitType)) return false;
  if (b.phase) return false; // phase portals warp instead
  if (b.queue.length >= QUEUE_LIMIT) {
    world.error(b.owner, 'Queue is full', b.x, b.y);
    return false;
  }
  if (p.crystals < def.cost.crystals) {
    world.error(b.owner, 'Not enough crystals', b.x, b.y);
    return false;
  }
  if (p.flux < def.cost.flux) {
    world.error(b.owner, 'Not enough flux', b.x, b.y);
    return false;
  }
  p.crystals -= def.cost.crystals;
  p.flux -= def.cost.flux;
  p.stats.spent += def.cost.crystals + def.cost.flux;
  b.queue.push({ kind: 'unit', id: unitType, progress: 0, time: def.buildTime, started: false });
  return true;
}

export function researchStatus(world, owner, researchId) {
  const r = RESEARCH[researchId];
  const p = world.players[owner];
  const level = p.upgrades[researchId] || 0;
  const pending = p.researching[researchId] ? 1 : 0;
  const next = level + pending;
  if (next >= r.levels.length) return { ok: false, reason: 'Fully researched', level, maxed: true };
  const L = r.levels[next];
  for (const req of L.requires) {
    if (!world.hasCompleted(owner, req)) return { ok: false, reason: `Requires ${BUILDINGS[req].name}`, level, next, L };
  }
  if (pending) return { ok: false, reason: 'Already researching', level, next, L };
  return { ok: true, level, next, L };
}

export function queueResearch(world, b, researchId) {
  const p = world.players[b.owner];
  const r = RESEARCH[researchId];
  if (!r || !b.built || b.dead || r.at !== b.type) return false;
  if (b.queue.length >= QUEUE_LIMIT) return false;
  const st = researchStatus(world, b.owner, researchId);
  if (!st.ok) {
    world.error(b.owner, st.reason, b.x, b.y);
    return false;
  }
  if (p.crystals < st.L.cost.crystals) {
    world.error(b.owner, 'Not enough crystals', b.x, b.y);
    return false;
  }
  if (p.flux < st.L.cost.flux) {
    world.error(b.owner, 'Not enough flux', b.x, b.y);
    return false;
  }
  p.crystals -= st.L.cost.crystals;
  p.flux -= st.L.cost.flux;
  p.stats.spent += st.L.cost.crystals + st.L.cost.flux;
  p.researching[researchId] = true;
  b.queue.push({ kind: 'research', id: researchId, level: st.next + 1, progress: 0, time: st.L.time, started: true });
  return true;
}

export function cancelQueue(world, b, index = -1) {
  if (!b.queue.length) return false;
  const i = index < 0 || index >= b.queue.length ? b.queue.length - 1 : index;
  const item = b.queue[i];
  const p = world.players[b.owner];
  if (item.kind === 'unit') {
    const def = UNITS[item.id];
    p.crystals += def.cost.crystals;
    p.flux += def.cost.flux;
    p.stats.spent -= def.cost.crystals + def.cost.flux;
    if (item.started) p.supplyUsed -= def.supply;
  } else {
    const L = RESEARCH[item.id].levels[item.level - 1];
    p.crystals += L.cost.crystals;
    p.flux += L.cost.flux;
    p.stats.spent -= L.cost.crystals + L.cost.flux;
    delete p.researching[item.id];
  }
  b.queue.splice(i, 1);
  return true;
}

export function cancelConstruction(world, b) {
  if (b.built || b.dead) return false;
  const p = world.players[b.owner];
  p.crystals += Math.floor(b.def.cost.crystals * 0.75);
  p.flux += Math.floor(b.def.cost.flux * 0.75);
  world.kill(b, null, true);
  return true;
}

// ---------------------------------------------------------------- abilities

export function overclock(world, owner, targetId, sourceId) {
  const t = world.byId.get(targetId);
  if (!t || t.dead || t.kind !== 'building' || t.owner !== owner || !t.built) {
    world.error(owner, 'Must target a completed friendly structure');
    return false;
  }
  let src = sourceId ? world.byId.get(sourceId) : null;
  if (!src || src.type !== 'citadel' || src.owner !== owner || !src.built || src.energy < OVERCLOCK_COST) {
    src = null;
    for (const b of world.buildings) {
      if (b.owner === owner && b.type === 'citadel' && b.built && b.energy >= OVERCLOCK_COST) {
        if (!src || b.energy > src.energy) src = b;
      }
    }
  }
  if (!src) {
    world.error(owner, 'Not enough energy');
    return false;
  }
  if (t.overclock > 0) {
    world.error(owner, 'Already overclocked');
    return false;
  }
  src.energy -= OVERCLOCK_COST;
  t.overclock = OVERCLOCK_DURATION;
  world.emit({ e: 'overclock', id: t.id, src: src.id });
  return true;
}

// Phase Portal warp-in at a point inside a power field.
export function warpIn(world, owner, x, y, portalId) {
  const p = world.players[owner];
  const def = UNITS.lancer;
  let portal = portalId ? world.byId.get(portalId) : null;
  if (!portal || portal.owner !== owner || !portal.phase || portal.warpCd > 0 || !portal.powered) {
    portal = null;
    for (const b of world.buildings) {
      if (b.owner === owner && b.type === 'portal' && b.phase && b.warpCd <= 0 && b.powered && !b.dead) {
        portal = b;
        break;
      }
    }
  }
  if (!portal) {
    world.error(owner, 'No Phase Portal ready');
    return false;
  }
  const field = world.powerSourceAt(owner, x, y);
  if (!field) {
    world.error(owner, 'Must warp into a power field', x, y);
    return false;
  }
  if (!world.isVisibleTo({ x, y, kind: 'point' }, owner)) {
    world.error(owner, 'Location not visible', x, y);
    return false;
  }
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (!world.grid.pathable(cx, cy)) {
    world.error(owner, "Can't warp there", x, y);
    return false;
  }
  const near = world.hash.query(x, y, 1.2, world._q);
  for (const u of near) {
    if (!u.dead && !u.hidden && Math.hypot(u.x - x, u.y - y) < u.r + def.radius) {
      world.error(owner, "Can't warp there", x, y);
      return false;
    }
  }
  if (p.crystals < def.cost.crystals) {
    world.error(owner, 'Not enough crystals', x, y);
    return false;
  }
  if (p.supplyUsed + def.supply > p.supplyCap) {
    world.error(owner, 'Need more Conduits', x, y);
    return false;
  }
  p.crystals -= def.cost.crystals;
  p.stats.spent += def.cost.crystals;
  p.supplyUsed += def.supply;
  const fast = world.isFastWarp(owner, field);
  const u = world.createUnit('lancer', owner, x, y, { warping: fast ? WARP_FAST : WARP_SLOW, supplyCounted: true });
  u.warpTotal = u.warping;
  portal.warpCd = def.warpCooldown;
  p.stats.unitsMade++;
  world.emit({ e: 'warpStart', id: u.id, fast: fast ? 1 : 0 });
  return true;
}

// ---------------------------------------------------------------- per-tick update

export function updateBuilding(world, b) {
  const p = b.owner >= 0 ? world.players[b.owner] : null;
  if (!p) return;
  if (!b.built) {
    const rate = DT / b.def.buildTime;
    b.progress = Math.min(1, b.progress + rate);
    b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.9 * rate);
    b.barrier = Math.min(b.maxBarrier, b.barrier + b.maxBarrier * 0.9 * rate);
    if (b.progress >= 1) world.completeBuilding(b);
    return;
  }
  b.powered = !b.def.needsPower || world.isPoweredAt(b.owner, b.x, b.y);
  if (b.overclock > 0) b.overclock = Math.max(0, b.overclock - DT);
  if (b.maxEnergy) b.energy = Math.min(b.maxEnergy, b.energy + ENERGY_REGEN * DT);
  if (b.warpCd > 0 && b.powered) b.warpCd = Math.max(0, b.warpCd - DT * (b.overclock > 0 ? OVERCLOCK_FACTOR : 1));

  // Phase Portal transformation once Phase Transit is researched and queue is empty
  if (b.type === 'portal' && !b.phase && p.upgrades.phaseTransit && b.queue.length === 0) {
    b.transform = (b.transform || 0) + DT;
    if (b.transform >= PORTAL_TRANSFORM_TIME) {
      b.phase = true;
      b.warpCd = 0;
      world.emit({ e: 'phase', id: b.id });
    }
  }

  if (b.type === 'aegis') updateAegis(world, b);

  if (!b.queue.length || !b.powered) return;
  const item = b.queue[0];
  if (item.kind === 'unit' && !item.started) {
    const def = UNITS[item.id];
    if (p.supplyUsed + def.supply > p.supplyCap) {
      if (!b.supplyBlocked) world.error(b.owner, 'Need more Conduits', b.x, b.y);
      b.supplyBlocked = true;
      return;
    }
    b.supplyBlocked = false;
    p.supplyUsed += def.supply;
    item.started = true;
  }
  item.progress += DT * (b.overclock > 0 ? OVERCLOCK_FACTOR : 1);
  if (item.progress >= item.time) {
    b.queue.shift();
    if (item.kind === 'unit') {
      world.spawnFromBuilding(b, item.id);
    } else {
      p.upgrades[item.id] = item.level;
      delete p.researching[item.id];
      world.emit({ e: 'research', owner: b.owner, id: item.id, level: item.level });
    }
  }
}

function updateAegis(world, b) {
  if (b.energy <= 0.5) {
    b.beam = 0;
    return;
  }
  let target = b.beam ? world.byId.get(b.beam) : null;
  const valid = (t) =>
    t &&
    !t.dead &&
    t.owner === b.owner &&
    t !== b &&
    !t.hidden &&
    !t.warping &&
    t.barrier < t.maxBarrier &&
    t.hp > 0 &&
    pointEdgeDist(b.x, b.y, t) - b.w / 2 <= AEGIS_RANGE;
  if (!valid(target) || (world.tick % 10 === 0 && target)) {
    // pick: recently damaged allies first, lowest barrier ratio
    let best = null;
    let bestScore = -Infinity;
    const near = world.hash.query(b.x, b.y, AEGIS_RANGE + 2, world._q);
    const cands = near.concat(world.buildings.filter((s) => Math.hypot(s.x - b.x, s.y - b.y) < AEGIS_RANGE + 4));
    for (const t of cands) {
      if (!valid(t)) continue;
      if (world.tick - t.lastDamageTick > 200 && t.kind === 'unit') continue;
      const ratio = t.barrier / t.maxBarrier;
      const score = (1 - ratio) * 10 + (world.tick - t.lastDamageTick < 60 ? 5 : 0) + (t.kind === 'unit' ? 3 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    target = best;
  }
  if (!target) {
    b.beam = 0;
    return;
  }
  b.beam = target.id;
  const amount = Math.min(AEGIS_RATE * DT, target.maxBarrier - target.barrier, b.energy / AEGIS_ENERGY_PER_BARRIER);
  target.barrier += amount;
  b.energy -= amount * AEGIS_ENERGY_PER_BARRIER;
}
