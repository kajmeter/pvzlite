// Fog of war: per-team visibility with high-ground rules and beacon towers.
import { BEACON_SIGHT } from '../constants.js';

const circleCache = new Map();

function circleOffsets(r) {
  const key = Math.round(r * 4);
  let c = circleCache.get(key);
  if (c) return c;
  const out = [];
  const R = Math.ceil(r);
  for (let oy = -R; oy <= R; oy++) {
    for (let ox = -R; ox <= R; ox++) {
      if (ox * ox + oy * oy <= r * r) out.push(ox, oy);
    }
  }
  c = Int16Array.from(out);
  circleCache.set(key, c);
  return c;
}

export function viewerLevel(map, x, y) {
  const cx = Math.min(map.width - 1, Math.max(0, Math.floor(x)));
  const cy = Math.min(map.height - 1, Math.max(0, Math.floor(y)));
  return map.level[cy * map.width + cx];
}

export function stamp(map, vis, explored, x, y, r, vl) {
  const W = map.width;
  const H = map.height;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const offs = circleOffsets(r);
  const level = map.level;
  for (let k = 0; k < offs.length; k += 2) {
    const nx = cx + offs[k];
    const ny = cy + offs[k + 1];
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const i = ny * W + nx;
    if (level[i] <= vl) {
      vis[i] = 1;
      explored[i] = 1;
    }
  }
}

export function updateVision(world) {
  const map = world.map;
  for (const t of world.teamIds) world.vision[t].fill(0);
  for (const u of world.units) {
    if (u.dead || u.owner < 0) continue;
    const team = world.players[u.owner].team;
    const vl = viewerLevel(map, u.x, u.y);
    stamp(map, world.vision[team], world.explored[team], u.x, u.y, u.hidden ? 2 : u.sight || u.def.sight, vl);
  }
  for (const b of world.buildings) {
    if (b.dead || b.owner < 0) continue;
    const team = world.players[b.owner].team;
    const vl = viewerLevel(map, b.x, b.y);
    // survival Lancer Detector sees over cliffs (it is a tall tower)
    stamp(map, world.vision[team], world.explored[team], b.x, b.y, b.built ? b.def.sight : 4, b.type === 'detector' && b.built ? 99 : vl);
  }
  // survival: active Scans reveal a circle (high ground included) for the scanning team
  if (world.mode === 'survival' && world.survival) {
    for (const sc of world.survival.scans) {
      if (sc.until <= world.tick || !world.vision[sc.team]) continue;
      stamp(map, world.vision[sc.team], world.explored[sc.team], sc.x, sc.y, sc.r, 99);
    }
  }
  for (const n of world.neutrals) {
    if (n.type !== 'beacon' || n.dead) continue;
    for (const team of n.holders) {
      stamp(map, world.vision[team], world.explored[team], n.x, n.y, BEACON_SIGHT, 99);
    }
  }
}
