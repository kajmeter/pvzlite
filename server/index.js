#!/usr/bin/env node
// Dedicated server entry: node server/index.js [--port 7777] [--host 0.0.0.0] [--static ./dist] [--no-web]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './cli.js';

const here = path.dirname(fileURLToPath(import.meta.url));

main(process.argv.slice(2), { staticDirs: [path.join(here, '..', 'dist')] }).catch((err) => {
  console.error(err);
  process.exit(1);
});
