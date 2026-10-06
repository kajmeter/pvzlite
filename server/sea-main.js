// Entry point for the single-file server binaries (Node.js SEA).
// The built web client is embedded as the `web.json` asset.
import { main } from './cli.js';
import { memoryProvider } from './server.js';

let files = null;
try {
  // eslint-disable-next-line no-undef
  const sea = require('node:sea');
  if (sea.isSea()) files = memoryProvider(JSON.parse(sea.getAsset('web.json', 'utf8')));
} catch {
  files = null;
}

main(process.argv.slice(2), { files }).catch((err) => {
  console.error(err);
  process.exit(1);
});
