// Original pvzlite maps. Each description is expanded symmetrically by mapgen.
import { generateMap } from './mapgen.js';

const D = (deg) => (deg * Math.PI) / 180;

export const MAP_DESCRIPTIONS = [
  // ---------------------------------------------------------------- survival maps (pvzlite mode)
  // Layout rules (docs/design/pvz-mode.md §2): Lancer Shop at `cage` (map centre), plateau bases with
  // a single 4-wide buildable ramp (axis-aligned, integer centre line) and a grove inside, corner
  // bases far from the Shop, open-field groves and 2-4 gold (rich) groves ~25 cells from the Shop.
  {
    id: 'wilds',
    name: 'Crystal Wilds',
    mode: 'survival',
    description: 'Open jungle clearings full of crystal groves, with a walled highland base in every corner — one ramp each. Wall it and hide.',
    theme: 'verdant',
    players: 10,
    hunterSlots: 1,
    width: 128,
    height: 128,
    symmetry: 'rotate90',
    seed: 101,
    cage: { x: 64, y: 64 },
    plateaus: [{ x: 27, y: 27, r: 14, level: 1, rough: 1.1 }],
    ramps: [{ x: 30, y: 48, x2: 30, y2: 39, from: 0, to: 1, width: 4 }],
    chasms: [
      { x: 64, y: 43, r: 3 },
      { x: 13, y: 52, r: 2.5 },
    ],
    groves: [
      { x: 22, y: 23, n: 4 },
      { x: 33, y: 21, n: 3 },
      { x: 46, y: 12, n: 3 },
      { x: 14, y: 42, n: 3 },
      { x: 46, y: 46, n: 3, rich: true },
    ],
    builderSpawns: [
      { x: 27, y: 31 },
      { x: 46, y: 18 },
      { x: 18, y: 46 },
    ],
  },
  {
    id: 'expanse',
    name: 'Frozen Expanse',
    mode: 'survival',
    description: 'Wide snowfields between glacier plateaus. Every shelf has one ramp; the gold groves glitter dangerously close to the Shop.',
    theme: 'frost',
    players: 10,
    hunterSlots: 1,
    width: 120,
    height: 120,
    symmetry: 'rotate180',
    seed: 113,
    cage: { x: 60, y: 60 },
    plateaus: [
      { x: 27, y: 28, r: 14, level: 1, rough: 1.2 },
      { x: 19, y: 88, r: 9, level: 2, rough: 0.8 },
      { x: 64, y: 16, r: 8, level: 1, rough: 0.6 },
    ],
    ramps: [
      { x: 28, y: 50, x2: 28, y2: 41, from: 0, to: 1, width: 4 },
      { x: 36, y: 88, x2: 27, y2: 88, from: 0, to: 2, width: 4 },
      { x: 64, y: 31, x2: 64, y2: 23, from: 0, to: 1, width: 4 },
    ],
    chasms: [
      { x: 60, y: 45, r: 3.5 },
      { x: 10, y: 66, r: 3 },
      { x: 84, y: 20, r: 3 },
    ],
    groves: [
      { x: 22, y: 24, n: 4 },
      { x: 33, y: 33, n: 3 },
      { x: 18, y: 88, n: 3 },
      { x: 64, y: 14, n: 3 },
      { x: 37, y: 60, n: 3, rich: true },
      { x: 12, y: 56, n: 2 },
      { x: 80, y: 42, n: 2 },
      { x: 44, y: 104, n: 3 },
    ],
    builderSpawns: [
      { x: 27, y: 31 },
      { x: 20, y: 85 },
      { x: 64, y: 18 },
      { x: 12, y: 50 },
      { x: 42, y: 18 },
    ],
  },
  {
    id: 'labyrinth',
    name: 'Molten Labyrinth',
    mode: 'survival',
    description: 'Lava rivers carve the land into pockets. Few entrances, many dead ends — wall the gaps and survive.',
    theme: 'ember',
    players: 10,
    hunterSlots: 1,
    width: 112,
    height: 112,
    symmetry: 'rotate90',
    seed: 127,
    cage: { x: 56, y: 56 },
    cageRadius: 5,
    plateaus: [{ x: 22, y: 22, r: 11, level: 1, rough: 0.9 }],
    ramps: [{ x: 41, y: 24, x2: 32, y2: 24, from: 0, to: 1, width: 4 }],
    chasms: [
      { shape: 'rect', x: 56, y: 28, w: 5, h: 22, type: 'pit' },
      { shape: 'rect', x: 34, y: 45, w: 18, h: 4, type: 'pit' },
      { x: 18, y: 52, r: 3, type: 'pit' },
    ],
    groves: [
      { x: 19, y: 19, n: 4 },
      { x: 44, y: 14, n: 3 },
      { x: 12, y: 40, n: 3 },
      { x: 40, y: 34, n: 2, rich: true },
      { x: 28, y: 60, n: 2 },
    ],
    builderSpawns: [
      { x: 22, y: 27 },
      { x: 44, y: 22 },
      { x: 12, y: 33 },
    ],
  },

  // ---------------------------------------------------------------- classic RTS maps
  {
    id: 'frostgate',
    name: 'Frostgate Ruins',
    description: 'Frozen highland fortresses. Classic layout: high-ground main, mid-ground natural and a central beacon hill.',
    theme: 'frost',
    players: 2,
    width: 128,
    height: 128,
    symmetry: 'rotate180',
    seed: 11,
    plateaus: [
      { x: 24, y: 58, r: 15, level: 1 },
      { x: 24, y: 24, r: 18, level: 2, rough: 1.4 },
      { x: 64, y: 64, r: 10, level: 1, nosym: true },
    ],
    ramps: [
      { x: 32, y: 46, x2: 30, y2: 38, from: 1, to: 2, width: 4 },
      { x: 44, y: 64, x2: 36, y2: 62, from: 0, to: 1, width: 5 },
      { x: 50, y: 58, x2: 56, y2: 61, from: 0, to: 1, width: 4 },
    ],
    chasms: [
      { x: 64, y: 38, r: 5 },
      { x: 46, y: 36, r: 3.5 },
      { x: 96, y: 54, r: 4 },
    ],
    bases: [
      { x: 21, y: 21, dir: D(-135), start: true },
      { x: 20, y: 62, dir: D(180) },
      { x: 60, y: 16, dir: D(-90) },
      { x: 16, y: 100, dir: D(160) },
    ],
    beacons: [{ x: 64, y: 64, nosym: true }],
  },
  {
    id: 'ember',
    name: 'Ember Crossing',
    description: 'A molten rift splits the battlefield. Fight over the bridges and the central beacon plateau.',
    theme: 'ember',
    players: 2,
    width: 112,
    height: 112,
    symmetry: 'mirrorX',
    seed: 23,
    plateaus: [
      { x: 25, y: 24, r: 13, level: 1 },
      { x: 18, y: 56, r: 16, level: 2, rough: 1.2 },
      { x: 56, y: 56, r: 9, level: 1, nosym: true },
    ],
    ramps: [
      { x: 25, y: 34, x2: 24, y2: 43, from: 1, to: 2, width: 4 },
      { x: 40, y: 34, x2: 34, y2: 30, from: 0, to: 1, width: 5 },
      { x: 44, y: 56, x2: 49, y2: 56, from: 0, to: 1, width: 4 },
    ],
    chasms: [
      { shape: 'rect', x: 56, y: 18, w: 7, h: 30, nosym: true, type: 'pit' },
      { shape: 'rect', x: 56, y: 94, w: 7, h: 30, nosym: true, type: 'pit' },
      { x: 38, y: 78, r: 4 },
    ],
    bases: [
      { x: 13, y: 56, dir: D(180), start: true },
      { x: 21, y: 20, dir: D(-120) },
      { x: 20, y: 94, dir: D(120) },
      { x: 42, y: 102, dir: D(90) },
    ],
    beacons: [{ x: 56, y: 56, nosym: true }],
  },
  {
    id: 'verdant',
    name: 'Verdant Hollow',
    description: 'Overgrown temple terraces with many expansions and two flanking beacons. Great for macro games.',
    theme: 'verdant',
    players: 2,
    width: 136,
    height: 136,
    symmetry: 'rotate180',
    seed: 37,
    plateaus: [
      { x: 54, y: 24, r: 13, level: 1 },
      { x: 24, y: 24, r: 17, level: 2, rough: 1.5 },
      { x: 68, y: 68, r: 10, level: 1, nosym: true },
    ],
    ramps: [
      { x: 44, y: 30, x2: 37, y2: 30, from: 1, to: 2, width: 4 },
      { x: 61, y: 41, x2: 58, y2: 33, from: 0, to: 1, width: 5 },
      { x: 56, y: 62, x2: 61, y2: 64, from: 0, to: 1, width: 4 },
    ],
    chasms: [
      { x: 38, y: 50, r: 4.5 },
      { x: 84, y: 26, r: 4 },
      { x: 30, y: 90, r: 5 },
    ],
    bases: [
      { x: 21, y: 21, dir: D(-135), start: true },
      { x: 56, y: 20, dir: D(-90) },
      { x: 18, y: 66, dir: D(180) },
      { x: 22, y: 112, dir: D(135), rich: true, fields: 6, vents: 1 },
    ],
    beacons: [{ x: 48, y: 90 }],
  },
  {
    id: 'quarry',
    name: 'Quartz Quarry',
    description: 'Four-player sandstone quarry. Every fortress has a natural; the centre plateau beacon watches all approaches.',
    theme: 'desert',
    players: 4,
    width: 152,
    height: 152,
    symmetry: 'rotate90',
    seed: 51,
    plateaus: [
      { x: 25, y: 57, r: 13, level: 1 },
      { x: 24, y: 24, r: 17, level: 2, rough: 1.3 },
      { x: 76, y: 76, r: 14, level: 1, nosym: true },
    ],
    ramps: [
      { x: 29, y: 47, x2: 29, y2: 38, from: 1, to: 2, width: 4 },
      { x: 43, y: 62, x2: 36, y2: 60, from: 0, to: 1, width: 5 },
      { x: 60, y: 70, x2: 65, y2: 72, from: 0, to: 1, width: 4 },
    ],
    chasms: [{ x: 40, y: 80, r: 5 }],
    bases: [
      { x: 21, y: 21, dir: D(-135), start: true },
      { x: 19, y: 60, dir: D(180) },
      { x: 62, y: 15, dir: D(-90) },
    ],
    rubble: [{ x: 52, y: 44 }],
    beacons: [{ x: 76, y: 76, nosym: true }],
  },
  {
    id: 'proving',
    name: 'Proving Grounds',
    description: 'A compact orbital platform for fast games: one fortress, one natural, short rush distance.',
    theme: 'void',
    players: 2,
    width: 96,
    height: 96,
    symmetry: 'rotate180',
    seed: 71,
    plateaus: [{ x: 20, y: 20, r: 15, level: 1, rough: 1 }],
    ramps: [{ x: 26, y: 41, x2: 24, y2: 33, from: 0, to: 1, width: 4 }],
    chasms: [
      { x: 48, y: 30, r: 5 },
      { x: 30, y: 70, r: 4 },
    ],
    bases: [
      { x: 18, y: 18, dir: D(-135), start: true },
      { x: 13, y: 54, dir: D(180) },
    ],
    beacons: [{ x: 48, y: 48, nosym: true }],
  },
];

const cache = new Map();

export function getMap(id) {
  if (cache.has(id)) return cache.get(id);
  const desc = MAP_DESCRIPTIONS.find((m) => m.id === id);
  if (!desc) throw new Error(`Unknown map: ${id}`);
  const map = generateMap(desc);
  cache.set(id, map);
  return map;
}

export function listMaps(mode) {
  return MAP_DESCRIPTIONS.filter((m) => !mode || (m.mode || 'classic') === mode || (mode === 'survival' && !m.mode)).map((m) => ({
    mode: m.mode || 'classic',
    id: m.id,
    name: m.name,
    description: m.description,
    players: m.players,
    width: m.width,
    height: m.height,
    theme: m.theme,
  }));
}
