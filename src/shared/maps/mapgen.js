// Map generator: turns a compact, symmetric map description into terrain grids,
// resource placements and start locations used by the simulation and renderer.
import {
  LEVEL_HEIGHT,
  CRYSTAL_FIELD_RICH,
  CRYSTAL_FIELD_POOR,
  VENT_AMOUNT,
} from '../constants.js';

export const CELL_PATHABLE = 1;
export const CELL_BUILDABLE = 2;
export const CELL_RAMP = 4;
export const CELL_CLIFF = 8;

// Symmetry helpers ----------------------------------------------------------

export function symmetricPoints(sym, w, h, x, y) {
  switch (sym) {
    case 'rotate180':
      return [
        [x, y],
        [w - x, h - y],
      ];
    case 'mirrorX':
      return [
        [x, y],
        [w - x, y],
      ];
    case 'mirrorDiag':
      return [
        [x, y],
        [h - y, w - x],
      ];
    case 'rotate90':
      return [
        [x, y],
        [w - y, x],
        [w - x, h - y],
        [y, h - x],
      ];
    default:
      return [[x, y]];
  }
}

function symmetricAngles(sym, a) {
  switch (sym) {
    case 'rotate180':
      return [a, a + Math.PI];
    case 'mirrorX':
      return [a, Math.PI - a];
    case 'mirrorDiag': {
      // reflection across the anti-diagonal: (dx,dy) -> (-dy,-dx)
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      return [a, Math.atan2(-dx, -dy)];
    }
    case 'rotate90':
      return [a, a + Math.PI / 2, a + Math.PI, a + (3 * Math.PI) / 2];
    default:
      return [a];
  }
}

// Expands each feature in a list into its symmetric copies.
function expandFeatures(sym, w, h, features) {
  const out = [];
  for (const f of features) {
    if (f.nosym) {
      out.push(f);
      continue;
    }
    const pts = symmetricPoints(sym, w, h, f.x, f.y);
    const pts2 = f.x2 !== undefined ? symmetricPoints(sym, w, h, f.x2, f.y2) : null;
    const angs = f.dir !== undefined ? symmetricAngles(sym, f.dir) : null;
    for (let i = 0; i < pts.length; i++) {
      const c = { ...f, x: pts[i][0], y: pts[i][1], symIndex: i };
      if (pts2) {
        c.x2 = pts2[i][0];
        c.y2 = pts2[i][1];
      }
      if (angs) c.dir = angs[i];
      out.push(c);
    }
  }
  // drop exact duplicates (features on the symmetry center)
  const seen = new Set();
  return out.filter((f) => {
    const k = `${f.kind}|${f.x.toFixed(2)}|${f.y.toFixed(2)}|${f.x2}|${f.y2}|${f.level}|${f.r}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Deterministic hash noise
export function hash2(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function valueNoise(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, y, seed = 0, oct = 4) {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += amp * valueNoise(x * f, y * f, seed + i * 17);
    f *= 2;
    amp *= 0.5;
  }
  return s;
}

function inShape(f, x, y) {
  // x,y = cell center
  if (f.shape === 'rect') {
    return x >= f.x - f.w / 2 && x <= f.x + f.w / 2 && y >= f.y - f.h / 2 && y <= f.y + f.h / 2;
  }
  // irregular circle: radius modulated with noise for organic plateaus
  const dx = x - f.x;
  const dy = y - f.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  let r = f.r;
  if (f.rough !== 0) {
    const ang = Math.atan2(dy, dx);
    const rough = f.rough === undefined ? 1.2 : f.rough;
    r += (valueNoise(Math.cos(ang) * 2 + f.x * 0.1, Math.sin(ang) * 2 + f.y * 0.1, 7) - 0.5) * 2 * rough;
  }
  return d <= r;
}

// Builds a full map object from a description. Result is plain data (serializable).
export function generateMap(desc) {
  const W = desc.width;
  const H = desc.height;
  const sym = desc.symmetry || 'none';
  const N = W * H;
  const level = new Uint8Array(N); // integer level (vision)
  const height = new Float32Array(N); // continuous height
  const flags = new Uint8Array(N);
  const isRamp = new Uint8Array(N);
  const blocked = new Uint8Array(N); // static unpathable doodads / chasms
  const baseLevel = desc.baseLevel || 0;
  level.fill(baseLevel);

  const plateaus = expandFeatures(sym, W, H, (desc.plateaus || []).map((p) => ({ kind: 'plateau', ...p })));
  const ramps = expandFeatures(sym, W, H, (desc.ramps || []).map((p) => ({ kind: 'ramp', ...p })));
  const chasms = expandFeatures(sym, W, H, (desc.chasms || []).map((p) => ({ kind: 'chasm', ...p })));
  const basesRaw = expandFeatures(sym, W, H, (desc.bases || []).map((p) => ({ kind: 'base', ...p })));
  const beaconsRaw = expandFeatures(sym, W, H, (desc.beacons || []).map((p) => ({ kind: 'beacon', ...p })));
  const rubbleRaw = expandFeatures(sym, W, H, (desc.rubble || []).map((p) => ({ kind: 'rubble', ...p })));
  const grovesRaw = expandFeatures(sym, W, H, (desc.groves || []).map((p) => ({ kind: 'grove', ...p })));
  const spawnsRaw = expandFeatures(sym, W, H, (desc.builderSpawns || []).map((p) => ({ kind: 'spawn', ...p })));

  // 1. plateaus in order (later ones override)
  for (const p of plateaus) {
    const r = (p.r || Math.max(p.w, p.h)) + 3;
    const x0 = Math.max(0, Math.floor(p.x - r));
    const x1 = Math.min(W - 1, Math.ceil(p.x + r));
    const y0 = Math.max(0, Math.floor(p.y - r));
    const y1 = Math.min(H - 1, Math.ceil(p.y + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (inShape(p, x + 0.5, y + 0.5)) level[y * W + x] = p.level;
      }
    }
  }
  for (let i = 0; i < N; i++) height[i] = level[i] * LEVEL_HEIGHT;

  // 2. ramps: (x,y) bottom point, (x2,y2) top point, width
  for (const r of ramps) {
    const dx = r.x2 - r.x;
    const dy = r.y2 - r.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const ux = dx / len;
    const uy = dy / len;
    const hw = (r.width || 4) / 2;
    const lowH = r.from * LEVEL_HEIGHT;
    const highH = r.to * LEVEL_HEIGHT;
    const x0 = Math.max(1, Math.floor(Math.min(r.x, r.x2) - hw - 2));
    const x1 = Math.min(W - 2, Math.ceil(Math.max(r.x, r.x2) + hw + 2));
    const y0 = Math.max(1, Math.floor(Math.min(r.y, r.y2) - hw - 2));
    const y1 = Math.min(H - 2, Math.ceil(Math.max(r.y, r.y2) + hw + 2));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - r.x;
        const py = y + 0.5 - r.y;
        const along = px * ux + py * uy;
        const across = -px * uy + py * ux;
        if (along >= 0 && along <= len && Math.abs(across) <= hw) {
          const t = along / len;
          const i = y * W + x;
          isRamp[i] = 1;
          height[i] = lowH + (highH - lowH) * t;
          level[i] = t > 0.85 ? r.to : r.from;
        }
      }
    }
  }

  // 3. chasms / obstacles (unpathable doodad areas)
  for (const c of chasms) {
    const rr = (c.r || Math.max(c.w, c.h)) + 3;
    const x0 = Math.max(0, Math.floor(c.x - rr));
    const x1 = Math.min(W - 1, Math.ceil(c.x + rr));
    const y0 = Math.max(0, Math.floor(c.y - rr));
    const y1 = Math.min(H - 1, Math.ceil(c.y + rr));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (inShape(c, x + 0.5, y + 0.5)) blocked[y * W + x] = c.type === 'pit' ? 2 : 1;
      }
    }
  }

  // 4. cliff detection
  const cliff = new Uint8Array(N);
  const DROP = LEVEL_HEIGHT * 0.45;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (isRamp[i]) continue;
      const h0 = height[i];
      let isCliff = false;
      for (let oy = -1; oy <= 1 && !isCliff; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (isRamp[j]) {
            // low cells beside a ramp become side walls
            if (height[j] - h0 > DROP) {
              isCliff = true;
              break;
            }
            continue;
          }
          if (h0 - height[j] > DROP) {
            isCliff = true;
            break;
          }
        }
      }
      if (isCliff) cliff[i] = 1;
    }
  }

  // 5. flags
  // Survival maps: ramps are buildable (a 2x2 Wall in the middle of a 4-wide ramp leaves 1-cell
  // gaps that Shapers fit through but the 2-cell-wide Lancer does not).
  const survival = desc.mode === 'survival';
  const border = desc.border || 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let f = 0;
      const edge = x < border || y < border || x >= W - border || y >= H - border;
      if (!edge && !cliff[i] && !blocked[i]) {
        f |= CELL_PATHABLE;
        if (!isRamp[i] || survival) f |= CELL_BUILDABLE;
      }
      if (isRamp[i]) f |= CELL_RAMP;
      if (cliff[i]) f |= CELL_CLIFF;
      flags[i] = f;
    }
  }
  // Cells next to ramps are not buildable (keeps ramps from being walled entirely by mistake)
  for (let y = 1; y < H - 1 && !survival; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!(flags[i] & CELL_BUILDABLE)) continue;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (isRamp[(y + oy) * W + x + ox]) flags[i] &= ~CELL_BUILDABLE;
        }
      }
    }
  }

  // 6. bases and resources
  const resources = [];
  const bases = [];
  const occupied = new Uint8Array(N);
  const markRect = (x, y, w, h) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) occupied[yy * W + xx] = 1;
  };
  const rectFree = (x, y, w, h) => {
    if (x < 1 || y < 1 || x + w >= W - 1 || y + h >= H - 1) return false;
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        const i = yy * W + xx;
        if (occupied[i] || !(flags[i] & CELL_BUILDABLE)) return false;
      }
    return true;
  };

  basesRaw.forEach((b, bi) => {
    // town hall top-left cell
    const tx = Math.round(b.x - 2.5);
    const ty = Math.round(b.y - 2.5);
    const cx = tx + 2.5;
    const cy = ty + 2.5;
    const base = {
      id: bi,
      x: cx,
      y: cy,
      tx,
      ty,
      start: !!b.start,
      startIndex: -1,
      dir: b.dir,
      rich: !!b.rich,
      level: level[Math.floor(cy) * W + Math.floor(cx)],
      resources: [],
    };
    markRect(tx - 1, ty - 1, 7, 7);
    const dir = b.dir;
    // 8 crystal fields in an arc, alternating near/far
    const fields = b.fields ?? 8;
    const spread = 0.3;
    for (let k = 0; k < fields; k++) {
      const a = dir + (k - (fields - 1) / 2) * spread;
      const far = k % 2 === 0;
      let rr = far ? 7.6 : 6.6;
      let placed = false;
      for (let attempt = 0; attempt < 6 && !placed; attempt++) {
        const fx = Math.round(cx + Math.cos(a) * rr - 1);
        const fy = Math.round(cy + Math.sin(a) * rr - 0.5);
        if (rectFree(fx, fy, 2, 1)) {
          markRect(fx, fy, 2, 1);
          const amount = b.rich ? 1800 : far ? CRYSTAL_FIELD_POOR : CRYSTAL_FIELD_RICH;
          const res = { kind: 'crystal', x: fx, y: fy, w: 2, h: 1, amount, rich: !!b.rich, base: bi };
          resources.push(res);
          base.resources.push(resources.length - 1);
          placed = true;
        } else rr += 0.6;
      }
    }
    // 2 vents
    const vents = b.vents ?? 2;
    for (let k = 0; k < vents; k++) {
      const a = dir + (k === 0 ? -1 : 1) * 1.62;
      let rr = 7.2;
      let placed = false;
      for (let attempt = 0; attempt < 6 && !placed; attempt++) {
        const vx = Math.round(cx + Math.cos(a) * rr - 1.5);
        const vy = Math.round(cy + Math.sin(a) * rr - 1.5);
        if (rectFree(vx, vy, 3, 3)) {
          markRect(vx, vy, 3, 3);
          resources.push({ kind: 'vent', x: vx, y: vy, w: 3, h: 3, amount: VENT_AMOUNT, base: bi });
          base.resources.push(resources.length - 1);
          placed = true;
        } else rr += 0.7;
      }
    }
    bases.push(base);
  });

  // crystal groves: small clusters of fields scattered over the map (survival mode)
  const cage = desc.cage ? { x: desc.cage.x, y: desc.cage.y } : { x: W / 2, y: H / 2 };
  // keep the hunter cage area clear
  const cr = desc.cageRadius ?? 6;
  markRect(Math.floor(cage.x - cr), Math.floor(cage.y - cr), cr * 2, cr * 2);
  const groves = [];
  grovesRaw.forEach((g, gi) => {
    const n = g.n ?? 3;
    let placed = 0;
    for (let k = 0; k < 40 && placed < n; k++) {
      const a = k * 2.399 + hash2(gi, k, 5) * 0.8;
      const r = (k === 0 ? 0 : 1.2) + Math.sqrt(k) * 0.9 * (0.7 + hash2(gi, k, 6) * 0.6);
      const fx = Math.round(g.x + Math.cos(a) * r - 1);
      const fy = Math.round(g.y + Math.sin(a) * r - 0.5);
      if (!rectFree(fx, fy, 2, 1)) continue;
      // keep a walkable gap between fields of a grove
      markRect(fx - 1, fy - 1, 4, 3);
      resources.push({ kind: 'crystal', x: fx, y: fy, w: 2, h: 1, amount: g.rich ? 4500 : 3000, rich: !!g.rich, base: -1, grove: gi });
      placed++;
    }
    if (placed) groves.push({ x: g.x, y: g.y, n: placed, rich: !!g.rich });
  });
  // un-mark the walkable gaps (they were only reserved during placement)
  occupied.fill(0);
  for (const r of resources) markRect(r.x, r.y, r.w, r.h);
  const builderSpawns = spawnsRaw.map((p) => ({ x: p.x, y: p.y }));
  if (!builderSpawns.length) {
    for (const b of bases) {
      const dx = W / 2 - b.x;
      const dy = H / 2 - b.y;
      const d = Math.hypot(dx, dy) || 1;
      builderSpawns.push({ x: b.x + (dx / d) * 3, y: b.y + (dy / d) * 3 });
    }
  }

  // start locations in order of their feature list (symIndex groups)
  const starts = [];
  bases.forEach((b) => {
    if (b.start) {
      b.startIndex = starts.length;
      starts.push(b.id);
    }
  });

  const beacons = beaconsRaw.map((b) => ({ x: Math.round(b.x - 1), y: Math.round(b.y - 1) }));
  for (const b of beacons) markRect(b.x, b.y, 2, 2);
  const rubble = rubbleRaw.map((r) => ({ x: Math.round(r.x - 2), y: Math.round(r.y - 2) }));

  // decorative doodad seeds on unpathable / edge regions (renderer uses them)
  const doodads = [];
  const seed = desc.seed || 1;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const i = y * W + x;
      const r = hash2(x, y, seed);
      if (blocked[i] === 1 && r < 0.55) doodads.push({ x: x + hash2(x, y, 3), y: y + hash2(x, y, 4), kind: 'rock', s: 0.6 + r });
      else if (flags[i] & CELL_PATHABLE && !(flags[i] & CELL_RAMP) && r < 0.012) doodads.push({ x: x + 0.5, y: y + 0.5, kind: 'pebble', s: 0.4 + r * 10 });
    }
  }

  return {
    id: desc.id,
    name: desc.name,
    description: desc.description || '',
    theme: desc.theme || 'frost',
    players: desc.players,
    width: W,
    height: H,
    level: Array.from(level),
    heights: Array.from(height),
    flags: Array.from(flags),
    blocked: Array.from(blocked),
    resources,
    bases,
    starts,
    beacons,
    rubble,
    doodads,
    seed,
    mode: desc.mode || 'classic',
    groves,
    cage,
    cageRadius: cr,
    builderSpawns,
    hunterSlots: desc.hunterSlots ?? 2,
  };
}

// Cell-level accessors used by both sim and renderer
export function cellIndex(map, x, y) {
  return y * map.width + x;
}

export function heightAt(map, x, y) {
  // bilinear interpolation of cell-center heights
  const W = map.width;
  const H = map.height;
  const fx = Math.min(Math.max(x - 0.5, 0), W - 1.001);
  const fy = Math.min(Math.max(y - 0.5, 0), H - 1.001);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const h = map.heights;
  const i = y0 * W + x0;
  const own = h[Math.min(H - 1, Math.max(0, Math.floor(y))) * W + Math.min(W - 1, Math.max(0, Math.floor(x)))];
  const lim = LEVEL_HEIGHT * 0.45;
  // only blend with neighbours on the same "shelf" so units never float up cliff faces
  const pick = (v) => (Math.abs(v - own) > lim ? own : v);
  const a = pick(h[i]);
  const b = pick(h[i + 1]);
  const c = pick(h[i + W]);
  const d = pick(h[i + W + 1]);
  const top = a + (b - a) * tx;
  const bot = c + (d - c) * tx;
  return top + (bot - top) * ty;
}
