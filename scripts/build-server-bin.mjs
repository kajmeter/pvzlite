// Builds standalone single-file server binaries (web client embedded) using Node.js SEA:
//   release/shardfall-server-linux-x64
//   release/shardfall-server-win-x64.exe
// Usage: node scripts/build-server-bin.mjs [linux-x64] [win-x64]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

const ROOT = path.resolve('.');
const TMP = path.join(ROOT, 'build-tmp');
const OUT = path.join(ROOT, 'release');
const version = process.version; // the SEA blob must match the node binary version exactly
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['linux-x64', 'win-x64'];

fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

// 1. embed the web client
const dist = path.join(ROOT, 'dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('dist/ missing — run `npm run build` first');
const files = {};
const walk = (d) => {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) walk(p);
    else files[path.relative(dist, p).split(path.sep).join('/')] = fs.readFileSync(p).toString('base64');
  }
};
walk(dist);
fs.writeFileSync(path.join(TMP, 'web.json'), JSON.stringify(files));

// 2. bundle the server into one CommonJS file
await build({
  entryPoints: [path.join(ROOT, 'server', 'sea-main.js')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: path.join(TMP, 'server-bundle.cjs'),
  logLevel: 'warning',
  external: ['bufferutil', 'utf-8-validate'],
});

// 3. SEA preparation blob
const seaConfig = {
  main: path.join(TMP, 'server-bundle.cjs'),
  output: path.join(TMP, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
  assets: { 'web.json': path.join(TMP, 'web.json') },
};
fs.writeFileSync(path.join(TMP, 'sea-config.json'), JSON.stringify(seaConfig, null, 2));
execFileSync(process.execPath, ['--experimental-sea-config', path.join(TMP, 'sea-config.json')], { stdio: 'inherit' });

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${url}: ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function extractFromTarGz(tgz, member, dest) {
  // tiny tar reader (ustar) for a single member
  const tar = zlib.gunzipSync(fs.readFileSync(tgz));
  let off = 0;
  while (off + 512 <= tar.length) {
    const name = tar.toString('utf8', off, off + 100).replace(/\0.*$/, '');
    if (!name) break;
    const prefix = tar.toString('utf8', off + 345, off + 500).replace(/\0.*$/, '');
    const full = prefix ? `${prefix}/${name}` : name;
    const size = parseInt(tar.toString('utf8', off + 124, off + 136).replace(/\0.*$/, '').trim() || '0', 8);
    if (full.endsWith(member)) {
      fs.writeFileSync(dest, tar.subarray(off + 512, off + 512 + size));
      return;
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${member} not found in ${tgz}`);
}

function extractFromZip(zipFile, member, dest) {
  const buf = fs.readFileSync(zipFile);
  // find end of central directory
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(off + 28);
    const extra = buf.readUInt16LE(off + 30);
    const comment = buf.readUInt16LE(off + 32);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    if (name.endsWith(member)) {
      const method = buf.readUInt16LE(off + 10);
      const compSize = buf.readUInt32LE(off + 20);
      const local = buf.readUInt32LE(off + 42);
      const lName = buf.readUInt16LE(local + 26);
      const lExtra = buf.readUInt16LE(local + 28);
      const start = local + 30 + lName + lExtra;
      const data = buf.subarray(start, start + compSize);
      fs.writeFileSync(dest, method === 8 ? zlib.inflateRawSync(data) : data);
      return;
    }
    off += 46 + nameLen + extra + comment;
  }
  throw new Error(`${member} not found in ${zipFile}`);
}

const postject = path.join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js');

for (const target of targets) {
  const isWin = target.startsWith('win');
  const binOut = path.join(OUT, `shardfall-server-${target}${isWin ? '.exe' : ''}`);
  const cacheDir = path.join(os.homedir(), '.cache', 'shardfall-node');
  fs.mkdirSync(cacheDir, { recursive: true });
  const archive = isWin ? `node-${version}-win-x64.zip` : `node-${version}-${target}.tar.gz`;
  const archivePath = path.join(cacheDir, archive);
  if (!fs.existsSync(archivePath)) {
    console.log(`downloading ${archive}…`);
    await download(`https://nodejs.org/dist/${version}/${archive}`, archivePath);
  }
  if (isWin) extractFromZip(archivePath, 'node.exe', binOut);
  else extractFromTarGz(archivePath, 'bin/node', binOut);
  fs.chmodSync(binOut, 0o755);
  execFileSync(
    process.execPath,
    [postject, binOut, 'NODE_SEA_BLOB', seaConfig.output, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', '--overwrite'],
    { stdio: 'inherit' },
  );
  console.log(`built ${binOut} (${(fs.statSync(binOut).size / 1e6).toFixed(1)} MB)`);
}
