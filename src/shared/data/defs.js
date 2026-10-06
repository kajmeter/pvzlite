// Game data: units, structures, research.
// pvzlite uses its own original faction (the Lumen Concord). Numbers are tuned
// to classic RTS pacing: fast workers, sturdy shielded melee infantry with a dash.

export const UNITS = {
  shaper: {
    id: 'shaper',
    name: 'Shaper',
    role: 'worker',
    description: 'Hovering worker construct. Harvests crystals and flux and projects new structures into being.',
    cost: { crystals: 50, flux: 0 },
    supply: 1,
    buildTime: 12,
    hp: 20,
    barrier: 20,
    armor: 0,
    speed: 3.94,
    radius: 0.375,
    sight: 8,
    turnRate: 18,
    weapon: { damage: 5, hits: 1, cooldown: 1.07, range: 0.1, windup: 0.12, hitInterval: 0, upgradePerLevel: 0 },
    attributes: ['light', 'mechanical'],
    producedAt: 'citadel',
    hotkey: 'E',
    priority: 20,
  },
  lancer: {
    id: 'lancer',
    name: 'Lancer',
    role: 'melee',
    description: 'Armored crystal knight wielding a twin-edged arc glaive. Strikes twice per swing. With Lunge Drive it dashes into enemies.',
    cost: { crystals: 100, flux: 0 },
    supply: 2,
    buildTime: 27,
    warpCooldown: 20,
    hp: 100,
    barrier: 50,
    armor: 1,
    speed: 3.15,
    lungeSpeed: 4.725, // passive speed after Lunge Drive research
    radius: 0.5,
    sight: 9,
    turnRate: 14,
    weapon: { damage: 8, hits: 2, cooldown: 0.857, range: 0.1, windup: 0.18, hitInterval: 0.14, upgradePerLevel: 1 },
    lunge: { range: 4, cooldown: 7, speed: 8.5, maxDuration: 1.6, bonusDamage: 8 },
    attributes: ['light', 'biological'],
    producedAt: 'portal',
    hotkey: 'Z',
    priority: 20,
  },
};

// Survival-mode units (pvzlite "Shapers vs Lancer", see docs/design/pvz-mode.md).
// Lancer / Hunter stats are recomputed from shop items (data/survival.js lancerStats).
const survivalUnit = (o) => ({
  cost: { crystals: 0, flux: 0 },
  supply: 0,
  buildTime: 0,
  barrier: 0,
  armor: 0,
  turnRate: 16,
  attributes: [],
  priority: 20,
  survival: true,
  clearance: 1,
  weapon: null,
  ...o,
});
UNITS.builder = survivalUnit({
  id: 'builder',
  name: 'Shaper',
  rig: 'shaper',
  role: 'builder',
  description: 'Your Shaper hero. Build a Generator, wall in, trade at the Market and climb to Generator Max. Fragile: hide from the Lancer!',
  hp: 20,
  barrier: 20,
  speed: 3.94,
  radius: 0.4,
  sight: 8,
  turnRate: 18,
  attributes: ['light', 'mechanical'],
  scale: 1.2,
});
// vsShaper: damage multiplier against the Shaper hero (20 HP + 20 barrier): spec section 3 / the
// wiki say a Shaper dies to ~1-2 early strikes, so a 5-damage strike hits a Shaper for 20.
const LANCER_WEAPON = { damage: 5, hits: 1, cooldown: 1.0, range: 0.2, windup: 0.15, hitInterval: 0, upgradePerLevel: 0, vsShaper: 4 };
UNITS.lancerHero = survivalUnit({
  id: 'lancerHero',
  name: 'Lancer',
  rig: 'lancer',
  role: 'lancer',
  description: 'The Lancer. Feeds on Shaper structures (minerals = damage dealt) and buys blades, armor and amulets at the Shop.',
  hp: 500,
  speed: 4.2,
  radius: 0.9,
  sight: 9,
  turnRate: 14,
  clearance: 2,
  weapon: LANCER_WEAPON,
  attributes: ['heavy', 'biological'],
  priority: 25,
  scale: 1.9,
});
UNITS.hunter = survivalUnit({
  id: 'hunter',
  name: 'Hunter',
  rig: 'lancer',
  role: 'hunter',
  description: 'A fallen Shaper hunting for the Lancer. Same Shop, feed and abilities as the Lancer, minus Scan.',
  hp: 250,
  speed: 4.2,
  radius: 0.9,
  sight: 9,
  turnRate: 14,
  clearance: 2,
  weapon: LANCER_WEAPON,
  attributes: ['heavy', 'biological'],
  priority: 24,
  scale: 1.7,
});
UNITS.spirit = survivalUnit({
  id: 'spirit',
  name: 'Shaper Spirit',
  rig: 'shaper',
  role: 'spirit',
  description: 'A fallen Shaper helping the living: Overcharge, Decay and auras that boost turrets and miners.',
  hp: 60,
  speed: 4.6,
  radius: 0.4,
  sight: 9,
  turnRate: 18,
  priority: 15,
  scale: 1.1,
});
UNITS.miner = survivalUnit({
  id: 'miner',
  name: 'Miner',
  rig: 'shaper',
  role: 'miner',
  description: 'Walks to the nearest mineral field and gathers minerals forever.',
  hp: 40,
  speed: 3.0,
  radius: 0.35,
  sight: 5,
  priority: 12,
  scale: 0.8,
});
UNITS.warden = survivalUnit({
  id: 'warden',
  name: 'Warden',
  rig: 'lancer',
  role: 'warden',
  description: 'Ranged guardian trained at the Ancient Library. Shoots Lancers and Hunters.',
  hp: 20000,
  speed: 4.0,
  radius: 0.5,
  sight: 10,
  weapon: { damage: 40960, hits: 1, cooldown: 1.0, range: 6, windup: 0.1, hitInterval: 0, upgradePerLevel: 0, ranged: true },
  attributes: ['mechanical'],
  priority: 21,
  scale: 1.1,
});

// Footprints are in cells. Structures with `needsPower` must be inside a Conduit field.
export const BUILDINGS = {
  citadel: {
    id: 'citadel',
    name: 'Citadel',
    description: 'Main structure. Trains Shapers, receives resources and can Overclock other structures.',
    cost: { crystals: 400, flux: 0 },
    buildTime: 71,
    hp: 1000,
    barrier: 1000,
    armor: 1,
    size: 5,
    supply: 15,
    sight: 11,
    needsPower: false,
    requires: [],
    hotkey: 'C',
    dropoff: true,
    energy: { start: 50, max: 200 },
    trains: ['shaper'],
    research: [],
    priority: 11,
  },
  conduit: {
    id: 'conduit',
    name: 'Conduit',
    description: 'Provides 8 supply and projects a power field that energizes nearby structures.',
    cost: { crystals: 100, flux: 0 },
    buildTime: 18,
    hp: 200,
    barrier: 200,
    armor: 1,
    size: 2,
    supply: 8,
    sight: 9,
    needsPower: false,
    requires: [],
    hotkey: 'E',
    powerRadius: 6.5,
    trains: [],
    research: [],
    priority: 11,
  },
  siphon: {
    id: 'siphon',
    name: 'Siphon',
    description: 'Built on a flux vent. Shapers harvest flux from it.',
    cost: { crystals: 75, flux: 0 },
    buildTime: 21,
    hp: 300,
    barrier: 300,
    armor: 1,
    size: 3,
    sight: 9,
    needsPower: false,
    requires: [],
    hotkey: 'A',
    onVent: true,
    trains: [],
    research: [],
    priority: 11,
  },
  portal: {
    id: 'portal',
    name: 'Portal',
    description: 'Trains Lancers. After Phase Transit it becomes a Phase Portal that warps Lancers into any power field.',
    cost: { crystals: 150, flux: 0 },
    buildTime: 46,
    hp: 500,
    barrier: 500,
    armor: 1,
    size: 3,
    sight: 9,
    needsPower: true,
    requires: ['citadel'],
    hotkey: 'G',
    trains: ['lancer'],
    research: [],
    priority: 11,
  },
  foundry: {
    id: 'foundry',
    name: 'Foundry',
    description: 'Researches weapon, armor and barrier upgrades.',
    cost: { crystals: 150, flux: 0 },
    buildTime: 32,
    hp: 400,
    barrier: 400,
    armor: 1,
    size: 3,
    sight: 9,
    needsPower: true,
    requires: ['citadel'],
    hotkey: 'F',
    trains: [],
    research: ['weapons', 'armor', 'barrier'],
    priority: 11,
  },
  archive: {
    id: 'archive',
    name: 'Archive',
    description: 'Unlocks Phase Transit, the Sanctum and the Aegis Well.',
    cost: { crystals: 150, flux: 0 },
    buildTime: 36,
    hp: 550,
    barrier: 550,
    armor: 1,
    size: 3,
    sight: 9,
    needsPower: true,
    requires: ['portal'],
    hotkey: 'Y',
    trains: [],
    research: ['phaseTransit'],
    priority: 11,
  },
  sanctum: {
    id: 'sanctum',
    name: 'Sanctum',
    description: 'Researches Lunge Drive and unlocks level 2 and 3 Foundry upgrades.',
    cost: { crystals: 150, flux: 100 },
    buildTime: 36,
    hp: 500,
    barrier: 500,
    armor: 1,
    size: 3,
    sight: 9,
    needsPower: true,
    requires: ['archive'],
    hotkey: 'T',
    trains: [],
    research: ['lunge'],
    priority: 11,
  },
  aegis: {
    id: 'aegis',
    name: 'Aegis Well',
    description: 'Automatically restores the barriers of nearby units and structures using energy.',
    cost: { crystals: 100, flux: 0 },
    buildTime: 29,
    hp: 150,
    barrier: 150,
    armor: 1,
    size: 2,
    sight: 9,
    needsPower: true,
    requires: ['archive'],
    hotkey: 'B',
    energy: { start: 100, max: 100 },
    trains: [],
    research: [],
    priority: 11,
  },
};

// Survival-mode structures (stats per level live in data/survival.js)
const survivalStructure = (o) => ({
  supply: 0,
  sight: 6,
  needsPower: false,
  requires: [],
  trains: [],
  research: [],
  priority: 11,
  survival: true,
  size: 2,
  armor: 0,
  barrier: 0,
  cost: { crystals: 0, flux: 0 },
  ...o,
});
BUILDINGS.generator = survivalStructure({ id: 'generator', name: 'Generator', description: 'Produces gas. One per Shaper.', buildTime: 2, hp: 200, hotkey: 'G', priority: 12 });
BUILDINGS.wall = survivalStructure({ id: 'wall', name: 'Wall', description: 'Wall block, upgraded in place.', buildTime: 2, hp: 50, hotkey: 'W', priority: 9, sight: 4 });
BUILDINGS.turret = survivalStructure({ id: 'turret', name: 'Turret', description: 'Shoots visible Lancers and Hunters.', buildTime: 4, hp: 20, hotkey: 'T', sight: 8, priority: 13 });
BUILDINGS.market = survivalStructure({ id: 'market', name: 'Market', description: 'Trades gas for minerals.', buildTime: 5, hp: 20, hotkey: 'M' });
BUILDINGS.depot = survivalStructure({ id: 'depot', name: 'Collection Depot', description: 'Trains Miners.', buildTime: 10, hp: 200, size: 3, hotkey: 'D', trains: ['miner'] });
BUILDINGS.autoMine = survivalStructure({ id: 'autoMine', name: 'Auto Mine', description: 'Produces gas forever.', buildTime: 5, hp: 100, hotkey: 'A' });
BUILDINGS.library = survivalStructure({ id: 'library', name: 'Ancient Library', description: 'Enables Turret 11+, the Detector and Wardens.', buildTime: 20, hp: 300, size: 3, hotkey: 'L', trains: ['warden'] });
BUILDINGS.detector = survivalStructure({ id: 'detector', name: 'Lancer Detector', description: 'Reveals enemies, even cloaked ones, within 20 cells.', buildTime: 10, hp: 200, hotkey: 'X', sight: 20 });
BUILDINGS.shop = survivalStructure({ id: 'shop', name: 'Lancer Shop', description: 'Neutral, invulnerable. Lancers heal and shop here.', buildTime: 1, hp: 100000, size: 5, sight: 0, priority: 0, neutral: true });

// Researches. Leveled upgrades have one entry per level.
export const RESEARCH = {
  phaseTransit: {
    id: 'phaseTransit',
    name: 'Phase Transit',
    description: 'Portals become Phase Portals that can warp Lancers into any power field.',
    at: 'archive',
    hotkey: 'W',
    levels: [{ cost: { crystals: 50, flux: 50 }, time: 100, requires: [] }],
  },
  lunge: {
    id: 'lunge',
    name: 'Lunge Drive',
    description: 'Lancers move 50% faster and dash at nearby enemies, dealing +8 damage on impact.',
    at: 'sanctum',
    hotkey: 'C',
    levels: [{ cost: { crystals: 100, flux: 100 }, time: 100, requires: [] }],
  },
  weapons: {
    id: 'weapons',
    name: 'Arc Weapons',
    description: 'Lancer glaive damage +1 per strike per level.',
    at: 'foundry',
    hotkey: 'E',
    levels: [
      { cost: { crystals: 100, flux: 100 }, time: 129, requires: [] },
      { cost: { crystals: 150, flux: 150 }, time: 154, requires: ['sanctum'] },
      { cost: { crystals: 200, flux: 200 }, time: 179, requires: ['sanctum'] },
    ],
  },
  armor: {
    id: 'armor',
    name: 'Plating',
    description: 'All units gain +1 armor per level.',
    at: 'foundry',
    hotkey: 'A',
    levels: [
      { cost: { crystals: 100, flux: 100 }, time: 129, requires: [] },
      { cost: { crystals: 150, flux: 150 }, time: 154, requires: ['sanctum'] },
      { cost: { crystals: 200, flux: 200 }, time: 179, requires: ['sanctum'] },
    ],
  },
  barrier: {
    id: 'barrier',
    name: 'Barrier Lattice',
    description: 'Barriers of all units and structures gain +1 armor per level.',
    at: 'foundry',
    hotkey: 'S',
    levels: [
      { cost: { crystals: 150, flux: 150 }, time: 129, requires: [] },
      { cost: { crystals: 225, flux: 225 }, time: 154, requires: ['sanctum'] },
      { cost: { crystals: 300, flux: 300 }, time: 179, requires: ['sanctum'] },
    ],
  },
};

// Neutral entities placed by maps.
export const NEUTRALS = {
  crystal: { id: 'crystal', name: 'Crystal Field', sizeW: 2, sizeH: 1 },
  vent: { id: 'vent', name: 'Flux Vent', size: 3 },
  beacon: { id: 'beacon', name: 'Beacon Tower', size: 2 },
  rubble: { id: 'rubble', name: 'Collapsed Rubble', size: 4, hp: 2000, armor: 1 },
};

export const BUILD_ORDER_MENU = ['citadel', 'conduit', 'siphon', 'portal', 'foundry', 'archive', 'sanctum', 'aegis'];

export function defOf(type) {
  return UNITS[type] || BUILDINGS[type] || NEUTRALS[type] || null;
}

export function isUnitType(type) {
  return !!UNITS[type];
}

export function isBuildingType(type) {
  return !!BUILDINGS[type];
}
