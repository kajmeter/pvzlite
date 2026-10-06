// Network protocol shared by the server and the browser client.
// The server runs the authoritative World and streams compact per-player snapshots.
import { TICK_RATE } from '../constants.js';
import { unitSpeed } from '../sim/behavior.js';

export const PROTOCOL_VERSION = 1;
export const SNAPSHOT_EVERY = 2; // ticks between snapshots (10 Hz)
export const SNAPSHOT_INTERVAL = SNAPSHOT_EVERY / TICK_RATE;

// Append only: indices are part of the wire format.
const TYPES = [
  'shaper', 'lancer', 'citadel', 'conduit', 'siphon', 'portal', 'foundry', 'archive', 'sanctum', 'aegis', 'crystal', 'vent', 'beacon', 'rubble',
  'builder', 'hunter', 'barricade', 'turret', 'mender', 'lanceTurret',
  // survival (Shapers vs Lancer)
  'generator', 'wall', 'market', 'depot', 'autoMine', 'library', 'detector', 'shop', 'lancerHero', 'spirit', 'miner', 'warden',
];
export const TYPE_INDEX = Object.fromEntries(TYPES.map((t, i) => [t, i]));
export const TYPE_NAME = TYPES;

const r1 = (v) => Math.round(v * 100) / 100;

// Events worth forwarding to clients (only if the player can see them / owns them)
const PUBLIC_EVENTS = new Set(['strike', 'hit', 'death', 'lunge', 'warpStart', 'warped', 'eliminated', 'gameOver', 'bolt', 'pickupSpawn']);
const OWNER_EVENTS = new Set([
  'buildStart', 'buildDone', 'trained', 'research', 'error', 'alert', 'phase', 'overclock', 'upgraded', 'mined',
  // survival
  'upgradeStart', 'salvageStart', 'salvaged', 'cancelled', 'trade', 'bought', 'sold', 'pickup', 'share', 'exchange', 'abilitiesPicked',
]);
// survival announcements everybody receives
const GLOBAL_EVENTS = new Set(['lancerArrives', 'unlock', 'shaperDown', 'lancerDown', 'hunterDown', 'spiritDown', 'form', 'respawn']);
// survival events seen by the caster's team, or by anyone who can see the spot
const TEAM_EVENTS = new Set(['ability', 'scan']);

function unitRow(u, own, world) {
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
  row.push(own ? [u.orders.length === 0 ? 1 : 0, u.autocast?.lunge === false ? 0 : 1] : 0);
  // survival unit state (see docs/design/pvz-mode.md §14)
  row.push(survivalUnitRow(u, world));
  return row;
}

const left = (until, tick) => (until > tick ? r1((until - tick) / TICK_RATE) : 0);

function survivalUnitRow(u, world) {
  if (!u.def.survival || !world) return 0;
  const t = world.tick;
  return [
    Math.ceil(u.maxHp),
    Math.ceil(u.maxBarrier),
    u.tier || 0,
    left(u.stasisUntil, t),
    u.cloakUntil > t ? 1 : 0,
    u.invulnUntil > t ? 1 : 0,
    left(u.immuneUntil, t),
    left(u.decayUntil, t),
    r1(u.damage || 0),
    r1(u.strikeCooldown || (u.def.weapon ? u.def.weapon.cooldown : 0)),
    Math.round((u.dr || 0) * 10000) / 10000,
    r1(u.regen || 0),
    r1(unitSpeed(world, u)),
    r1(u.sight || u.def.sight),
  ];
}

function buildingRow(b, own, world) {
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
  row.push(
    own
      ? [
          Math.floor(b.energy * 10) / 10,
          r1(b.warpCd || 0),
          r1(b.transform || 0),
          b.queue.map((q) => [q.kind === 'unit' ? 0 : 1, q.id, r1(q.progress), q.time, q.level || q.tier || 0]),
          b.rally ? [r1(b.rally.x), r1(b.rally.y), b.rally.target || 0] : 0,
          b.vent ? b.vent.amount : -1,
        ]
      : 0,
  );
  row.push(survivalBuildingRow(b, world));
  return row;
}

function survivalBuildingRow(b, world) {
  if (!b.def.survival || !world) return 0;
  const t = world.tick;
  return [
    Math.ceil(b.maxHp),
    Math.ceil(b.maxBarrier),
    b.level || 0,
    r1(Math.max(0, b.upgrading || 0)),
    r1(b.upgradeTotal || 0),
    r1(Math.max(0, b.salvaging || 0)),
    b.ceaseFire ? 1 : 0,
    r1(b.aim || 0),
    b.dr || 0,
    b.weaponDamage || 0,
    b.weaponRange || 0,
    b.weaponCooldown || 0,
    left(b.overchargeUntil, t),
    left(b.invulnUntil, t),
    r1(b.buildTime || b.def.buildTime || 0),
    b.upgradeTo || 0,
  ];
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
    if (own || world.isAllied(u.owner, playerId) || vis(u)) units.push(unitRow(u, own, world));
  }
  const buildings = [];
  for (const b of world.buildings) {
    if (b.dead) continue;
    const own = b.owner === playerId;
    if (own || b.owner < 0 || world.isAllied(b.owner, playerId) || vis(b)) buildings.push(buildingRow(b, own, world));
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
    if (GLOBAL_EVENTS.has(ev.e)) {
      outEvents.push(ev);
      continue;
    }
    if (TEAM_EVENTS.has(ev.e)) {
      if (playerId < 0 || world.isAllied(ev.owner, playerId) || (ev.x !== undefined && world.isVisibleTo({ kind: 'point', x: ev.x, y: ev.y }, playerId))) outEvents.push(ev);
      continue;
    }
    if (OWNER_EVENTS.has(ev.e)) {
      if (ev.owner === playerId || (ev.e === 'overclock' && world.byId.get(ev.id)?.owner === playerId) || (ev.e === 'phase' && world.byId.get(ev.id)?.owner === playerId)) outEvents.push(ev);
    } else if (PUBLIC_EVENTS.has(ev.e)) {
      if (ev.e === 'gameOver' || ev.e === 'eliminated') outEvents.push(ev);
      else if (ev.x !== undefined ? playerId < 0 || world.isVisibleTo({ kind: 'point', x: ev.x, y: ev.y }, playerId) || ev.owner === playerId : true) outEvents.push(ev);
    }
  }
  const survivalMode = world.mode === 'survival';
  const players = world.players.map((pl) => ({
    id: pl.id,
    eliminated: pl.eliminated,
    ...(survivalMode ? survivalPlayer(world, pl, pl.id === playerId) : {}),
    // only reveal economy details for yourself
    ...(pl.id === playerId
      ? {
          crystals: Math.floor(pl.crystals),
          flux: Math.floor(pl.flux),
          supplyUsed: pl.supplyUsed,
          supplyCap: pl.supplyCap,
          upgrades: pl.upgrades,
          researching: pl.researching,
        }
      : { upgrades: pl.upgrades }),
  }));
  const survival = survivalMode ? survivalGlobal(world, playerId) : null;
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
    survival,
    over: world.over ? 1 : 0,
    winnerTeam: world.winnerTeam,
  };
}

function survivalPlayer(world, pl, own) {
  const out = {
    role: pl.role,
    form: pl.form,
    team: pl.team,
    alive: pl.alive ? 1 : 0,
    heroId: pl.heroId,
    respawnAt: pl.respawnAt,
    pendingForm: pl.pendingForm,
    items: pl.form === 'lancer' || pl.form === 'hunter' ? pl.items.slice() : [],
    stats: { fed: Math.floor(pl.stats.fed || 0), shapersKilled: pl.stats.shapersKilled || 0, deaths: pl.stats.deaths || 0 },
  };
  if (own) {
    out.gas = Math.floor(pl.gas * 100) / 100;
    out.minerals = Math.floor(pl.minerals * 100) / 100;
    out.abilities = pl.abilities.slice();
    const cd = {};
    for (const k in pl.cd) if (pl.cd[k] > 0) cd[k] = r1(pl.cd[k]);
    out.cooldowns = cd;
    let gen = 0;
    let miners = 0;
    for (const b of world.buildings) {
      if (b.owner !== pl.id || b.dead) continue;
      if (b.type === 'generator') gen = Math.max(gen, b.level);
      if (b.type === 'depot') for (const q of b.queue) if (q.id === 'miner') miners++;
    }
    for (const u of world.units) if (u.owner === pl.id && u.type === 'miner' && !u.dead) miners++;
    out.genLevel = gen;
    out.minersCount = miners;
  }
  return out;
}

const PICKUP_TYPES = { gasBonus: 0, pallet: 1 };

function survivalGlobal(world, playerId) {
  const sv = world.survival;
  const t = world.tick;
  const p = playerId >= 0 ? world.players[playerId] : null;
  const pickups = [];
  for (const k of world.pickups) {
    if (playerId >= 0 && !world.isVisibleTo({ kind: 'point', x: k.x, y: k.y }, playerId)) continue;
    pickups.push([k.id, PICKUP_TYPES[k.type] ?? 0, r1(k.x), r1(k.y), Math.round(k.amount), k.expires >= 0 ? r1((k.expires - t) / TICK_RATE) : -1]);
  }
  const scans = [];
  for (const s of sv.scans) {
    if (s.until <= t || (p && s.team !== p.team)) continue;
    scans.push([r1(s.x), r1(s.y), s.r, r1((s.until - t) / TICK_RATE)]);
  }
  const fields = sv.fields.map((f) => [f.id, f.bx, f.by, r1((f.until - t) / TICK_RATE), f.owner]);
  return {
    phase: sv.phase,
    lancerIn: Math.max(0, r1((sv.lancerTick - t) / TICK_RATE)),
    unlockIn: Math.max(0, r1((sv.unlockTick - t) / TICK_RATE)),
    elapsed: r1(t / TICK_RATE),
    timeLeft: sv.endTick >= 0 ? Math.max(0, r1((sv.endTick - t) / TICK_RATE)) : -1,
    price: sv.price,
    reason: sv.reason,
    pace: world.options.pace || 1,
    shopId: sv.shopId,
    pickups,
    scans,
    fields,
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
