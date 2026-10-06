import { describe, it, expect } from 'vitest';
import { MAP_DESCRIPTIONS, getMap, listMaps } from '../src/shared/maps/index.js';
import { PathGrid } from '../src/shared/sim/pathgrid.js';
import { CELL_BUILDABLE, CELL_PATHABLE, symmetricPoints } from '../src/shared/maps/mapgen.js';

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

  it('keeps the 5x5 Shop footprint at the centre free', () => {
    const bx = Math.floor(map.cage.x) - 2;
    const by = Math.floor(map.cage.y) - 2;
    for (let y = by; y < by + 5; y++) for (let x = bx; x < bx + 5; x++) expect(map.flags[y * map.width + x] & CELL_PATHABLE).toBeTruthy();
    for (const r of map.resources) expect(r.x + r.w <= bx - 2 || r.x >= bx + 7 || r.y + r.h <= by - 2 || r.y >= by + 7).toBe(true);
  });

  it('has 2-4 gold groves near the Shop, outside the Shaper spawn ring', () => {
    const gold = map.groves.filter((g) => g.rich);
    expect(gold.length).toBeGreaterThanOrEqual(2);
    expect(gold.length).toBeLessThanOrEqual(4);
    for (const g of gold) {
      const d = Math.hypot(g.x - map.cage.x, g.y - map.cage.y);
      expect(d).toBeLessThan(32);
      expect(d).toBeGreaterThan(21); // spawn ring (<= 9) + gold lock (10) + field size
    }
  });

  it('ramps are 4 wide and buildable: a 2x2 Wall in the middle stops the Lancer, not the Shapers', () => {
    const desc = MAP_DESCRIPTIONS.find((d) => d.id === id);
    const grid = new PathGrid(map);
    for (const r of map.resources) grid.setRect(r.x, r.y, r.w, r.h, 1);
    for (const r of desc.ramps) {
      const A = symmetricPoints(desc.symmetry, desc.width, desc.height, r.x, r.y);
      const B = symmetricPoints(desc.symmetry, desc.width, desc.height, r.x2, r.y2);
      for (let k = 0; k < A.length; k++) {
        const [x0, y0] = A[k];
        const [x1, y1] = B[k];
        const vertical = x0 === x1;
        expect(vertical || y0 === y1, 'ramps are axis-aligned').toBe(true);
        const c = vertical ? x0 : y0; // integer centre line: cells c-2 .. c+1
        const dir = Math.sign(vertical ? y1 - y0 : x1 - x0);
        const lo = Math.min(vertical ? y0 : x0, vertical ? y1 : x1);
        const hi = Math.max(vertical ? y0 : x0, vertical ? y1 : x1);
        const free = (a, o) => (vertical ? grid.pathable(c + o, a) : grid.pathable(a, c + o));
        // the cross-sections nearest the middle of the ramp with exactly 4 walkable cells between cliffs
        const ok = (q) => !free(q, -3) && free(q, -2) && free(q, -1) && free(q, 0) && free(q, 1) && !free(q, 2);
        let choke = -1;
        for (let a = lo; a < hi; a++) {
          if (!(ok(a - 1) && ok(a) && ok(a + 1) && ok(a + 2))) continue;
          if (choke < 0 || Math.abs(a + 1 - (lo + hi) / 2) < Math.abs(choke + 1 - (lo + hi) / 2)) choke = a;
        }
        expect(choke, `ramp ${x0},${y0} has a 4-wide choke`).toBeGreaterThanOrEqual(0);
        const wx = vertical ? c - 1 : choke;
        const wy = vertical ? choke : c - 1;
        for (let y = wy; y < wy + 2; y++) for (let x = wx; x < wx + 2; x++) expect(map.flags[y * map.width + x] & CELL_BUILDABLE).toBeTruthy();
        const sx = vertical ? x0 : x0 - dir * 3;
        const sy = vertical ? y0 - dir * 3 : y0;
        const gx = vertical ? x1 : x1 + dir * 4;
        const gy = vertical ? y1 + dir * 4 : y1;
        expect(grid.findPath(sx, sy, gx, gy, { clearance: 2, maxNodes: 60000 }).partial).toBe(false);
        grid.setRect(wx, wy, 2, 2, 9);
        expect(grid.findPath(sx, sy, gx, gy, { clearance: 2, maxNodes: 60000 }).partial).toBe(true);
        const small = grid.findPath(sx, sy, gx, gy, { maxNodes: 60000 });
        const end = small[small.length - 1];
        expect(Math.hypot(end[0] - gx, end[1] - gy)).toBeLessThan(1);
        grid.clearRect(wx, wy, 2, 2, 9);
      }
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
