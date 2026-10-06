// Network protocol shared by the server and the browser client.
// The server runs the authoritative World and streams compact per-player snapshots.
import { TICK_RATE } from '../constants.js';

export const PROTOCOL_VERSION = 1;
export const SNAPSHOT_EVERY = 2; // ticks between snapshots (10 Hz)
export const SNAPSHOT_INTERVAL = SNAPSHOT_EVERY / TICK_RATE;

const TYPES = ['shaper', 'lancer', 'citadel', 'conduit', 'siphon', 'portal', 'foundry', 'archive', 'sanctum', 'aegis', 'crystal', 'vent', 'beacon', 'rubble'];
export const TYPE_INDEX = Object.fromEntries(TYPES.map((t, i) => [t, i]));
export const TYPE_NAME = TYPES;

const r1 = (v) => Math.round(v * 100) / 100;

// Events worth forwarding to clients (only if the player can see them / owns them)
const PUBLIC_EVENTS = new Set(['strike', 'hit', 'death', 'lunge', 'warpStart', 'warped', 'eliminated', 'gameOver']);
const OWNER_EVENTS = new Set(['buildStart', 'buildDone', 'trained', 'research', 'error', 'alert', 'phase', 'overclock']);

function unitRow(u, own) {
  const row = [
    u.id,
    TYPE_INDEX[u.type],
    u.owner,
    r1(u.x),
    r1(u.y),
    r1(u.facing),
    Math.ceil(u.hp),
    Math.ceil(u.barrier),
    u.attackAnim,
    u.lunging > 0 ? 1 : 0,
    u.carry ? (u.carry.kind === 'flux' ? 2 : 1) : 0,
    u.mining || 0,
    u.hidden ? 1 : 0,
    u.warping > 0 ? r1(u.warping) : 0,
    u.warpTotal ? r1(u.warpTotal) : 0,
  ];
  if (own) row.push(u.orders.length === 0 ? 1 : 0, u.autocast?.lunge === false ? 0 : 1);
  return row;
}

function buildingRow(b, own) {
  const row = [
    b.id,
    TYPE_INDEX[b.type],
    b.owner,
    b.bx,
    b.by,
    Math.ceil(b.hp),
    Math.ceil(b.barrier),
    b.built ? 1 : 0,
    r1(b.progress),
    b.phase ? 1 : 0,
    b.powered ? 1 : 0,
    b.beam || 0,
    b.overclock > 0 ? r1(b.overclock) : 0,
  ];
  if (own) {
    row.push(
      Math.floor(b.energy * 10) / 10,
      r1(b.warpCd || 0),
      r1(b.transform || 0),
      b.queue.map((q) => [q.kind === 'unit' ? 0 : 1, q.id, r1(q.progress), q.time, q.level || 0]),
      b.rally ? [r1(b.rally.x), r1(b.rally.y), b.rally.target || 0] : 0,
      b.vent ? b.vent.amount : -1,
    );
  }
  return row;
}

/** Builds the snapshot a given player is allowed to see. */
export function makeSnapshot(world, playerId, events, full = false) {
  const p = world.players[playerId];
  const team = p ? p.team : -1;
  const vis = (e) => playerId < 0 || world.isVisibleTo(e, playerId);
  const units = [];
  for (const u of world.units) {
    if (u.dead) continue;
    const own = u.owner === playerId;
    if (own || world.isAllied(u.owner, playerId) || vis(u)) units.push(unitRow(u, own));
  }
  const buildings = [];
  for (const b of world.buildings) {
    if (b.dead) continue;
    const own = b.owner === playerId;
    if (own || world.isAllied(b.owner, playerId) || vis(b)) buildings.push(buildingRow(b, own));
  }
  // resources: amounts only where visible (positions are known from the map)
  const resources = [];
  for (const r of world.resources) {
    if (r.dead) continue;
    if (full || vis(r)) resources.push([r.id, r.amount, r.siphon || 0, r.miner || 0]);
  }
  const neutrals = [];
  for (const n of world.neutrals) {
    if (n.dead) continue;
    neutrals.push([n.id, n.hp !== undefined ? Math.ceil(n.hp) : 0, n.holders ? n.holders : []]);
  }
  const outEvents = [];
  for (const ev of events) {
    if (OWNER_EVENTS.has(ev.e)) {
      if (ev.owner === playerId || (ev.e === 'overclock' && world.byId.get(ev.id)?.owner === playerId) || (ev.e === 'phase' && world.byId.get(ev.id)?.owner === playerId)) outEvents.push(ev);
    } else if (PUBLIC_EVENTS.has(ev.e)) {
      if (ev.e === 'gameOver' || ev.e === 'eliminated') outEvents.push(ev);
      else if (ev.x !== undefined ? playerId < 0 || world.isVisibleTo({ kind: 'point', x: ev.x, y: ev.y }, playerId) || ev.owner === playerId : true) outEvents.push(ev);
    }
  }
  const players = world.players.map((pl) => ({
    id: pl.id,
    eliminated: pl.eliminated,
    // only reveal economy details for yourself
    ...(pl.id === playerId
      ? { crystals: Math.floor(pl.crystals), flux: Math.floor(pl.flux), supplyUsed: pl.supplyUsed, supplyCap: pl.supplyCap, upgrades: pl.upgrades, researching: pl.researching }
      : { upgrades: pl.upgrades }),
  }));
  // vision as run-length encoded bytes (visible / explored)
  let vision = null;
  if (p) vision = rle(world.vision[team], world.explored[team]);
  return {
    t: 'snap',
    tick: world.tick,
    units,
    buildings,
    resources,
    neutrals,
    players,
    events: outEvents,
    vision,
    over: world.over ? 1 : 0,
    winnerTeam: world.winnerTeam,
  };
}

// RLE of combined vision state: 0 unexplored, 1 explored, 2 visible
export function rle(vis, exp) {
  const out = [];
  let cur = -1;
  let n = 0;
  for (let i = 0; i < vis.length; i++) {
    const v = vis[i] ? 2 : exp[i] ? 1 : 0;
    if (v === cur) n++;
    else {
      if (n) out.push(cur, n);
      cur = v;
      n = 1;
    }
  }
  if (n) out.push(cur, n);
  return out;
}

export function unrle(data, vis, exp) {
  let i = 0;
  for (let k = 0; k < data.length; k += 2) {
    const v = data[k];
    const n = data[k + 1];
    for (let j = 0; j < n; j++, i++) {
      vis[i] = v === 2 ? 1 : 0;
      if (v >= 1) exp[i] = 1;
    }
  }
}
