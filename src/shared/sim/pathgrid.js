// Walkability grid + A* pathfinding with path smoothing.
import { CELL_PATHABLE, CELL_BUILDABLE } from '../maps/mapgen.js';

const SQRT2 = Math.SQRT2;
const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

export class PathGrid {
  constructor(map) {
    this.map = map;
    this.W = map.width;
    this.H = map.height;
    const N = this.W * this.H;
    this.flags = Uint8Array.from(map.flags);
    this.occ = new Int32Array(N); // entity id occupying cell (structures, resources, rubble, beacons)
    // A* scratch buffers
    this.g = new Float32Array(N);
    this.from = new Int32Array(N);
    this.seen = new Uint32Array(N);
    this.closed = new Uint32Array(N);
    this.gen = 1;
    this.heap = new Int32Array(N + 8);
    this.heapF = new Float32Array(N + 8);
    this.heapSize = 0;
    this.version = 0; // increments whenever occupancy changes
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.W && y < this.H;
  }

  pathable(x, y) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return false;
    const i = y * this.W + x;
    return (this.flags[i] & CELL_PATHABLE) !== 0 && this.occ[i] === 0;
  }

  terrainPathable(x, y) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return false;
    return (this.flags[y * this.W + x] & CELL_PATHABLE) !== 0;
  }

  buildable(x, y) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return false;
    const i = y * this.W + x;
    return (this.flags[i] & CELL_BUILDABLE) !== 0 && this.occ[i] === 0;
  }

  setRect(x, y, w, h, id) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (this.inBounds(xx, yy)) this.occ[yy * this.W + xx] = id;
      }
    }
    this.version++;
  }

  clearRect(x, y, w, h, id) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (!this.inBounds(xx, yy)) continue;
        const i = yy * this.W + xx;
        if (id === undefined || this.occ[i] === id) this.occ[i] = 0;
      }
    }
    this.version++;
  }

  // Nearest pathable cell (BFS ring search) to a world point.
  nearestFree(x, y, maxR = 16) {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (this.pathable(cx, cy)) return [cx, cy];
    let best = null;
    let bestD = Infinity;
    for (let r = 1; r <= maxR; r++) {
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue;
          const nx = cx + ox;
          const ny = cy + oy;
          if (!this.pathable(nx, ny)) continue;
          const dx = nx + 0.5 - x;
          const dy = ny + 0.5 - y;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = [nx, ny];
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  // Grid line-of-walk test between two world points (supercover traversal).
  lineWalkable(x0, y0, x1, y1) {
    let cx = Math.floor(x0);
    let cy = Math.floor(y0);
    const ex = Math.floor(x1);
    const ey = Math.floor(y1);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tMaxX = dx !== 0 ? (dx > 0 ? cx + 1 - x0 : x0 - cx) * tDeltaX : Infinity;
    let tMaxY = dy !== 0 ? (dy > 0 ? cy + 1 - y0 : y0 - cy) * tDeltaY : Infinity;
    let guard = 0;
    while (guard++ < 2000) {
      if (!this.pathable(cx, cy)) return false;
      if (cx === ex && cy === ey) return true;
      if (Math.abs(tMaxX - tMaxY) < 1e-9) {
        // passing exactly through a corner: both side cells must be free
        if (!this.pathable(cx + stepX, cy) || !this.pathable(cx, cy + stepY)) return false;
        cx += stepX;
        cy += stepY;
        tMaxX += tDeltaX;
        tMaxY += tDeltaY;
      } else if (tMaxX < tMaxY) {
        cx += stepX;
        tMaxX += tDeltaX;
      } else {
        cy += stepY;
        tMaxY += tDeltaY;
      }
    }
    return false;
  }

  // "Fat" line test: checks parallel offset lines so units with a radius don't clip corners.
  lineWalkableFat(x0, y0, x1, y1, r) {
    if (!this.lineWalkable(x0, y0, x1, y1)) return false;
    if (r <= 0.05) return true;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * r * 0.9;
    const ny = (dx / len) * r * 0.9;
    return (
      this.lineWalkable(x0 + nx, y0 + ny, x1 + nx, y1 + ny) && this.lineWalkable(x0 - nx, y0 - ny, x1 - nx, y1 - ny)
    );
  }

  _push(i, f) {
    let k = this.heapSize++;
    const h = this.heap;
    const hf = this.heapF;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hf[p] <= f) break;
      h[k] = h[p];
      hf[k] = hf[p];
      k = p;
    }
    h[k] = i;
    hf[k] = f;
  }

  _pop() {
    const h = this.heap;
    const hf = this.heapF;
    const top = h[0];
    const n = --this.heapSize;
    if (n > 0) {
      const li = h[n];
      const lf = hf[n];
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= lf) break;
        h[k] = h[c];
        hf[k] = hf[c];
        k = c;
      }
      h[k] = li;
      hf[k] = lf;
    }
    return top;
  }

  /**
   * Finds a path from world point (sx,sy) to (gx,gy).
   * opts.rect = {x,y,w,h}: stop next to this rectangle (for structures/resources).
   * opts.radius = unit radius for smoothing.
   * Returns array of [x,y] world waypoints (excluding start) or null.
   */
  findPath(sx, sy, gx, gy, opts = {}) {
    const W = this.W;
    const rect = opts.rect || null;
    const maxNodes = opts.maxNodes || 12000;
    let start = [Math.floor(sx), Math.floor(sy)];
    if (!this.pathable(start[0], start[1])) {
      const nf = this.nearestFree(sx, sy, 4);
      if (!nf) return null;
      start = nf;
    }
    let goalCell = null;
    let goalX = gx;
    let goalY = gy;
    if (!rect) {
      const gcx = Math.floor(gx);
      const gcy = Math.floor(gy);
      if (this.pathable(gcx, gcy)) goalCell = [gcx, gcy];
      else {
        goalCell = this.nearestFree(gx, gy, 24);
        if (!goalCell) return null;
        goalX = goalCell[0] + 0.5;
        goalY = goalCell[1] + 0.5;
      }
    }
    const pad = rect ? opts.pad ?? 1 : 0;
    const isGoal = (x, y) => {
      if (rect) {
        return x >= rect.x - pad && x < rect.x + rect.w + pad && y >= rect.y - pad && y < rect.y + rect.h + pad;
      }
      return x === goalCell[0] && y === goalCell[1];
    };
    const heur = (x, y) => {
      let dx;
      let dy;
      if (rect) {
        const px = x + 0.5;
        const py = y + 0.5;
        dx = Math.max(rect.x - px, 0, px - (rect.x + rect.w));
        dy = Math.max(rect.y - py, 0, py - (rect.y + rect.h));
      } else {
        dx = Math.abs(x - goalCell[0]);
        dy = Math.abs(y - goalCell[1]);
      }
      const mn = Math.min(dx, dy);
      return (dx + dy + (SQRT2 - 2) * mn) * 1.001;
    };

    this.gen++;
    if (this.gen > 0xfffffff0) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    const gen = this.gen;
    const g = this.g;
    const from = this.from;
    const seen = this.seen;
    const closed = this.closed;
    this.heapSize = 0;
    const si = start[1] * W + start[0];
    g[si] = 0;
    from[si] = -1;
    seen[si] = gen;
    this._push(si, heur(start[0], start[1]));
    let bestI = si;
    let bestH = heur(start[0], start[1]);
    let found = -1;
    let expanded = 0;
    while (this.heapSize > 0) {
      const ci = this._pop();
      if (closed[ci] === gen) continue;
      closed[ci] = gen;
      const cx = ci % W;
      const cy = (ci - cx) / W;
      if (isGoal(cx, cy)) {
        found = ci;
        break;
      }
      if (++expanded > maxNodes) break;
      const cg = g[ci];
      for (let d = 0; d < 8; d++) {
        const [ox, oy, cost] = DIRS[d];
        const nx = cx + ox;
        const ny = cy + oy;
        if (!this.pathable(nx, ny)) continue;
        if (ox !== 0 && oy !== 0) {
          if (!this.pathable(cx + ox, cy) || !this.pathable(cx, cy + oy)) continue;
        }
        const ni = ny * W + nx;
        if (closed[ni] === gen) continue;
        const ng = cg + cost;
        if (seen[ni] !== gen || ng < g[ni]) {
          seen[ni] = gen;
          g[ni] = ng;
          from[ni] = ci;
          const h = heur(nx, ny);
          if (h < bestH) {
            bestH = h;
            bestI = ni;
          }
          this._push(ni, ng + h);
        }
      }
    }
    const endI = found >= 0 ? found : bestI;
    const cells = [];
    let k = endI;
    let guard = 0;
    while (k !== -1 && guard++ < 100000) {
      cells.push(k);
      if (k === si) break;
      k = from[k];
    }
    cells.reverse();
    const pts = cells.map((ci) => {
      const x = ci % W;
      return [x + 0.5, (ci - x) / W + 0.5];
    });
    // final exact goal point if reachable cell matches
    if (found >= 0 && !rect && pts.length) {
      pts[pts.length - 1] = [goalX, goalY];
    }
    return this.smooth(sx, sy, pts, opts.radius || 0.4, found >= 0);
  }

  smooth(sx, sy, pts, r) {
    if (pts.length === 0) return [];
    const out = [];
    let cx = sx;
    let cy = sy;
    let i = 0;
    while (i < pts.length) {
      // farthest visible point from current
      let j = pts.length - 1;
      while (j > i) {
        if (this.lineWalkableFat(cx, cy, pts[j][0], pts[j][1], r)) break;
        j--;
      }
      out.push(pts[j]);
      cx = pts[j][0];
      cy = pts[j][1];
      i = j + 1;
    }
    return out;
  }
}
