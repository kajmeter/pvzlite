// Unit behaviours: orders, movement, collision, gathering, construction and engagement.
import {
  DT,
  MINE_TIME,
  SIPHON_TIME,
  DEPOSIT_TIME,
  CRYSTALS_PER_TRIP,
  FLUX_PER_TRIP,
} from '../constants.js';
import { edgeDist, angleLerp, closestPoint } from './geom.js';
import { startSwing, updateSwing, acquireTarget, canTarget, untouchable, STRIKE_EPS } from './combat.js';

const isWorker = (u) => u.def.role === 'worker' || u.def.role === 'builder';

const ARRIVE_EPS = 0.12;

// ---------------------------------------------------------------- movement

export function unitSpeed(world, u) {
  if (world.mode === 'survival') {
    // survival: hero speeds come from items / abilities (cloak and Swiftness: +50%)
    let s = u.speedOverride || u.def.speed;
    if (u.cloakUntil > world.tick) s *= 1.5;
    if (u.swift) s *= 1.5;
    return s;
  }
  if (u.lunging > 0) return u.def.lunge.speed;
  if (u.speedOverride) return u.speedOverride * (u.sprintUntil > world.tick ? 1.6 : 1);
  const p = world.players[u.owner];
  if (u.type === 'lancer' && p && p.upgrades.lunge) return u.def.lungeSpeed;
  return u.def.speed;
}

function rectOf(t) {
  return { x: t.bx, y: t.by, w: t.w, h: t.h };
}

function needsRepath(world, u, nav) {
  if (!nav.path) return true;
  return false;
}

/**
 * Steps unit toward a destination. `goal` is {x,y} or an entity (rect/unit).
 * Returns 'arrived' | 'moving' | 'failed'.
 */
export function moveTo(world, u, gx, gy, opts = {}) {
  const grid = world.grid;
  const tol = opts.tolerance ?? ARRIVE_EPS;
  const target = opts.target || null;
  const speed = opts.speed ?? unitSpeed(world, u);
  const big = u.def.clearance === 2;
  const survival = world.mode === 'survival';
  // arrival test
  if (target) {
    if (edgeDist(u, target) <= tol) return 'arrived';
  } else if (Math.hypot(gx - u.x, gy - u.y) <= tol) {
    return 'arrived';
  }

  let nav = u.nav;
  const key = target ? `e${target.id}` : `p${Math.round(gx * 4)},${Math.round(gy * 4)}`;
  if (!nav || nav.key !== key) {
    // allow small goal drift for moving unit targets without repathing every tick
    if (nav && target && target.kind === 'unit' && nav.targetId === target.id) {
      // (survival: unless the path ran out and asked for a fresh one)
      if (Math.hypot(nav.gx - target.x, nav.gy - target.y) < 1.5 && !(survival && nav.forceRepath)) nav.key = key;
    }
  }
  if (!nav || nav.key !== key || nav.version !== grid.version || needsRepath(world, u, nav)) {
    const desiredKeyChanged = !nav || nav.key !== key;
    if (desiredKeyChanged || !nav.path || nav.forceRepath || nav.version !== grid.version) {
      if (world.pathBudget > 0) {
        world.pathBudget--;
        let path;
        let direct = false;
        const tx = target ? target.x : gx;
        const ty = target ? target.y : gy;
        // direct line shortcut (2-cell units: only to a point where they fit)
        if (!target || target.kind === 'unit') {
          if (directOk(grid, u, tx, ty, big)) {
            path = [[tx, ty]];
            direct = true;
          }
        }
        if (!path) {
          path = grid.findPath(u.x, u.y, tx, ty, {
            rect: target && target.kind !== 'unit' ? rectOf(target) : null,
            radius: u.r,
            pad: 1,
            clearance: u.def.clearance,
          });
        }
        if (!path) path = [[tx, ty]];
        // a 2-cell unit can't stand on a point hugging a cliff or wall (pushOutOfBlocked would put it
        // back every tick): end on the nearest free 2x2 block instead
        if (big && (!target || target.kind === 'unit') && path.length) {
          const last = path[path.length - 1];
          if (blockedOverlap(grid, last[0], last[1], u.r) > 0.05) {
            const nb = grid.nearestFreeBlock(last[0], last[1], 3);
            if (nb) path[path.length - 1] = [nb[0] + 1, nb[1] + 1];
          }
        }
        // for structures: final point = closest point on footprint edge outside it
        // (not for partial paths of big units: they stop at the closest reachable spot)
        if (target && target.kind !== 'unit' && path.length && !path.partial) {
          const last = path[path.length - 1];
          const [cx, cy] = closestPoint(target, last[0], last[1]);
          const dx = last[0] - cx;
          const dy = last[1] - cy;
          const d = Math.hypot(dx, dy) || 1;
          path[path.length - 1] = [cx + (dx / d) * (u.r + 0.05), cy + (dy / d) * (u.r + 0.05)];
        }
        nav = u.nav = {
          key,
          gx: tx,
          gy: ty,
          targetId: target ? target.id : -1,
          path,
          idx: 0,
          version: grid.version,
          checkTick: world.tick,
          bestDist: Infinity,
          stuck: 0,
          forceRepath: false,
          partial: !!path.partial,
          made: world.tick,
          direct,
        };
      } else {
        // out of budget this tick: move straight toward goal
        const tx = target ? target.x : gx;
        const ty = target ? target.y : gy;
        stepToward(world, u, tx, ty, speed * DT);
        return 'moving';
      }
    }
  }

  // survival: chasing a unit in a straight line, aim at where it is now rather than where it was
  // when the path was made, so a faster chaser really closes in on a fleeing unit
  if (survival && target && target.kind === 'unit' && nav.direct && nav.idx === 0 && directOk(grid, u, target.x, target.y, big)) {
    nav.path[0] = [target.x, target.y];
    nav.gx = target.x;
    nav.gy = target.y;
  }

  // follow path
  let step = speed * DT;
  let guard = 0;
  while (step > 1e-6 && nav.idx < nav.path.length && guard++ < 8) {
    const wp = nav.path[nav.idx];
    const dx = wp[0] - u.x;
    const dy = wp[1] - u.y;
    const d = Math.hypot(dx, dy);
    if (d <= step) {
      u.x = wp[0];
      u.y = wp[1];
      step -= d;
      nav.idx++;
      if (d > 1e-4) u.targetFacing = Math.atan2(dy, dx);
    } else {
      u.x += (dx / d) * step;
      u.y += (dy / d) * step;
      u.targetFacing = Math.atan2(dy, dx);
      step = 0;
    }
  }
  u.moving = true;

  if (nav.idx >= nav.path.length) {
    // reached end of path but not within tolerance (e.g. moving target): repath next time
    if (target) {
      if (edgeDist(u, target) <= tol + 0.05) return 'arrived';
      if (target.kind === 'unit') {
        // survival: an unreachable unit (e.g. a Shaper behind a 1-cell gap) is re-checked once per second
        if (nav.partial && world.mode === 'survival' && world.tick - nav.made < 20) return 'moving';
        stepToward(world, u, target.x, target.y, 0);
        nav.forceRepath = true;
        nav.key = '';
        return 'moving';
      }
      return opts.failOk ? 'failed' : 'arrived';
    }
    if (Math.hypot(gx - u.x, gy - u.y) <= Math.max(tol, 0.6)) return 'arrived';
    // goal unreachable (path ended at closest point)
    return 'failed';
  }

  // stuck detection every 0.5s
  if (world.tick - nav.checkTick >= 10) {
    nav.checkTick = world.tick;
    const tx = target ? target.x : gx;
    const ty = target ? target.y : gy;
    const d = Math.hypot(tx - u.x, ty - u.y);
    if (d > nav.bestDist - 0.25) {
      nav.stuck++;
      if (nav.stuck === 3 || nav.stuck === 6) {
        nav.forceRepath = true;
        nav.key = '';
      }
      if (nav.stuck >= 10) return 'failed';
    } else {
      nav.stuck = 0;
    }
    nav.bestDist = Math.min(nav.bestDist, d);
    // validate next segment against newly placed structures
    const wp = nav.path[nav.idx];
    if (wp && !world.grid.lineWalkable(u.x, u.y, wp[0], wp[1])) {
      nav.forceRepath = true;
      nav.key = '';
    }
  }
  return 'moving';
}

// A straight walk from u to (x, y) is clear (2-cell units must also fit at the end point).
function directOk(grid, u, x, y, big) {
  return grid.lineWalkableFat(u.x, u.y, x, y, u.r) && (!big || blockedOverlap(grid, x, y, u.r) <= 0.05);
}

function stepToward(world, u, tx, ty, step) {
  const dx = tx - u.x;
  const dy = ty - u.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return;
  if (d > 1e-4) u.targetFacing = Math.atan2(dy, dx);
  const s = Math.min(step, d);
  u.x += (dx / d) * s;
  u.y += (dy / d) * s;
  if (s > 0) u.moving = true;
}

export function stopMoving(u) {
  u.nav = null;
}

// ---------------------------------------------------------------- orders

export function endOrder(world, u) {
  const o = u.orders.shift();
  if (o) releaseOrder(world, u, o);
  u.nav = null;
  u.target = null;
  u.lunging = 0;
}

export function releaseOrder(world, u, o) {
  if (o.type === 'gather') {
    const res = world.byId.get(o.target);
    if (res) {
      if (res.miner === u.id) res.miner = 0;
      if (res.occupant === u.id) res.occupant = 0;
    }
    if (u.hidden) unhideFromSiphon(world, u, res);
  }
}

export function clearOrders(world, u) {
  for (const o of u.orders) releaseOrder(world, u, o);
  u.orders.length = 0;
  u.nav = null;
  u.target = null;
  u.lunging = 0;
}

function unhideFromSiphon(world, u, siphon) {
  u.hidden = false;
  if (siphon) {
    // pop out on the side facing the closest dropoff
    const drop = world.findDropoff(u.owner, siphon.x, siphon.y);
    let ax = siphon.x;
    let ay = siphon.y + 2;
    if (drop) {
      const dx = drop.x - siphon.x;
      const dy = drop.y - siphon.y;
      const d = Math.hypot(dx, dy) || 1;
      ax = siphon.x + (dx / d) * (siphon.w / 2 + u.r + 0.1);
      ay = siphon.y + (dy / d) * (siphon.h / 2 + u.r + 0.1);
    }
    u.x = ax;
    u.y = ay;
    u.px = ax;
    u.py = ay;
  }
}

// ---------------------------------------------------------------- per-tick unit update

export function updateUnit(world, u) {
  u.moving = false;
  u.ghost = false;
  u.engaged = 0;
  if (u.strikeCooldown) {
    // survival heroes: the cooldown may end up to one tick below zero; startSwing carries that
    // overshoot into the next strike (exact strike rate). It is dropped if no strike follows.
    u.cooldown = u.cooldown > STRIKE_EPS ? u.cooldown - DT : 0;
  } else if (u.cooldown > 0) u.cooldown = Math.max(0, u.cooldown - DT);
  if (u.lungeCd > 0) u.lungeCd = Math.max(0, u.lungeCd - DT);
  if (u.lunging > 0) u.lunging = Math.max(0, u.lunging - DT);
  if (u.warping > 0) {
    u.warping = Math.max(0, u.warping - DT);
    if (u.warping === 0) world.emit({ e: 'warped', id: u.id });
    return;
  }
  if (u.caged) {
    u.nav = null;
    return;
  }
  if (u.stasisUntil > world.tick) {
    // survival Stasis Prison: frozen, no orders processed
    u.nav = null;
    u.swing = null;
    u.frozen = true;
    return;
  }
  u.frozen = false;
  updateSwing(world, u, DT);

  const o = u.orders[0];
  if (!o) {
    idle(world, u);
  } else {
    switch (o.type) {
      case 'move':
        orderMove(world, u, o);
        break;
      case 'follow':
        orderFollow(world, u, o);
        break;
      case 'attackMove':
      case 'patrol':
        orderAttackMove(world, u, o);
        break;
      case 'attack':
        orderAttack(world, u, o);
        break;
      case 'hold':
        orderHold(world, u);
        break;
      case 'gather':
        orderGather(world, u, o);
        break;
      case 'returnCargo':
        orderReturn(world, u, o);
        break;
      case 'build':
        orderBuild(world, u, o);
        break;
      case 'mine':
        orderMine(world, u, o);
        break;
      default:
        endOrder(world, u);
    }
  }
  // smooth facing
  if (u.targetFacing !== undefined) {
    u.facing = angleLerp(u.facing, u.targetFacing, u.def.turnRate * DT);
  }
}

function idle(world, u) {
  if (isWorker(u)) return;
  if (!u.def.weapon) {
    // survival miners go back to work on their own
    if (u.def.role === 'miner' && (world.tick + u.id) % 10 === 0) world.assignMiner(u);
    return;
  }
  if (!u.guard) u.guard = { x: u.x, y: u.y };
  // auto-acquire
  if (u.target) {
    const t = world.byId.get(u.target);
    const leash = Math.hypot(u.x - u.guard.x, u.y - u.guard.y);
    if (!t || !canTarget(world, u, t) || untouchable(world, t) || gaveUpOn(world, u, t) || (leash > 10 && edgeDist(u, t) > 1)) {
      u.target = null;
      u.nav = null;
    } else {
      engage(world, u, t, true);
      return;
    }
  }
  if ((world.tick + u.id) % 4 === 0) {
    const t = acquireTarget(world, u, u.def.sight - 1.5);
    if (t) {
      u.target = t.id;
      engage(world, u, t, true);
      return;
    }
  }
  // drift back to guard position after a chase
  const gd = Math.hypot(u.x - u.guard.x, u.y - u.guard.y);
  if (gd > 3) {
    if (moveTo(world, u, u.guard.x, u.guard.y, { tolerance: 0.5 }) !== 'moving') u.guard = { x: u.x, y: u.y };
  }
}

function orderMove(world, u, o) {
  u.guard = null;
  const r = moveTo(world, u, o.x, o.y, { tolerance: ARRIVE_EPS });
  if (r === 'moving') {
    // group arrival: stop when touching a group-mate that already arrived near the goal
    const dg = Math.hypot(o.x - u.x, o.y - u.y);
    if (o.group && dg < 1.2 + Math.sqrt(o.groupSize || 1) * 0.55) {
      const near = world.hash.query(u.x, u.y, 1.4, world._q);
      for (const v of near) {
        if (v !== u && v.arrivedGroup === o.group && Math.hypot(v.x - u.x, v.y - u.y) < u.r + v.r + 0.15) {
          u.arrivedGroup = o.group;
          endOrder(world, u);
          return;
        }
      }
    }
    return;
  }
  u.arrivedGroup = o.group || 0;
  endOrder(world, u);
}

function orderFollow(world, u, o) {
  const t = world.byId.get(o.target);
  // survival: stop following an enemy that slipped into the fog or cloaked
  const lost = t && world.mode === 'survival' && t.owner >= 0 && world.areEnemies(u.owner, t.owner) && !world.isVisibleTo(t, u.owner);
  if (!t || t.dead || lost) {
    endOrder(world, u);
    return;
  }
  if (edgeDist(u, t) > 1.2) moveTo(world, u, t.x, t.y, { target: t, tolerance: 1 });
}

function orderAttack(world, u, o) {
  u.guard = null;
  const t = world.byId.get(o.target);
  if (!u.def.weapon) {
    // unarmed survival units just walk up to the target
    if (!t || t.dead || moveTo(world, u, t.x, t.y, { target: t, tolerance: 1, failOk: true }) !== 'moving') endOrder(world, u);
    return;
  }
  if (t && !t.dead && t.kind !== 'unit' && t.hp !== undefined && !world.isVisibleTo(t, u.owner)) {
    // structure hidden in the fog: walk to it, then attack once it comes into view
    // (survival: only structures the team has seen before; ids alone must not reveal a base)
    if (world.mode === 'survival' && !world.seenByTeam(t, u.owner)) {
      endOrder(world, u);
      return;
    }
    if (moveTo(world, u, t.x, t.y, { target: t, tolerance: u.def.weapon.range + 0.02, failOk: true }) === 'failed') endOrder(world, u);
    return;
  }
  if (!t || !canTarget(world, u, t, true) || gaveUpOn(world, u, t)) {
    endOrder(world, u);
    return;
  }
  u.target = t.id;
  engage(world, u, t, true);
}

function orderHold(world, u) {
  u.nav = null;
  if (isWorker(u) || !u.def.weapon) return;
  let t = u.target ? world.byId.get(u.target) : null;
  if (!t || !canTarget(world, u, t) || untouchable(world, t) || edgeDist(u, t) > u.def.weapon.range + 0.15) {
    t = acquireTarget(world, u, u.def.weapon.range + 0.15);
    u.target = t ? t.id : null;
  }
  if (t) engage(world, u, t, false);
}

function orderAttackMove(world, u, o) {
  u.guard = null;
  if (!u.def.weapon) {
    orderMove(world, u, o);
    return;
  }
  let t = u.target ? world.byId.get(u.target) : null;
  if (t && (!canTarget(world, u, t) || untouchable(world, t) || gaveUpOn(world, u, t))) {
    t = null;
    u.target = null;
    u.nav = null;
  }
  // re-evaluate target periodically (switch to closer threats)
  if ((world.tick + u.id) % 5 === 0) {
    const range = isWorker(u) ? 3 : u.def.sight - 1.5;
    const nt = acquireTarget(world, u, range);
    if (nt && (!t || (t.kind !== 'unit' && nt.kind === 'unit') || (edgeDist(u, nt) + 1.5 < edgeDist(u, t) && !u.swing))) {
      t = nt;
      u.target = nt.id;
    }
  }
  if (t) {
    engage(world, u, t, true);
    return;
  }
  const r = moveTo(world, u, o.x, o.y, { tolerance: 0.4 });
  if (r !== 'moving') {
    if (o.type === 'patrol') {
      const nx = o.x0;
      const ny = o.y0;
      o.x0 = o.x;
      o.y0 = o.y;
      o.x = nx;
      o.y = ny;
      u.nav = null;
    } else {
      u.arrivedGroup = o.group || 0;
      endOrder(world, u);
    }
  }
}

// survival: a structure this unit could not reach (no path, nothing in the way to hit) is left
// alone for a few seconds so auto-targeting picks something else.
const GIVE_UP_TICKS = 100;
function gaveUpOn(world, u, t) {
  return !!u.giveUp && u.giveUp.id === t.id && u.giveUp.until > world.tick;
}

// Chase and attack a target. allowMove=false for hold position.
export function engage(world, u, t, allowMove) {
  const w = u.def.weapon;
  const d = edgeDist(u, t);
  if (d <= w.range + 0.08) {
    u.nav = null;
    u.lunging = 0;
    u.engaged = t.id;
    const [cx, cy] = closestPoint(t, u.x, u.y);
    u.targetFacing = Math.atan2(cy - u.y, cx - u.x);
    startSwing(world, u, t);
    return;
  }
  if (!allowMove) return;
  // Lunge Drive dash
  const p = world.players[u.owner];
  const canLunge = u.type === 'hunter' || p.upgrades.lunge;
  const lungeRange = u.lungeRange ?? u.def.lunge?.range;
  if (u.def.lunge && canLunge && u.autocast.lunge !== false && u.lungeCd <= 0 && d <= lungeRange && d > 0.6) {
    u.lunging = u.def.lunge.maxDuration;
    u.lungeCd = u.lungeCooldown ?? u.def.lunge.cooldown;
    u.lungeHit = true;
    world.emit({ e: 'lunge', id: u.id, t: t.id });
  }
  moveTo(world, u, t.x, t.y, { target: t, tolerance: w.range + 0.02 });
  // survival: a 2-cell unit that cannot reach its target (walled in) hits what blocks it
  if (world.mode === 'survival' && u.nav && u.nav.partial && u.nav.idx >= u.nav.path.length) {
    let best = null;
    let bd = w.range + 0.3;
    for (const b of world.buildings) {
      if (b.dead || b.owner < 0 || !world.areEnemies(u.owner, b.owner) || untouchable(world, b)) continue;
      const db = edgeDist(u, b);
      if (db <= bd) {
        bd = db;
        best = b;
      }
    }
    if (best) {
      const [cx, cy] = closestPoint(best, u.x, u.y);
      u.targetFacing = Math.atan2(cy - u.y, cx - u.x);
      u.engaged = best.id;
      startSwing(world, u, best);
    } else if (t.kind !== 'unit') {
      // a structure out of reach (e.g. behind a cliff) with nothing to break through: give up on it
      u.giveUp = { id: t.id, until: world.tick + GIVE_UP_TICKS };
      u.target = null;
      u.nav = null;
    }
  }
}

// ---------------------------------------------------------------- gathering

function resourceKindOf(res) {
  return res.type === 'crystal' ? 'crystals' : 'flux';
}

export function orderGather(world, u, o) {
  u.guard = null;
  let res = world.byId.get(o.target);
  // retarget: siphon given via vent, or depleted field
  if (res && res.type === 'vent') {
    const s = res.siphon ? world.byId.get(res.siphon) : null;
    if (s && s.owner === u.owner) {
      o.target = s.id;
      res = s;
    }
  }
  if (!res || res.dead) {
    const next = o.kind === 'crystals' || !o.kind ? world.findNearbyCrystal(o.lastX ?? u.x, o.lastY ?? u.y, 10) : null;
    if (next) {
      o.target = next.id;
      res = next;
    } else {
      endOrder(world, u);
      if (u.carry && u.carry.amount > 0) u.orders.unshift({ type: 'returnCargo' });
      return;
    }
  }
  const isSiphon = res.type === 'siphon';
  if (isSiphon && (res.owner !== u.owner || !res.built || res.vent?.amount <= 0)) {
    if (res.owner !== u.owner || (res.vent && res.vent.amount <= 0)) {
      endOrder(world, u);
      return;
    }
  }
  o.kind = isSiphon ? 'flux' : 'crystals';
  o.lastX = res.x;
  o.lastY = res.y;
  if (!o.phase) o.phase = u.carry && u.carry.amount > 0 ? 'toDrop' : 'toRes';

  switch (o.phase) {
    case 'toDrop': {
      u.ghost = true;
      const drop = world.findDropoff(u.owner, u.x, u.y);
      if (!drop) {
        u.ghost = false;
        return; // wait idle-ish until a dropoff exists
      }
      const r = moveTo(world, u, drop.x, drop.y, { target: drop, tolerance: 0.2 });
      if (r !== 'moving') {
        o.phase = 'deposit';
        o.timer = DEPOSIT_TIME;
        u.nav = null;
      }
      break;
    }
    case 'deposit': {
      u.ghost = true;
      o.timer -= DT;
      if (o.timer <= 0) {
        world.deposit(u);
        o.phase = 'toRes';
      }
      break;
    }
    case 'toRes': {
      u.ghost = true;
      if (isSiphon && !res.built) {
        // siphon still constructing: wait next to it
        moveTo(world, u, res.x, res.y, { target: res, tolerance: 0.6 });
        return;
      }
      const r = moveTo(world, u, res.x, res.y, { target: res, tolerance: 0.2 });
      if (r === 'moving') return;
      u.nav = null;
      if (isSiphon) {
        if (res.occupant && res.occupant !== u.id && world.byId.get(res.occupant)) {
          o.phase = 'wait';
          return;
        }
        res.occupant = u.id;
        u.hidden = true;
        o.phase = 'mining';
        o.timer = SIPHON_TIME;
      } else {
        if (res.miner && res.miner !== u.id && world.byId.get(res.miner)) {
          // worker bouncing: try a free neighbour field
          const alt = world.findFreeCrystal(res, u, 5);
          if (alt) {
            o.target = alt.id;
            return;
          }
          o.phase = 'wait';
          return;
        }
        res.miner = u.id;
        o.phase = 'mining';
        o.timer = MINE_TIME;
      }
      break;
    }
    case 'wait': {
      u.ghost = true;
      if (isSiphon) {
        if (!res.occupant || !world.byId.get(res.occupant)) {
          res.occupant = u.id;
          u.hidden = true;
          o.phase = 'mining';
          o.timer = SIPHON_TIME;
        }
      } else if (!res.miner || !world.byId.get(res.miner)) {
        if (edgeDist(u, res) > 0.4) {
          o.phase = 'toRes';
          return;
        }
        res.miner = u.id;
        o.phase = 'mining';
        o.timer = MINE_TIME;
      } else if ((world.tick + u.id) % 10 === 0) {
        const alt = world.findFreeCrystal(res, u, 5);
        if (alt) {
          o.target = alt.id;
          o.phase = 'toRes';
        }
      }
      break;
    }
    case 'mining': {
      u.ghost = true;
      u.mining = res.id;
      const [cx, cy] = closestPoint(res, u.x, u.y);
      if (!isSiphon) u.targetFacing = Math.atan2(cy - u.y, cx - u.x);
      o.timer -= DT;
      if (o.timer <= 0) {
        const src = isSiphon ? res.vent : res;
        const per = isSiphon ? FLUX_PER_TRIP : CRYSTALS_PER_TRIP;
        const amt = Math.min(per, src ? src.amount : 0);
        if (src) {
          src.amount -= amt;
          if (src.amount <= 0 && src.type === 'crystal') world.kill(src, null);
        }
        u.carry = { kind: o.kind, amount: amt };
        u.mining = 0;
        if (isSiphon) {
          res.occupant = 0;
          unhideFromSiphon(world, u, res);
        } else if (res.miner === u.id) res.miner = 0;
        o.phase = 'toDrop';
        world.emit({ e: 'mined', id: u.id, k: o.kind });
      }
      break;
    }
    default:
      o.phase = 'toRes';
  }
}

function orderReturn(world, u) {
  if (!u.carry || u.carry.amount <= 0) {
    endOrder(world, u);
    return;
  }
  u.ghost = true;
  const drop = world.findDropoff(u.owner, u.x, u.y);
  if (!drop) {
    endOrder(world, u);
    return;
  }
  const r = moveTo(world, u, drop.x, drop.y, { target: drop, tolerance: 0.2 });
  if (r !== 'moving') {
    world.deposit(u);
    const lastRes = u.lastGather ? world.byId.get(u.lastGather) : null;
    endOrder(world, u);
    if (u.orders.length === 0 && lastRes && !lastRes.dead) {
      u.orders.push({ type: 'gather', target: lastRes.id });
    }
  }
}

// ---------------------------------------------------------------- construction

function orderBuild(world, u, o) {
  u.guard = null;
  const def = world.defs.BUILDINGS[o.building];
  const size = def.size;
  const site = { kind: 'site', bx: o.bx, by: o.by, w: size, h: size, x: o.bx + size / 2, y: o.by + size / 2, id: -1 };
  const d = edgeDist(u, site);
  if (d > 1.6) {
    const r = moveTo(world, u, site.x, site.y, { target: site, tolerance: 1.5, failOk: true });
    if (r === 'failed') {
      world.error(u.owner, "Can't reach build location", site.x, site.y);
      endOrder(world, u);
    }
    return;
  }
  u.nav = null;
  const res = world.placeBuilding(u.owner, o.building, o.bx, o.by, u, o.level);
  const resume = u.lastGather && world.byId.get(u.lastGather) && !world.byId.get(u.lastGather).dead ? u.lastGather : 0;
  endOrder(world, u);
  if (res.ok && u.orders.length === 0 && resume) {
    u.orders.push({ type: 'gather', target: resume });
  }
}

// ---------------------------------------------------------------- survival miners

// Walk to the assigned mineral field and gather forever (credit handled by the survival rules).
function orderMine(world, u, o) {
  u.guard = null;
  u.ghost = true; // miners never block each other or the Shapers
  const res = world.byId.get(o.target);
  if (!res || res.dead) {
    u.mining = 0;
    endOrder(world, u);
    return;
  }
  if (o.phase !== 'mining') {
    const r = moveTo(world, u, res.x, res.y, { target: res, tolerance: 0.35, failOk: true });
    // a field that got walled in: its path ends short of it (the miner would push at the walls
    // forever). Checked once per new path with a full search (A* may also stop at its node budget).
    let blocked = false;
    const nav = u.nav;
    if (nav && nav.path && nav.path.reached === false && !nav.reachChecked) {
      nav.reachChecked = true;
      blocked = !world.minerReaches(u, res);
    }
    if (r === 'moving' && !blocked) return;
    if ((r === 'failed' || blocked) && edgeDist(u, res) > 1.2) {
      u.mining = 0;
      world.minerAvoid(u, res); // pick another field (idle() re-assigns the miner)
      endOrder(world, u);
      return;
    }
    if (r === 'moving') return;
    u.nav = null;
    o.phase = 'mining';
    o.timer = 0;
  }
  u.mining = res.id;
  const [cx, cy] = closestPoint(res, u.x, u.y);
  u.targetFacing = Math.atan2(cy - u.y, cx - u.x);
  world.minerWork(u, res, o);
}

// ---------------------------------------------------------------- collisions

const _near = [];
export function resolveCollisions(world) {
  const units = world.units;
  const grid = world.grid;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.dead || u.hidden || u.ghost) continue;
      const near = world.hash.query(u.x, u.y, u.r + 0.6, _near);
      for (let k = 0; k < near.length; k++) {
        const v = near[k];
        if (v.id <= u.id || v.dead || v.hidden || v.ghost) continue;
        let dx = v.x - u.x;
        let dy = v.y - u.y;
        const min = u.r + v.r;
        let d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-4) {
          const a = world.rng.next() * Math.PI * 2;
          dx = Math.cos(a) * 0.01;
          dy = Math.sin(a) * 0.01;
          d = 0.01;
        }
        const overlap = min - d;
        const wu = mobility(u, v);
        const wv = mobility(v, u);
        const tot = wu + wv || 1;
        const nx = dx / d;
        const ny = dy / d;
        const pu = (overlap * wu) / tot;
        const pv = (overlap * wv) / tot;
        u.x -= nx * pu;
        u.y -= ny * pu;
        v.x += nx * pv;
        v.y += ny * pv;
      }
    }
  }
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.dead || u.hidden) continue;
    pushOutOfBlocked(grid, u);
  }
}

function mobility(u, other) {
  if (u.frozen) return 0.02;
  if (u.orders[0]?.type === 'hold') return 0.05;
  if (u.engaged) return 0.25;
  if (u.warping > 0) return 0.05;
  const idle = !u.moving;
  if (idle && other.owner === u.owner) return 3;
  return 1;
}

export function pushOutOfBlocked(grid, u) {
  const r = u.r;
  const cx = Math.floor(u.x);
  const cy = Math.floor(u.y);
  if (!grid.pathable(cx, cy)) {
    if (r >= 0.8) {
      // big (2-cell) units need a free 2x2 block
      const nb = grid.nearestFreeBlock(u.x, u.y, 12);
      if (nb) {
        u.x = nb[0] + 1;
        u.y = nb[1] + 1;
        u.nav = null;
        return;
      }
    }
    const nf = grid.nearestFree(u.x, u.y, 12);
    if (nf) {
      // move toward the nearest free cell center
      u.x = nf[0] + 0.5;
      u.y = nf[1] + 0.5;
      u.nav = null;
    }
    return;
  }
  const x0 = Math.floor(u.x - r);
  const x1 = Math.floor(u.x + r);
  const y0 = Math.floor(u.y - r);
  const y1 = Math.floor(u.y + r);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (grid.pathable(x, y)) continue;
      const px = Math.min(Math.max(u.x, x), x + 1);
      const py = Math.min(Math.max(u.y, y), y + 1);
      const dx = u.x - px;
      const dy = u.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r && d2 > 1e-9) {
        const d = Math.sqrt(d2);
        const push = r - d;
        u.x += (dx / d) * push;
        u.y += (dy / d) * push;
      }
    }
  }
  // Big units (Lancer, Hunters) must not squeeze through 1-cell gaps: if pushing could not
  // resolve the overlap, go back to where the unit was at the start of the tick.
  if (r >= 0.8 && blockedOverlap(grid, u.x, u.y, r) > 0.05) {
    if (u.px !== undefined && blockedOverlap(grid, u.px, u.py, r) <= 0.05) {
      u.x = u.px;
      u.y = u.py;
    } else {
      const nb = grid.nearestFreeBlock(u.x, u.y, 12);
      if (nb) {
        u.x = nb[0] + 1;
        u.y = nb[1] + 1;
      }
    }
    u.nav = null;
  }
}

// Deepest penetration of a circle into blocked cells.
export function blockedOverlap(grid, x, y, r) {
  let worst = 0;
  const x0 = Math.floor(x - r);
  const x1 = Math.floor(x + r);
  const y0 = Math.floor(y - r);
  const y1 = Math.floor(y + r);
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (grid.pathable(cx, cy)) continue;
      const px = Math.min(Math.max(x, cx), cx + 1);
      const py = Math.min(Math.max(y, cy), cy + 1);
      const d = Math.hypot(x - px, y - py);
      if (r - d > worst) worst = r - d;
    }
  }
  return worst;
}
