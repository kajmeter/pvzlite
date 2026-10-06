// Renders each map's terrain grid to a PNG (debug helper): node scripts/map-preview.mjs <outdir>
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { MAP_DESCRIPTIONS, getMap } from '../src/shared/maps/index.js';
import { CELL_PATHABLE, CELL_BUILDABLE, CELL_RAMP, CELL_CLIFF } from '../src/shared/maps/mapgen.js';

function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const out = process.argv[2] || '.';
const S = 4;
for (const d of MAP_DESCRIPTIONS) {
  if (process.argv[3] && !process.argv[3].split(",").includes(d.id)) continue;
  const m = getMap(d.id);
  const W = m.width * S, H = m.height * S;
  const buf = Buffer.alloc(W * H * 3);
  const set = (x, y, c) => { for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) { const i = ((y * S + yy) * W + x * S + xx) * 3; buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; } };
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
    const i = y * m.width + x; const f = m.flags[i]; const l = m.level[i];
    let c = [30 + l * 60, 40 + l * 60, 30 + l * 50];
    if (f & CELL_RAMP) c = [200, 180, 60];
    if (f & CELL_CLIFF) c = [90, 60, 40];
    if (!(f & CELL_PATHABLE) && !(f & CELL_CLIFF)) c = [10, 10, 10];
    else if ((f & CELL_PATHABLE) && !(f & CELL_BUILDABLE) && !(f & CELL_RAMP)) c = [c[0] + 20, c[1], c[2] + 40];
    set(x, y, c);
  }
  for (const r of m.resources) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) set(x, y, r.kind === 'crystal' ? [80, 200, 255] : [80, 255, 120]);
  for (const b of m.bases) for (let y = b.ty; y < b.ty + 5; y++) for (let x = b.tx; x < b.tx + 5; x++) set(x, y, b.start ? [255, 60, 60] : [255, 160, 200]);
  for (const b of m.beacons) for (let y = b.y; y < b.y + 2; y++) for (let x = b.x; x < b.x + 2; x++) set(x, y, [255, 255, 255]);
  for (const b of m.rubble) for (let y = b.y; y < b.y + 4; y++) for (let x = b.x; x < b.x + 4; x++) set(x, y, [160, 120, 90]);
  for (const sp of m.builderSpawns || []) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) set(Math.floor(sp.x) + x, Math.floor(sp.y) + y, [255, 255, 0]);
  if (m.mode === 'survival') for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) set(Math.floor(m.cage.x) + x, Math.floor(m.cage.y) + y, [255, 0, 255]);
  fs.writeFileSync(path.join(out, `map-${d.id}.png`), png(W, H, buf));
  console.log(d.id, 'bases', m.bases.length, 'res', m.resources.length, 'starts', m.starts.length, 'doodads', m.doodads.length);
}
