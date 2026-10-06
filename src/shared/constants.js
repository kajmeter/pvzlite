// Core simulation constants shared by client, server and tests.
// All time values are in real-time seconds at "normal" game speed.

export const TICK_RATE = 20; // simulation ticks per second
export const DT = 1 / TICK_RATE;

export const MAX_SUPPLY = 200;
export const LEVEL_HEIGHT = 1.6; // world units between terrain levels

// Economy
export const CRYSTALS_PER_TRIP = 5;
export const FLUX_PER_TRIP = 4;
export const MINE_TIME = 2.786; // seconds a Shaper spends extracting from a crystal field
export const SIPHON_TIME = 1.4; // seconds a Shaper spends inside a Siphon
export const DEPOSIT_TIME = 0.15;
export const CRYSTAL_FIELD_RICH = 1800;
export const CRYSTAL_FIELD_POOR = 900;
export const VENT_AMOUNT = 2250;
export const START_CRYSTALS = 50;
export const START_FLUX = 0;
export const START_WORKERS = 12;

// Barriers (regenerating shields)
export const BARRIER_REGEN_DELAY = 7; // seconds without damage before barrier regenerates
export const BARRIER_REGEN_RATE = 2.8; // barrier points per second
export const MIN_DAMAGE = 0.5;

// Energy
export const ENERGY_REGEN = 0.7875; // per second

// Power fields
export const POWER_RADIUS = 6.5;

// Phase Portal warp-in
export const WARP_FAST = 3.6;
export const WARP_SLOW = 16;
export const PORTAL_TRANSFORM_TIME = 7;

// Production
export const QUEUE_LIMIT = 5;
export const OVERCLOCK_COST = 50;
export const OVERCLOCK_DURATION = 20;
export const OVERCLOCK_FACTOR = 1.5;

// Aegis Well
export const AEGIS_RANGE = 6;
export const AEGIS_RATE = 50.4; // barrier per second
export const AEGIS_ENERGY_PER_BARRIER = 1 / 3;

// Beacon towers (neutral watchtowers)
export const BEACON_CAPTURE_RANGE = 2.5;
export const BEACON_SIGHT = 22;

// Vision
export const FOG_UPDATE_TICKS = 4;

// Citadels can't be placed this close (cells) to resources
export const RESOURCE_EXCLUSION = 3;

export const PLAYER_COLORS = [
  { name: 'Azure', hex: 0x2f8cff, css: '#2f8cff' },
  { name: 'Crimson', hex: 0xff3b3b, css: '#ff3b3b' },
  { name: 'Verdant', hex: 0x2fd27a, css: '#2fd27a' },
  { name: 'Amber', hex: 0xffb21e, css: '#ffb21e' },
  { name: 'Violet', hex: 0xb36bff, css: '#b36bff' },
  { name: 'Teal', hex: 0x1fe0d0, css: '#1fe0d0' },
  { name: 'Rose', hex: 0xff6fb5, css: '#ff6fb5' },
  { name: 'Ivory', hex: 0xe8e8e8, css: '#e8e8e8' },
];

export const AI_DIFFICULTIES = ['easy', 'normal', 'hard', 'brutal'];

export const GAME_SPEEDS = { slower: 0.6, normal: 1, faster: 1.4, fastest: 2 };
