// Generates the application icons (PNG + ICO) procedurally: a faceted crystal on a dark tile.
//   node scripts/make-icons.mjs  ->  build/icon.png, build/icon.ico, build/icons/<size>x<size>.png
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

export function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function inPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function render(size) {
  const SS = 4;
  const img = Buffer.alloc(size * size * 4);
  // geometry in unit space (0..1)
  const top = [0.5, 0.1];
  const bot = [0.5, 0.92];
  const left = [0.24, 0.42];
  const right = [0.76, 0.42];
  const midL = [0.42, 0.42];
  const midR = [0.58, 0.42];
  const facets = [
    { poly: [top, left, midL], c: [150, 228, 255] },
    { poly: [top, midL, midR], c: [225, 247, 255] },
    { poly: [top, midR, right], c: [95, 196, 255] },
    { poly: [left, bot, midL], c: [40, 140, 235] },
    { poly: [midL, bot, midR], c: [70, 175, 250] },
    { poly: [midR, bot, right], c: [25, 95, 200] },
  ];
  const radius = 0.2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          // rounded square background
          const dx = Math.max(Math.abs(u - 0.5) - (0.5 - radius - 0.02), 0);
          const dy = Math.max(Math.abs(v - 0.5) - (0.5 - radius - 0.02), 0);
          if (Math.hypot(dx, dy) > radius) continue;
          const d = Math.hypot(u - 0.5, v - 0.45);
          const glowK = Math.max(0, 1 - d / 0.55);
          let cr = 8 + 30 * glowK * glowK;
          let cg = 14 + 70 * glowK * glowK;
          let cb = 30 + 120 * glowK * glowK;
          for (const f of facets) {
            if (inPoly(u, v, f.poly)) {
              [cr, cg, cb] = f.c;
              break;
            }
          }
          // ground ring
          const ry = (v - 0.86) / 0.06;
          const rx = (u - 0.5) / 0.32;
          const rr = rx * rx + ry * ry;
          if (rr > 0.75 && rr < 1.0 && v > 0.8) {
            cr = 90;
            cg = 200;
            cb = 255;
          }
          r += cr;
          g += cg;
          b += cb;
          a += 255;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      const cov = a / n / 255;
      img[i] = cov ? Math.round(r / (a / 255)) : 0;
      img[i + 1] = cov ? Math.round(g / (a / 255)) : 0;
      img[i + 2] = cov ? Math.round(b / (a / 255)) : 0;
      img[i + 3] = Math.round(a / n);
    }
  }
  return encodePng(size, size, img);
}

function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, k) => {
    const o = k * 16;
    dir[o] = size >= 256 ? 0 : size;
    dir[o + 1] = size >= 256 ? 0 : size;
    dir[o + 2] = 0;
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

const outDir = path.resolve('build');
fs.mkdirSync(path.join(outDir, 'icons'), { recursive: true });
const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
const pngs = {};
for (const s of sizes) {
  pngs[s] = render(s);
  fs.writeFileSync(path.join(outDir, 'icons', `${s}x${s}.png`), pngs[s]);
}
fs.writeFileSync(path.join(outDir, 'icon.png'), pngs[512]);
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map((s) => ({ size: s, data: pngs[s] }))));
fs.writeFileSync(path.resolve('public', 'icon.png'), pngs[256]);
console.log('icons written to build/');
