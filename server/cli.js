// Command-line runner for the dedicated server (used by `npm run server`,
// Docker, and the standalone single-file binaries).
import path from 'node:path';
import fs from 'node:fs';
import { createServer, dirProvider, lanAddresses, SERVER_VERSION } from './server.js';

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--no-web') out.noWeb = true;
    else if (a === '--version' || a === '-v') out.version = true;
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out[k] = v !== undefined ? v : argv[++i];
    }
  }
  return out;
}

export const HELP = `Shardfall server ${SERVER_VERSION}

Usage: shardfall-server [options]
  --port <n>       Port to listen on (default 7777, or $PORT)
  --host <addr>    Interface to bind (default 0.0.0.0, or $HOST)
  --static <dir>   Folder with the built web client (default: ./dist)
  --no-web         Only run the multiplayer server, do not serve the web client
  --version        Print the version
`;

/**
 * @param {string[]} argv
 * @param {{ files?: Function, staticDirs?: string[] }} opts
 */
export async function main(argv = process.argv.slice(2), { files: embedded, staticDirs = [] } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(HELP);
    return null;
  }
  if (args.version) {
    console.log(SERVER_VERSION);
    return null;
  }
  const port = Number(args.port || process.env.PORT || 7777);
  const host = args.host || process.env.HOST || '0.0.0.0';
  let files = null;
  if (!args.noWeb) {
    const candidates = [args.static, process.env.SHARDFALL_STATIC, ...staticDirs, path.join(process.cwd(), 'dist')].filter(Boolean);
    const dir = candidates.find((d) => fs.existsSync(path.join(d, 'index.html')));
    if (dir) files = dirProvider(dir);
    else if (embedded) files = embedded;
    else console.warn('Web client not found (run `npm run build` first) — serving multiplayer only.');
  }
  const server = await createServer({ port, host, files });
  const addrs = lanAddresses();
  console.log(`\n  Shardfall server ${SERVER_VERSION} running on port ${server.port}`);
  if (files) {
    console.log(`  Play in your browser:   http://localhost:${server.port}`);
    for (const a of addrs) console.log(`                          http://${a}:${server.port}`);
  }
  console.log(`  Multiplayer address:    ws://localhost:${server.port}/ws`);
  for (const a of addrs) console.log(`                          ws://${a}:${server.port}/ws`);
  console.log('  Press Ctrl+C to stop.\n');
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return server;
}
