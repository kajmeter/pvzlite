// pvzlite survival mode data: Shapers (builders) vs the Lancer.
// Rules follow docs/design/pvz-mode.md (a reproduction of the community mode "Probes vs Zealot 2"
// with pvzlite's own characters). Everything here is plain data + pure helpers.

export const SURVIVAL = {
  lancerSpawn: 40, // s: the Lancer appears at the Shop
  unlockTime: 300, // s: gold groves open for building, dead Shapers may become Hunters
  shopRadius: 8, // cells: heal / buy radius around the Shop centre
  shopHealPct: 0.25, // fraction of max HP healed per second near the Shop
  lancerStartMinerals: 40,
  passiveIncome: 1, // minerals per second for the Lancer and Hunters
  marketStartPrice: 155, // gas per 10 minerals
  marketStep: 5,
  marketMinPrice: 20,
  marketSellSpread: 10, // selling 10 minerals pays price - spread (min 5)
  gasBonusEvery: 40, // s
  gasBonusMax: 6,
  gasBonusAmount: 10,
  gasBonusMinDist: 15, // cells from the Shop
  gasBonusPickup: 1.2, // pickup distance (cells)
  palletPickup: 1.5,
  palletLife: 90, // s
  salvageTime: 3, // s
  maxMiners: 15,
  minersPerField: 3,
  goldLockRadius: 10,
  spiritRespawn: 60,
  spiritInvuln: 30,
  hunterRespawn: 20,
  formChoiceTime: 15,
  abilityPickTime: 20,
  maxItems: 6,
  gasExchangeRate: 64000, // minerals per 1 gas
  shopClearance: 2, // pvzlite: cells around the Shop footprint where nothing can be built
  depotQueue: 5,
  spiritAuraRadius: 3,
  spiritTurretBonus: 0.1,
  spiritMinerBonus: 0.25,
  overchargeFactor: 1.3,
  minerOverchargeRadius: 3,
  detectorRange: 20,
  shaperSpawnRing: [6, 9],
  lancerRegenDelay: 0, // regen always works (wiki: potions regenerate in and out of combat)
};

const req = (type, level) => ({ type, level });

// ------------------------------------------------------------------ Generator (one per Shaper)
// [gas, minerals, income gas/s, pallet minerals on salvage, hp, requires]
const GEN = [
  [0, 0, 1, 0, 200, null],
  [50, 0, 2, 100, 300, req('wall', 1)],
  [100, 0, 4, 150, 400, req('wall', 4)],
  [200, 0, 8, 175, 600, req('market', 1)],
  [400, 0, 16, 200, 800, req('wall', 6)],
  [800, 32, 32, 400, 1200, req('market', 2)],
  [1600, 64, 64, 5600, 1800, req('wall', 7)],
  [3200, 128, 128, 6400, 2700, req('wall', 9)],
  [6400, 256, 256, 9600, 4000, req('wall', 11)],
  [12800, 512, 512, 12800, 6000, req('wall', 13)],
];
export const GENERATOR_LEVELS = GEN.map(([gas, minerals, income, pallet, hp, requires], i) => ({
  level: i + 1,
  name: i === GEN.length - 1 ? 'Generator Max' : `Generator ${i + 1}`,
  gas,
  minerals,
  income,
  pallet,
  hp,
  dr: i + 1 >= 5 ? 0.92 : 0,
  time: i === 0 ? 2 : 5,
  requires,
}));

// ------------------------------------------------------------------ Walls
// [name, gas, minerals, hp, shield, dr]
const WALLS = [
  ['Wall 1', 4, 0, 50, 0, 0],
  ['Wall 2', 8, 0, 70, 0, 0],
  ['Wall 3', 16, 0, 110, 0, 0],
  ['Wall 4', 32, 0, 170, 0, 0],
  ['Wall 5', 64, 0, 210, 0, 0],
  ['Ultra Wall 1', 128, 0, 320, 0, 0.02],
  ['Ultra Wall 2', 256, 0, 640, 0, 0.04],
  ['Ultra Wall 3', 512, 0, 1280, 0, 0.06],
  ['Ultra Wall 4', 1024, 0, 2560, 0, 0.08],
  ['Ultra Wall 5', 2048, 0, 5120, 0, 0.1],
  ['Mega Wall 1', 4096, 32, 10240, 0, 0.12],
  ['Mega Wall 2', 8192, 64, 20480, 0, 0.14],
  ['Mega Wall 3', 16384, 128, 40960, 0, 0.16],
  ['Mega Wall 4', 32768, 256, 81920, 0, 0.18],
  ['Mega Wall 5', 65536, 516, 163840, 0, 0.2],
  ['Power Wall 1', 131072, 1020, 350000, 0, 0.5],
  ['Power Wall 2', 262144, 2048, 400000, 277680, 0.6],
  ['Final Wall', 1000000, 500000, 500000, 500000, 0.75],
];
export const WALL_LEVELS = WALLS.map(([name, gas, minerals, hp, shield, dr], i) => ({
  level: i + 1,
  name,
  gas,
  minerals,
  hp,
  shield,
  dr,
  time: i < 5 ? 2 : i < 10 ? 3 : i < 15 ? 4 : 5,
}));

export function wallName(level) {
  return WALL_LEVELS[level - 1]?.name ?? `Wall ${level}`;
}

// ------------------------------------------------------------------ Market
export const MARKET_LEVELS = [
  { level: 1, name: 'Market', gas: 64, minerals: 0, hp: 20, time: 5 },
  { level: 2, name: 'Underground Market', gas: 256, minerals: 0, hp: 50, time: 3 },
  { level: 3, name: 'Global Market', gas: 1024, minerals: 0, hp: 130, time: 3 },
];

// ------------------------------------------------------------------ Turrets
// [gas, minerals, damage, cooldown, range, hp, requires]
const TUR = [
  [8, 0, 1, 1, 6, 20, null],
  [24, 0, 2, 1, 6, 30, null],
  [32, 0, 4, 1, 6, 40, req('market', 1)],
  [64, 0, 8, 1, 6, 40, req('market', 1)],
  [128, 0, 16, 1, 6, 40, req('market', 2)],
  [256, 0, 32, 1, 6, 40, req('market', 2)],
  [512, 16, 64, 1, 6, 40, req('market', 3)],
  [1024, 32, 128, 1, 7, 40, req('market', 3)],
  [2048, 64, 400, 1, 7, 40, req('market', 3)],
  [4096, 128, 700, 1, 8, 40, req('market', 3)],
  [8192, 15000, 40960, 1, 9, 40, { type: 'library' }],
  [8192, 36000, 160000, 1, 10, 40, { type: 'library' }],
  [8192, 1000960, 524270, 0.2, 11, 40, { type: 'library' }],
  [0, 20000000, 524270, 0.1, 7, 100000, { type: 'library' }],
];
export const TURRET_LEVELS = TUR.map(([gas, minerals, damage, cooldown, range, hp, requires], i) => ({
  level: i + 1,
  name: i === TUR.length - 1 ? 'Final Turret' : `Turret ${i + 1}`,
  gas,
  minerals,
  damage,
  cooldown,
  range,
  hp,
  // build time of Turret 1, upgrade time for the others (pvzlite: 5 s from level 11 on)
  time: i + 1 >= 11 ? 5 : 4,
  requires,
}));

// Turrets that can be placed directly at a higher level (cumulative cost)
export const TURRET_DIRECT = {
  6: { requires: { type: 'market', level: 1 }, time: 20 },
  11: { requires: { type: 'library' }, time: 30 },
};

// ------------------------------------------------------------------ Miners, auto mines, wardens
const MINERS = [
  ['Simple Miner', 512, 1, 8],
  ['Average Miner', 1024, 1, 4],
  ['Advanced Miner', 2048, 1, 2],
  ['Professional Miner', 4096, 1, 1],
  ['Master Miner', 15360, 6, 1],
  ['Ultra Miner', 71680, 36, 1],
  ['Legendary Miner', 299999, 216, 1],
  ['Perfect Miner', 1000000, 1296, 1],
  ['Ludicrous Miner', 10000000, 17500, 1],
];
export const MINER_TIERS = MINERS.map(([name, gas, amount, interval], i) => ({
  tier: i + 1,
  name,
  gas,
  minerals: 0,
  amount,
  interval,
  trainTime: i + 1 >= 6 ? 10 : 5,
}));

export const AUTOMINE_LEVELS = [
  [32, 1],
  [256, 8],
  [1024, 32],
  [4096, 128],
  [16384, 512],
  [65536, 2048],
  [262144, 8192],
  [1000000, 32768],
].map(([minerals, income], i) => ({ level: i + 1, name: `Auto Mine ${i + 1}`, gas: 0, minerals, income }));

export const WARDEN_TIERS = [
  ['Warden I', 35000, 25000, 40960, 20000],
  ['Warden II', 100000, 35000, 160000, 60000],
  ['Warden III', 5000000, 1000000, 2621350, 500000],
  ['Warden IV', 10000000, 2500000, 7864050, 2000000],
].map(([name, gas, minerals, dps, hp], i) => ({ tier: i + 1, name, gas, minerals, dps, hp, trainTime: 20 }));

// ------------------------------------------------------------------ Structures (static info)
export const SURVIVAL_BUILDINGS = {
  generator: {
    id: 'generator',
    name: 'Generator',
    description: 'Produces gas. One per Shaper; Level 1 is free. Upgrades need a Wall or a Market of a certain level.',
    size: 2,
    hp: GENERATOR_LEVELS[0].hp,
    buildTime: GENERATOR_LEVELS[0].time,
    cost: { gas: 0, minerals: 0 },
    salvage: true,
    upgradable: true,
    hotkey: 'G',
  },
  wall: {
    id: 'wall',
    name: 'Wall',
    description: 'A 2×2 wall block. Upgrade it in place up to the Final Wall. Lancers (2 cells wide) cannot pass 1-cell gaps.',
    size: 2,
    hp: WALL_LEVELS[0].hp,
    buildTime: WALL_LEVELS[0].time,
    cost: { gas: WALL_LEVELS[0].gas, minerals: 0 },
    salvage: true,
    upgradable: true,
    hotkey: 'W',
  },
  turret: {
    id: 'turret',
    name: 'Turret',
    description: 'Shoots visible Lancers and Hunters. Built as Turret 1, or directly as Turret 6 / Turret 11. Does not fire while upgrading.',
    size: 2,
    hp: TURRET_LEVELS[0].hp,
    buildTime: TURRET_LEVELS[0].time,
    cost: { gas: TURRET_LEVELS[0].gas, minerals: 0 },
    salvage: true,
    upgradable: true,
    hotkey: 'T',
  },
  market: {
    id: 'market',
    name: 'Market',
    description: 'Trade gas for minerals at the global price. Unlocks Generator 4/6 and higher Turrets.',
    size: 2,
    hp: MARKET_LEVELS[0].hp,
    buildTime: MARKET_LEVELS[0].time,
    cost: { gas: MARKET_LEVELS[0].gas, minerals: 0 },
    salvage: true,
    upgradable: true,
    hotkey: 'M',
  },
  depot: {
    id: 'depot',
    name: 'Collection Depot',
    description: 'Trains Miners that gather minerals forever. Needed for Auto Mines.',
    size: 3,
    hp: 200,
    buildTime: 10,
    cost: { gas: 256, minerals: 0 },
    salvage: true,
    upgradable: false,
    hotkey: 'D',
  },
  autoMine: {
    id: 'autoMine',
    name: 'Auto Mine',
    description: 'Built with minerals; produces gas forever. Needs a Collection Depot. Cannot be salvaged.',
    size: 2,
    hp: 100,
    buildTime: 5,
    cost: null, // depends on the level (AUTOMINE_LEVELS)
    salvage: false,
    upgradable: false,
    hotkey: 'A',
  },
  library: {
    id: 'library',
    name: 'Ancient Library',
    description: 'Enables Turret 11+, the Lancer Detector and Wardens.',
    size: 3,
    hp: 300,
    buildTime: 20,
    cost: { gas: 4096, minerals: 256 },
    salvage: true,
    upgradable: false,
    hotkey: 'L',
  },
  detector: {
    id: 'detector',
    name: 'Lancer Detector',
    description: 'Reveals enemies, even cloaked ones, within 20 cells. Needs an Ancient Library.',
    size: 2,
    hp: 200,
    buildTime: 10,
    cost: { gas: 9999, minerals: 1024 },
    salvage: false,
    upgradable: false,
    hotkey: 'X',
  },
  shop: {
    id: 'shop',
    name: 'Lancer Shop',
    description: 'Neutral and invulnerable. Lancers and Hunters heal here and buy or sell items.',
    size: 5,
    hp: 100000,
    buildTime: 1,
    cost: null,
    salvage: false,
    upgradable: false,
    hotkey: '',
  },
};

export const SURVIVAL_BUILD_MENU = ['generator', 'wall', 'turret', 'market', 'depot', 'autoMine', 'library', 'detector'];

// ------------------------------------------------------------------ Lancer shop
export const SHOP_CATEGORIES = [
  { id: 'weapon', name: 'Blades', stack: true },
  { id: 'gloves', name: 'Gloves', stack: false },
  { id: 'armor', name: 'Armor', stack: false },
  { id: 'life', name: 'Amulets', stack: true },
  { id: 'regen', name: 'Potions', stack: true },
  { id: 'boots', name: 'Boots', stack: false },
  { id: 'immune', name: 'Cloak of Immunity', stack: false },
  { id: 'sight', name: 'Ring of Sight', stack: false },
];

const ITEM_STATS = ['minerals', 'gas', 'damage', 'as', 'hp', 'regen', 'dr', 'speed', 'immune', 'sight', 'scanR', 'scanCd'];
export const SHOP_ITEMS = {};
export const SHOP_ORDER = {};
function item(cat, id, name, cost, stats) {
  const it = { id, name, cat };
  for (const k of ITEM_STATS) it[k] = 0;
  if (cost.endsWith('g')) it.gas = Number(cost.slice(0, -1));
  else it.minerals = Number(cost);
  Object.assign(it, stats);
  SHOP_ITEMS[id] = it;
  (SHOP_ORDER[cat] = SHOP_ORDER[cat] || []).push(id);
}

[
  ['Copper Blade', 2, 0, '100'],
  ['Iron Blade', 4, 0, '200'],
  ['Steel Blade', 8, 0, '400'],
  ['Silver Blade', 16, 0, '800'],
  ['Golden Blade', 32, 0, '1600'],
  ['Platinum Blade', 64, 0, '3200'],
  ['Mithril Blade', 128, 0, '6400'],
  ['Diamond Blade', 256, 0, '12800'],
  ['Pro Blade', 256, 4, '25600'],
  ['Energizer Blade', 1280, 4, '1g'],
  ['Pulverizer Blade', 2560, 4, '2g'],
  ['Atomizer Blade', 5120, 4, '8g'],
  ['Elucidator Blade', 20480, 4, '32g'],
  ['Ultimate Blade', 40960, 4, '96g'],
  ['Plutonium Blade', 61440, 4, '160g'],
  ['Radiant Blade', 81920, 4, '512g'],
  ['Final Blade', 260000, 24, '1536g'],
].forEach(([name, damage, as, cost], i) => item('weapon', `blade${i + 1}`, name, cost, { damage, as }));

[
  ['Cloth Gloves', 0.2, '100'],
  ['Leather Gloves', 0.4, '200'],
  ['Reinforced Hide Gloves', 0.8, '400'],
  ['Scale Gloves', 1, '800'],
  ['Bone Gloves', 1.5, '1600'],
  ['Electronic Gloves', 2, '3200'],
  ['Mega Gloves', 3, '6400'],
  ['Super Gloves', 4, '12800'],
].forEach(([name, as, cost], i) => item('gloves', `glove${i + 1}`, name, cost, { as }));

[
  ['Wooden Armor', 0.09, '100'],
  ['Reinforced Wooden Armor', 0.18, '200'],
  ['Iron Armor', 0.27, '400'],
  ['Steel Armor', 0.36, '800'],
  ['Silver Armor', 0.45, '1600'],
  ['Gold Armor', 0.54, '3200'],
  ['Platinum Armor', 0.63, '6400'],
  ['Titanium Armor', 0.72, '12800'],
  ['Chromite Armor', 0.92, '1g'],
  ['Pyrite Armor', 0.96, '2g'],
  ['Tungsten Armor', 0.98, '8g'],
  ['Nanocrystal Armor', 0.99, '32g'],
  ['Uranium Armor', 0.995, '128g'],
  ['Rubidium Armor', 0.9975, '256g'],
].forEach(([name, dr, cost], i) => item('armor', `armor${i + 1}`, name, cost, { dr }));

[
  ['Zircon Amulet', 250, '100'],
  ['Amethyst Amulet', 500, '200'],
  ['Topaz Amulet', 1000, '400'],
  ['Spinel Amulet', 2000, '800'],
  ['Sapphire Amulet', 4000, '1600'],
  ['Emerald Amulet', 8000, '3200'],
  ['Ruby Amulet', 16000, '6400'],
  ['Corundum Amulet', 32000, '12800'],
  ['Titanium Amulet', 160000, '1g'],
  ['Obsidian Amulet', 320000, '2g'],
  ['Diamond Amulet', 471000, '8g'],
].forEach(([name, hp, cost], i) => item('life', `life${i + 1}`, name, cost, { hp }));

[
  ['Minor Potion', 4, '100'],
  ['Lesser Potion', 8, '200'],
  ['Common Potion', 16, '400'],
  ['Greater Potion', 32, '800'],
  ['Superior Potion', 64, '1600'],
  ['Major Potion', 128, '3200'],
  ['Ultra Potion', 256, '6400'],
  ['Extreme Potion', 512, '12800'],
  ['Mega Potion', 2560, '1g'],
  ['Eternal Potion', 5120, '2g'],
  ['Ultimate Potion', 20480, '8g'],
  ['Final Potion', 61440, '256g'],
].forEach(([name, regen, cost], i) => item('regen', `regen${i + 1}`, name, cost, { regen }));

[
  ['Basic Boots 1', 1, 0, 0, 0, 0, '200'],
  ['Basic Boots 4', 1.3, 1.5, 0, 0, 0, '1600'],
  ['Advanced Boots 1', 1.4, 2, 0, 0, 0, '3200'],
  ['Advanced Boots 2', 1.5, 2.5, 0, 0, 0, '6400'],
  ['Advanced Boots 3', 1.6, 3, 0, 0, 0, '12800'],
  ['Magic Boots 1', 1.7, 3.5, 3.5, 13, 30, '1g'],
  ['Magic Boots 2', 1.8, 4, 7, 14, 30, '2g'],
  ['Magic Boots 3', 1.9, 4.5, 7, 15, 30, '8g'],
  ['Magic Boots 4', 2, 5, 7, 16, 30, '32g'],
  ['Legendary Boots 1', 2.1, 5.5, 7, 19, 25, '128g'],
  ['Legendary Boots 2', 2.2, 6, 7, 22, 20, '256g'],
  ['Legendary Boots 3', 2.3, 6.5, 7, 25, 15, '512g'],
].forEach(([name, speed, immune, sight, scanR, scanCd, cost], i) => item('boots', `boots${i + 1}`, name, cost, { speed, immune, sight, scanR, scanCd }));

item('immune', 'immune1', 'Cloak of Immunity', '200', { immune: 3 });
item('sight', 'sight1', 'Ring of Sight', '200', { sight: 7 });

export function itemCost(id) {
  const it = SHOP_ITEMS[id];
  if (!it) return { minerals: 0, gas: 0 };
  return { minerals: it.minerals, gas: it.gas };
}

export const LANCER_BASE = {
  lancer: { hp: 500, damage: 5, cooldown: 1, speed: 4.2, sight: 9 },
  hunter: { hp: 250, damage: 5, cooldown: 1, speed: 4.2, sight: 9 },
};

// Derived Lancer / Hunter stats from owned items (see spec §7.2)
export function lancerStats(items = [], base = 'lancer') {
  const B = LANCER_BASE[base] || LANCER_BASE.lancer;
  let damage = B.damage;
  let as = 0;
  let hp = B.hp;
  let regen = 0;
  let dr = 0;
  let speed = 0;
  let sight = 0;
  let immune = 0;
  let scanR = 0;
  let scanCd = 0;
  for (const id of items) {
    const it = SHOP_ITEMS[id];
    if (!it) continue;
    damage += it.damage;
    as = Math.max(as, it.as);
    hp += it.hp;
    regen += it.regen;
    dr = Math.max(dr, it.dr);
    speed = Math.max(speed, it.speed);
    sight = Math.max(sight, it.sight);
    immune = Math.max(immune, it.immune);
    if (it.scanR > scanR) {
      scanR = it.scanR;
      scanCd = it.scanCd;
    }
  }
  return {
    hp,
    regen,
    dr,
    damage,
    as,
    cooldown: B.cooldown / (1 + as),
    speed: B.speed + speed,
    sight: B.sight + sight,
    immune: 6 + immune,
    scanR: scanR || 13,
    scanCd: scanCd || 30,
  };
}

// ------------------------------------------------------------------ Abilities
const ab = (o) => ({ row: null, range: 0, cooldown: 0, duration: 0, passive: false, target: 'none', ...o });

export const SHAPER_ABILITIES = {
  stasis: ab({ id: 'stasis', name: 'Stasis Prison', row: 'control', range: 8, cooldown: 30, duration: 4, target: 'enemy', hotkey: 'Z', description: 'Locks a Lancer or Hunter in place for 4 s: it cannot move, attack, cast or be damaged. Afterwards it is immune to spells for a while.' }),
  overcharge: ab({ id: 'overcharge', name: 'Overcharge', row: 'control', range: 9, cooldown: 12, duration: 4, target: 'structure', hotkey: 'X', description: 'An own structure works 30% faster for 4 s (income, fire rate, build/upgrade speed, nearby miners).' }),
  barrierField: ab({ id: 'barrierField', name: 'Barrier Field', row: 'control', range: 9, cooldown: 20, duration: 4, target: 'point', hotkey: 'C', description: 'Places an impassable 2×2 barrier for 4 s.' }),
  invuln: ab({ id: 'invuln', name: 'Invulnerability', row: 'control', range: 9, cooldown: 30, duration: 4, target: 'own', hotkey: 'V', description: 'An own structure or your Shaper becomes invulnerable for 4 s.' }),
  blink: ab({ id: 'blink', name: 'Blink', row: 'mobility', range: 8, cooldown: 10, target: 'point', hotkey: 'B', description: 'Teleport up to 8 cells to a visible location, even up cliffs.' }),
  farBlink: ab({ id: 'farBlink', name: 'Far Blink', row: 'mobility', range: 8, cooldown: 30, target: 'point', hotkey: 'N', description: 'Teleport up to 8 cells; the destination does not need vision.' }),
  recall: ab({ id: 'recall', name: 'Recall', row: 'mobility', range: 30, cooldown: 45, target: 'structure', hotkey: 'R', description: 'Teleport next to an own structure within 30 cells.' }),
  swift: ab({ id: 'swift', name: 'Swiftness', row: 'mobility', passive: true, hotkey: '', description: 'Passive: +50% movement speed.' }),
  cloak: ab({ id: 'cloak', name: 'Cloak', row: 'mobility', cooldown: 45, duration: 10, hotkey: 'F', description: 'Invisible to enemies and +50% speed for 10 s.' }),
};
export const SHAPER_CONTROL = ['stasis', 'overcharge', 'barrierField', 'invuln'];
export const SHAPER_MOBILITY = ['blink', 'farBlink', 'recall', 'swift', 'cloak'];

export const LANCER_ABILITIES = {
  scan: ab({ id: 'scan', name: 'Scan', range: 0, cooldown: 30, duration: 12, target: 'point', hotkey: 'S', description: 'Reveals a circle (radius 13, more with Magic Boots) anywhere for 12 s, including cloaked units.' }),
  return: ab({ id: 'return', name: 'Return', cooldown: 180, hotkey: 'R', description: 'Instantly teleport back to the Shop.' }),
  cloak: ab({ id: 'cloak', name: 'Cloak', cooldown: 60, duration: 10, hotkey: 'C', description: 'Invisible (except to detectors and scans) and +50% speed for 10 s. Ends when you attack.' }),
};
export const HUNTER_ABILITY_IDS = ['return', 'cloak'];

export const SPIRIT_ABILITIES = {
  overcharge: ab({ id: 'overcharge', name: 'Overcharge', range: 9, cooldown: 12, duration: 4, target: 'structure', hotkey: 'X', description: 'An allied structure works 30% faster for 4 s.' }),
  decay: ab({ id: 'decay', name: 'Decay', range: 7, cooldown: 20, duration: 5, target: 'enemy', hotkey: 'D', description: 'A Lancer or Hunter strikes 50% slower for 5 s.' }),
  cloak: ab({ id: 'cloak', name: 'Cloak', cooldown: 30, duration: 10, hotkey: 'F', description: 'Invisible and +50% speed for 10 s.' }),
};

// ------------------------------------------------------------------ helpers
const TABLES = { generator: GENERATOR_LEVELS, wall: WALL_LEVELS, market: MARKET_LEVELS, turret: TURRET_LEVELS, autoMine: AUTOMINE_LEVELS };

export function levelTable(type) {
  return TABLES[type] || null;
}

// Total cost of levels 1..level of a table (array or type name)
export function cumulativeCost(table, level) {
  const t = typeof table === 'string' ? TABLES[table] : table;
  let gas = 0;
  let minerals = 0;
  if (!t) return { gas, minerals };
  for (let i = 0; i < Math.min(level, t.length); i++) {
    gas += t[i].gas || 0;
    minerals += t[i].minerals || 0;
  }
  return { gas, minerals };
}

export function requirementText(r) {
  if (!r) return '';
  if (r.type === 'wall') return `Needs ${wallName(r.level)}`;
  if (r.type === 'market') return r.level >= 3 ? 'Needs a Global Market' : r.level === 2 ? 'Needs an Underground Market' : 'Needs a Market';
  if (r.type === 'library') return 'Needs an Ancient Library';
  if (r.type === 'depot') return 'Needs a Collection Depot';
  return 'Requirement missing';
}
