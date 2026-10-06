// Captures the README screenshots by driving the real game in headless Chromium.
//   npm run build && npm run screenshots   → docs/screenshots/*.png
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer, dirProvider } from '../server/server.js';

const OUT = path.resolve('docs/screenshots');
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const want = (name) => !only.length || only.some((o) => name.includes(o));

const server = await createServer({ port: 0, host: '127.0.0.1', files: dirProvider('dist'), quiet: true });
const BASE = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const W = 1600;
const H = 900;

async function open(url) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => console.log('  pageerror:', e.message));
  await page.goto(`${BASE}${url}`);
  await page.waitForTimeout(2500);
  return page;
}

async function shot(page, name, settle = 2500) {
  await page.waitForTimeout(settle);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('  ✓', name);
}

// --------------------------------------------------------------- scenes

if (want('01-main-menu')) {
  const page = await open('/?quality=high&attractMap=verdant');
  await page.evaluate(() => {
    const d = window.__shardfall.debug;
    d.run(20 * 200);
    for (let i = 0; i < 30 && !(window.__shardfall.game.findAction()?.score > 30); i++) d.run(20 * 10);
    const a = d.focusAction(26);
    if (a) d.camera(a.x - 9, a.y + 3, 26);
    window.__shardfall.game.attractTimer = 999;
  });
  await shot(page, '01-main-menu', 3000);
  await page.close();
}

if (want('02-skirmish')) {
  const page = await open('/?quality=low&attract=0');
  await page.getByRole('button', { name: /Play vs AI/ }).click();
  await page.locator('.map-item').nth(1).click();
  await shot(page, '02-skirmish-setup', 800);
  await page.close();
}

if (want('03-base')) {
  const page = await open('/?quality=high&play=verdant&ai=hard&seed=4');
  await page.evaluate(() => {
    const d = window.__shardfall.debug;
    d.autoplay(0, 'brutal');
    d.run(20 * 420);
    const w = d.world();
    const p = w.players[0];
    const main = w.map.bases[p.startBase];
    d.camera(main.x + 7, main.y + 9, 32);
    const sel = w.buildings.filter((b) => b.owner === 0 && b.type === 'portal').map((b) => b.id);
    d.select(sel.slice(0, 1));
  });
  await shot(page, '03-base', 4000);
  await page.close();
}

if (want('04-battle')) {
  const page = await open('/?quality=high&play=frostgate&ai=easy&seed=2');
  await page.evaluate(() => {
    const d = window.__shardfall.debug;
    const w = d.world();
    w.players[0].upgrades.lunge = 1;
    w.players[1].upgrades.lunge = 1;
    const line = (owner, x, y, n) => {
      const ids = [];
      for (let i = 0; i < n; i++) ids.push(w.createUnit('lancer', owner, x + (i % 2) * 1.2, y + (i - n / 2) * 1.1, { facing: owner ? Math.PI : 0 }).id);
      return ids;
    };
    const a = line(0, 54, 64, 14);
    const b = line(1, 74, 64, 14);
    d.reveal(true);
    d.command(0, { type: 'attackMove', ids: a, x: 76, y: 64 });
    d.command(1, { type: 'attackMove', ids: b, x: 52, y: 64 });
    d.run(20 * 2.6);
    d.focusAction(21);
    d.select(a.slice(0, 1));
  });
  await shot(page, '04-battle', 1200);
  await page.close();
}

if (want('05-economy')) {
  const page = await open('/?quality=high&play=frostgate&ai=easy&seed=3');
  await page.evaluate(() => {
    const d = window.__shardfall.debug;
    d.run(20 * 25);
    const w = d.world();
    const p = w.players[0];
    const main = w.map.bases[p.startBase];
    d.camera(main.x - 2.5, main.y + 0.5, 15);
    const workers = w.units.filter((u) => u.owner === 0 && u.type === 'shaper').map((u) => u.id);
    d.select(workers.slice(0, 1));
  });
  await shot(page, '05-economy', 3000);
  await page.close();
}

if (want('06-placement')) {
  const page = await open('/?quality=high&play=proving&ai=easy&seed=5&rich');
  const pos = await page.evaluate(() => {
    const app = window.__shardfall;
    const d = app.debug;
    d.autoplay(0, 'hard');
    d.run(20 * 150);
    const w = d.world();
    w.ais.pop();
    const p = w.players[0];
    const main = w.map.bases[p.startBase];
    const conduit = w.buildings.find((b) => b.owner === 0 && b.type === 'conduit' && b.built);
    const cx = conduit ? conduit.x : main.x;
    const cy = conduit ? conduit.y : main.y;
    d.camera(cx, cy + 5, 24);
    const worker = w.units.find((u) => u.owner === 0 && u.type === 'shaper');
    d.select([worker.id]);
    app.game.controls.submenu = 'build';
    app.game.controls.setMode({ kind: 'build', type: 'portal' });
    return { cx, cy };
  });
  // hover a spot near the conduit so the ghost and power field show
  await page.waitForTimeout(1500);
  const screen = await page.evaluate(({ cx, cy }) => {
    const r = window.__shardfall.renderer;
    const p = r.project(cx + 3.5, cy + 0.5, r.hAt(cx, cy));
    return { x: p.x, y: p.y };
  }, pos);
  await page.mouse.move(screen.x, screen.y);
  await page.waitForTimeout(600);
  await page.mouse.move(screen.x + 3, screen.y + 2);
  await shot(page, '06-build-placement', 2500);
  await page.close();
}

if (want('07-multiplayer')) {
  const mk = async (name) => {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.goto(`${BASE}/?quality=low&attractMap=quarry`);
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: /Multiplayer/ }).click();
    await page.locator('.pname').fill(name);
    await page.getByRole('button', { name: 'Connect' }).click();
    await page.getByText('Game Lobbies').waitFor();
    return page;
  };
  const a = await mk('Kaj');
  const b = await mk('Nova');
  await a.selectOption('.rmap', 'quarry');
  await a.locator('.rname').fill('Friday night 2v2');
  await a.getByRole('button', { name: 'Create' }).click();
  await a.locator('.room-dialog').waitFor();
  await b.waitForTimeout(800);
  await b.locator('.lobby-item button').click();
  await b.locator('.room-dialog').waitFor();
  await b.getByRole('button', { name: 'Ready' }).click();
  await a.getByRole('button', { name: 'Add AI' }).click();
  await a.waitForTimeout(400);
  await a.getByRole('button', { name: 'Add AI' }).click();
  await a.waitForTimeout(600);
  // teams: Kaj+Nova vs AIs
  await b.locator('.slot').nth(1).locator('.team').selectOption('1');
  await a.waitForTimeout(400);
  await a.locator('.slot').nth(2).locator('.team').selectOption('2');
  await a.waitForTimeout(300);
  await a.locator('.slot').nth(3).locator('.team').selectOption('2');
  await a.locator('.chatmsg').fill('gl hf!');
  await a.getByRole('button', { name: 'Send' }).click();
  await shot(a, '07-multiplayer-lobby', 1500);
  await a.close();
  await b.close();
}

if (want('08-quarry')) {
  const page = await open('/?quality=high&attract=0');
  await page.evaluate(() => {
    const app = window.__shardfall;
    app.startSkirmish({
      mapId: 'quarry',
      seed: 21,
      players: [
        { name: 'Commander', type: 'human', color: 0, team: 1 },
        { name: 'AI (hard)', type: 'ai', difficulty: 'hard', color: 2, team: 1 },
        { name: 'AI (brutal)', type: 'ai', difficulty: 'brutal', color: 1, team: 2 },
        { name: 'AI (brutal)', type: 'ai', difficulty: 'brutal', color: 3, team: 2 },
      ],
    });
    const d = app.debug;
    d.autoplay(0, 'brutal');
    d.run(20 * 330);
    for (let i = 0; i < 30 && !(app.game.findAction()?.score > 40); i++) d.run(20 * 10);
    d.reveal(true);
    d.focusAction(40);
  });
  await shot(page, '08-four-player-map', 4000);
  await page.close();
}

if (want('09-howto')) {
  const page = await open('/?quality=low&attractMap=verdant');
  await page.getByRole('button', { name: /How to Play/ }).click();
  await shot(page, '09-how-to-play', 800);
  await page.close();
}

if (want('10-victory')) {
  const page = await open('/?quality=high&play=frostgate&ai=normal&seed=8');
  await page.evaluate(() => {
    const d = window.__shardfall.debug;
    d.autoplay(0, 'brutal');
    d.run(20 * 360);
    const w = d.world();
    for (const b of w.buildings.filter((x) => x.owner === 1)) w.kill(b, w.units.find((u) => u.owner === 0));
    const main = w.map.bases[w.players[0].startBase];
    d.camera(main.x + 6, main.y + 8, 30);
  });
  await page.waitForSelector('.end-banner', { timeout: 60000 });
  await shot(page, '10-victory', 1000);
  await page.close();
}

if (want('maps')) {
  const page = await open('/?quality=low&attract=0');
  const ids = ['frostgate', 'ember', 'verdant', 'quarry', 'proving'];
  fs.mkdirSync(path.join(OUT, 'maps'), { recursive: true });
  for (const id of ids) {
    const url = await page.evaluate((m) => window.__shardfall.debug.mapPreview(m, 256), id);
    fs.writeFileSync(path.join(OUT, 'maps', `${id}.png`), Buffer.from(url.split(',')[1], 'base64'));
  }
  console.log('  ✓ map previews');
  await page.close();
}

await browser.close();
await server.close();
console.log(`screenshots written to ${OUT}`);
