// pvzlite survival mode: Builders (Shaper drones) vs Hunters (Lancer knights).
// Builders mine scattered crystal fields, wall themselves in, place turrets and level up to 11.
// Hunters earn essence and buy blade/armor/etc. upgrades to break in and wipe them out.

export const SURVIVAL = {
  graceTime: 60, // seconds hunters stay caged at the start
  duration: 15 * 60, // builders win when the timer runs out
  maxLevel: 11, // reaching it is an instant builder victory
  builderLives: 2, // total lives (1 respawn)
  builderRespawn: 15,
  hunterRespawn: 12,
  startCrystals: 150,
  startEssence: 100,
  essencePerSecond: 4,
  // essence rewards for hunters
  bounty: {
    builderBase: 150,
    builderPerLevel: 25,
    barricade: 6,
    turret: 40,
    lanceTurret: 60,
    mender: 40,
  },
  cageRadius: 4,
  revealDuration: 5,
  revealCooldown: 40,
};

// Crystals needed to go from level L to L+1 (index = current level)
export const LEVEL_COSTS = [0, 110, 190, 290, 410, 550, 720, 900, 1110, 1340, 1600];

export function levelCost(level) {
  return LEVEL_COSTS[level] ?? Infinity;
}

export function builderStats(level) {
  return {
    hp: 45 + 12 * (level - 1),
    barrier: 40 + 10 * (level - 1),
    armor: Math.floor((level - 1) / 3),
    speed: 4.05 + 0.03 * (level - 1),
    yield: 6 + 2 * level,
  };
}

// Builder structures (all 2x2). Stats can scale with the builder's level when placed.
export const SURVIVAL_BUILDINGS = {
  barricade: {
    id: 'barricade',
    name: 'Barricade Ward',
    description: 'A sturdy crystal wall block. Also projects a small power field that Turrets need. Wall yourself in!',
    cost: 15,
    buildTime: 3,
    size: 2,
    hp: (L) => 300 + 50 * (L - 1),
    barrier: () => 0,
    armor: (L) => 2 + Math.floor((L - 1) / 3),
    powerRadius: 4.5,
    unlock: 1,
    hotkey: 'W',
    bounty: 'barricade',
  },
  turret: {
    id: 'turret',
    name: 'Spire Turret',
    description: 'Shoots crystal bolts at Hunters within 7 range. Damage scales with your level. Needs a Barricade Ward nearby.',
    cost: 90,
    buildTime: 8,
    size: 2,
    hp: (L) => 180 + 20 * (L - 1),
    barrier: () => 100,
    armor: () => 1,
    needsPower: true,
    unlock: 1,
    hotkey: 'T',
    weapon: { damage: (L) => 9 + 2.5 * (L - 1), range: 7, cooldown: 1.0 },
    bounty: 'turret',
  },
  mender: {
    id: 'mender',
    name: 'Mending Well',
    description: 'Restores the barriers of your nearby structures and Shapers using energy.',
    cost: 100,
    buildTime: 10,
    size: 2,
    hp: () => 160,
    barrier: () => 160,
    armor: () => 1,
    needsPower: true,
    unlock: 3,
    hotkey: 'M',
    range: 5.5,
    rate: 22,
    bounty: 'mender',
  },
  lanceTurret: {
    id: 'lanceTurret',
    name: 'Lance Turret',
    description: 'Long-range heavy turret (9.5 range). Slow but devastating. Needs a Barricade Ward nearby.',
    cost: 175,
    buildTime: 12,
    size: 2,
    hp: (L) => 240 + 25 * (L - 1),
    barrier: () => 120,
    armor: () => 2,
    needsPower: true,
    unlock: 5,
    hotkey: 'L',
    weapon: { damage: (L) => 32 + 6 * (L - 5), range: 9.5, cooldown: 2.2 },
    bounty: 'lanceTurret',
  },
};

export const SURVIVAL_BUILD_MENU = ['barricade', 'turret', 'mender', 'lanceTurret'];

// Hunter upgrade shop (essence). cost(level) = base + step * level
export const HUNTER_UPGRADES = {
  blades: { id: 'blades', name: 'Sharpened Blades', description: '+3 damage per glaive strike.', max: 10, base: 90, step: 45, hotkey: 'E' },
  armor: { id: 'armor', name: 'Heavy Armor', description: '+1 armor.', max: 10, base: 90, step: 45, hotkey: 'A' },
  vitality: { id: 'vitality', name: 'Vitality', description: '+60 hull.', max: 10, base: 80, step: 40, hotkey: 'V' },
  barrier: { id: 'barrier', name: 'Barrier Core', description: '+40 barrier and faster recharge.', max: 8, base: 100, step: 50, hotkey: 'B' },
  swiftness: { id: 'swiftness', name: 'Swiftness', description: '+0.15 movement speed.', max: 6, base: 120, step: 60, hotkey: 'S' },
  sunder: { id: 'sunder', name: 'Sunder', description: '+30% damage against structures.', max: 6, base: 100, step: 60, hotkey: 'D' },
  lunge: { id: 'lunge', name: 'Lunge Mastery', description: 'Lunge recharges 1 s faster and reaches 1 cell further.', max: 5, base: 150, step: 75, hotkey: 'F' },
};

export const HUNTER_UPGRADE_ORDER = ['blades', 'armor', 'vitality', 'barrier', 'swiftness', 'sunder', 'lunge'];

export function upgradeCost(id, level) {
  const u = HUNTER_UPGRADES[id];
  return u.base + u.step * level;
}

export function hunterStats(up) {
  return {
    hp: 220 + 60 * (up.vitality || 0),
    barrier: 100 + 40 * (up.barrier || 0),
    armor: 1 + (up.armor || 0),
    speed: 3.7 + 0.15 * (up.swiftness || 0),
    damage: 12 + 3 * (up.blades || 0),
    structureBonus: 1 + 0.3 * (up.sunder || 0),
    lungeCooldown: 9 - (up.lunge || 0),
    lungeRange: 4 + (up.lunge || 0),
    barrierRegen: 1 + 0.25 * (up.barrier || 0),
  };
}
