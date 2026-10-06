// Packs the built web client (dist/) into release/pvzlite-web.zip for static web hosting.
import fs from 'node:fs';
import path from 'node:path';
import { zipDirectory } from './zip.mjs';

const dist = path.resolve('dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('dist/ not found — run `npm run build` first');
  process.exit(1);
}
fs.mkdirSync('release', { recursive: true });
const out = path.resolve('release', 'pvzlite-web.zip');
const n = zipDirectory(dist, out, 'pvzlite-web');
console.log(`wrote ${out} (${n} files, ${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
