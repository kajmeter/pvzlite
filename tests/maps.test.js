import { describe, it, expect } from 'vitest';
import { MAP_DESCRIPTIONS, getMap, listMaps } from '../src/shared/maps/index.js';
import { PathGrid } from '../src/shared/sim/pathgrid.js';
import { CELL_BUILDABLE } from '../src/shared/maps/mapgen.js';

describe.each(MAP_DESCRIPTIONS.filter((d) => d.mode === 'survival').map((d) => [d.id]))('survival map %s', (id) => {
  const map = getMap(id);

  it('has builder spawns, groves and a cage', () => {
    expect(map.mode).toBe('survival');
    expect(map.builderSpawns.length + map.hunterSlots).toBeGreaterThanOrEqual(map.players);
    expect(map.groves.length).toBeGreaterThanOrEqual(10);
    expect(map.resources.filter((r) => r.kind === 'crystal').length).toBeGreaterThanOrEqual(30);
  });

  it('every spawn and grove is reachable from the hunter cage', () => {
    const grid = new PathGrid(map);
    for (const r of map.resources) grid.setRect(r.x, r.y, r.w, r.h, 1);
    const c = map.cage;
    expect(grid.pathable(Math.floor(c.x), Math.floor(c.y))).toBe(true);
    for (const p of [...map.builderSpawns, ...map.groves]) {
      const path = grid.findPath(c.x, c.y, p.x, p.y, { maxNodes: 60000 });
      expect(path, `${p.x},${p.y}`).toBeTruthy();
      const end = path[path.length - 1];
      expect(Math.hypot(end[0] - p.x, end[1] - p.y), `${p.x},${p.y} reachable`).toBeLessThan(4.5);
    }
  });
});

describe.each(MAP_DESCRIPTIONS.filter((d) => !d.mode || d.mode === 'classic').map((d) => [d.id]))('map %s', (id) => {
  const map = getMap(id);

  it('has the advertised number of start locations', () => {
    expect(map.starts).toHaveLength(map.players);
  });

  it('every base has crystal fields and town-hall space', () => {
    for (const b of map.bases) {
      const crystals = b.resources.map((i) => map.resources[i]).filter((r) => r.kind === 'crystal');
      expect(crystals.length).toBeGreaterThanOrEqual(5);
      for (let y = b.ty; y < b.ty + 5; y++) {
        for (let x = b.tx; x < b.tx + 5; x++) {
          expect(map.flags[y * map.width + x] & CELL_BUILDABLE).toBeTruthy();
        }
      }
    }
  });

  it('resources never overlap', () => {
    const seen = new Set();
    for (const r of map.resources) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const k = `${x},${y}`;
          expect(seen.has(k)).toBe(false);
          seen.add(k);
        }
      }
    }
  });

  it('all bases are reachable from the first start location', () => {
    const grid = new PathGrid(map);
    for (const r of map.resources) grid.setRect(r.x, r.y, r.w, r.h, 1);
    const s = map.bases[map.starts[0]];
    for (const b of map.bases) {
      const path = grid.findPath(s.x, s.y + 3.5, b.x, b.y + 3.5, { maxNodes: 60000 });
      expect(path, `base ${b.id}`).toBeTruthy();
      const end = path[path.length - 1];
      expect(Math.hypot(end[0] - b.x, end[1] - (b.y + 3.5)), `base ${b.id} reachable`).toBeLessThan(2);
    }
  });
});

describe('map list', () => {
  it('lists all maps with metadata', () => {
    const maps = listMaps('classic');
    expect(maps.length).toBeGreaterThanOrEqual(5);
    expect(maps.some((m) => m.players === 4)).toBe(true);
    expect(listMaps('survival').length).toBeGreaterThanOrEqual(3);
  });
});

describe('pathfinding', () => {
  it('finds straight paths across open ground and around obstacles', () => {
    const map = getMap('proving');
    const grid = new PathGrid(map);
    const a = map.bases[map.starts[0]];
    const b = map.bases[map.starts[1]];
    const path = grid.findPath(a.x, a.y + 4, b.x, b.y - 4);
    expect(path.length).toBeGreaterThan(0);
    // path never crosses blocked cells
    let px = a.x;
    let py = a.y + 4;
    for (const [x, y] of path) {
      expect(grid.lineWalkable(px, py, x, y)).toBe(true);
      px = x;
      py = y;
    }
  });
});
