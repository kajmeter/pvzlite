// Captures the README screenshots by driving the real game in headless Chromium.
//   npm run build && npm run screenshots   → docs/screenshots/*.png
//   npm run screenshots -- 03 maps         → only scenes whose name contains "03" or "maps"
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

// centre of a player's structures (their fortress)
const FORTRESS = `(w, pid) => {
  const mine = w.buildings.filter((b) => b.owner === pid && !b.dead);
  if (!mine.length) return null;
  const x = mine.reduce((a, b) => a + b.x, 0) / mine.length;
  const y = mine.reduce((a, b) => a + b.y, 0) / mine.length;
  return { x, y, n: mine.length };
}`;

// --------------------------------------------------------------- scenes

if (want('01-main-menu')) {
  const page = await open('/?quality=high&attractMap=wilds');
  await page.evaluate(() => {
    const app = window.__pvzlite;
    const d = app.debug;
    for (let i = 0; i < 40 && !(app.game.findAction()?.score > 20); i++) d.run(20 * 10);
    const a = app.game.findAction();
    if (a) d.camera(a.x - 9, a.y + 3, 26);
    app.game.attractTimer = 999;
  });
  await shot(page, '01-main-menu', 3000);
  await page.close();
}

if (want('02-survival-setup')) {
  const page = await open('/?quality=low&attractMap=expanse');
  await page.getByRole('button', { name: /Play pvzlite/ }).click();
  await page.locator('.role-card[data-role=builder]').click();
  await page.locator('.map-item').nth(0).click();
  await shot(page, '02-survival-setup', 800);
  await page.close();
}

if (want('03-fortress')) {
  const page = await open('/?quality=high&survive=wilds&role=builder&ai=hard&seed=4');
  await page.evaluate((FORTRESS) => {
    const app = window.__pvzlite;
    const d = app.debug;
    const fortress = eval(FORTRESS);
    d.autoplay(0, 'brutal');
    d.run(20 * 200);
    const w = d.world();
    const f = fortress(w, 0);
    if (f) d.camera(f.x, f.y + 4, 24);
    d.select([w.players[0].heroId].filter(Boolean));
  }, FORTRESS);
  await shot(page, '03-fortress', 4000);
  await page.close();
}

if (want('04-hunter-breach')) {
  const page = await open('/?quality=high&survive=expanse&role=hunter&ai=hard&seed=11');
  await page.evaluate(() => {
    const app = window.__pvzlite;
    const d = app.debug;
    const w = d.world();
    // hunters get a head start on upgrades so the shop shows badges
    w.players[0].essence += 600;
    d.autoplay(0, 'brutal');
    d.run(20 * 150);
    for (let i = 0; i < 40; i++) {
      const hero = w.byId.get(w.players[0].heroId);
      const near = hero && w.buildings.filter((b) => b.owner !== 0 && !b.dead && Math.hypot(b.x - hero.x, b.y - hero.y) < 7).length;
      if (near >= 3) break;
      d.run(20 * 3);
    }
    const hero = w.byId.get(w.players[0].heroId);
    if (hero) d.camera(hero.x, hero.y + 3, 20);
    d.select([w.players[0].heroId].filter(Boolean));
  });
  await shot(page, '04-hunter-breach', 1500);
  await page.close();
}

if (want('05-mining')) {
  const page = await open('/?quality=high&survive=labyrinth&role=builder&ai=normal&seed=5');
  await page.evaluate(() => {
    const app = window.__pvzlite;
    const d = app.debug;
    d.autoplay(0, 'hard');
    d.run(20 * 70);
    const w = d.world();
    w.ais.pop();
    const hero = w.byId.get(w.players[0].heroId);
    if (hero) d.camera(hero.x, hero.y + 2, 15);
    d.select([hero.id]);
  });
  // let the hero keep mining in real time so the "+crystals" floaters show
  await shot(page, '05-mining', 5000);
  await page.close();
}

if (want('06-turret-placement')) {
  const page = await open('/?quality=high&survive=wilds&role=builder&ai=easy&seed=9');
  const pos = await page.evaluate(() => {
    const app = window.__pvzlite;
    const d = app.debug;
    d.autoplay(0, 'hard');
    d.run(20 * 150);
    const w = d.world();
    w.ais.pop();
    w.players[0].crystals += 400;
    const hero = w.byId.get(w.players[0].heroId);
    // find a valid turret spot inside the player's walls, closest to the wall centre
    const walls = w.buildings.filter((b) => b.owner === 0 && b.type === 'barricade' && b.built);
    const cx = walls.length ? walls.reduce((a, b) => a + b.x, 0) / walls.length : hero.x;
    const cy = walls.length ? walls.reduce((a, b) => a + b.y, 0) / walls.length : hero.y;
    let spot = null;
    let bd = 1e9;
    for (let by = Math.floor(cy) - 8; by <= cy + 8; by++) {
      for (let bx = Math.floor(cx) - 8; bx <= cx + 8; bx++) {
        if (!w.canPlace(0, 'turret', bx, by).ok) continue;
        const dist = Math.hypot(bx + 1 - cx, by + 1 - cy);
        if (dist < bd) {
          bd = dist;
          spot = { x: bx + 1, y: by + 1 };
        }
      }
    }
    spot = spot || { x: hero.x + 2, y: hero.y };
    d.camera(spot.x, spot.y + 3, 19);
    d.select([hero.id]);
    app.game.controls.setMode({ kind: 'build', type: 'turret' });
    return spot;
  });
  await page.waitForTimeout(1500);
  const screen = await page.evaluate(({ x, y }) => {
    const r = window.__pvzlite.renderer;
    const p = r.project(x, y, r.hAt(x, y));
    return { x: p.x, y: p.y };
  }, pos);
  await page.mouse.move(screen.x, screen.y);
  await page.waitForTimeout(600);
  await page.mouse.move(screen.x + 3, screen.y + 2);
  await shot(page, '06-turret-placement', 2500);
  await page.close();
}

if (want('07-multiplayer')) {
  const mk = async (name) => {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.goto(`${BASE}/?quality=low&attractMap=labyrinth`);
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: /Multiplayer/ }).click();
    await page.locator('.pname').fill(name);
    await page.getByRole('button', { name: 'Connect' }).click();
    await page.getByText('Game Lobbies').waitFor();
    return page;
  };
  const a = await mk('Kaj');
  const b = await mk('Nova');
  await a.selectOption('.rmode', 'survival');
  await a.selectOption('.rmap', 'wilds');
  await a.locator('.rname').fill('Friday night survival');
  await a.getByRole('button', { name: 'Create' }).click();
  await a.locator('.room-dialog').waitFor();
  await b.waitForTimeout(800);
  await b.locator('.lobby-item button').click();
  await b.locator('.room-dialog').waitFor();
  await b.getByRole('button', { name: 'Ready' }).click();
  for (let i = 0; i < 3; i++) {
    await a.getByRole('button', { name: 'Add AI' }).click();
    await a.waitForTimeout(400);
  }
  await a.locator('.chatmsg').fill('gl hf, wall up fast!');
  await a.getByRole('button', { name: 'Send' }).click();
  await a.locator('.chatmsg').blur();
  await a.waitForTimeout(300);
  await a.locator('.room-dialog').evaluate((el) => {
    for (let n = el; n; n = n.parentElement) n.scrollTop = 0;
  });
  await shot(a, '07-multiplayer-lobby', 1500);
  await a.close();
  await b.close();
}

if (want('09-howto')) {
  const page = await open('/?quality=low&attractMap=wilds');
  await page.getByRole('button', { name: /How to Play/ }).click();
  await shot(page, '09-how-to-play', 800);
  await page.close();
}

if (want('10-victory')) {
  const page = await open('/?quality=high&survive=expanse&role=builder&ai=normal&seed=8');
  await page.evaluate((FORTRESS) => {
    const app = window.__pvzlite;
    const d = app.debug;
    const fortress = eval(FORTRESS);
    d.autoplay(0, 'brutal');
    d.run(20 * 240);
    const w = d.world();
    w.ais.splice(0, w.ais.length);
    const p = w.players[0];
    p.crystals += 20000;
    for (let i = p.level; i < 11; i++) d.command(0, { type: 'levelUp' });
    const f = fortress(w, 0) || w.byId.get(p.heroId);
    if (f) d.camera(f.x, f.y + 5, 28);
  }, FORTRESS);
  await page.waitForSelector('.end-banner', { timeout: 60000 });
  await shot(page, '10-victory', 1200);
  await page.close();
}

if (want('11-classic-base')) {
  const page = await open('/?quality=high&play=verdant&ai=hard&seed=4');
  await page.evaluate(() => {
    const d = window.__pvzlite.debug;
    d.autoplay(0, 'brutal');
    d.run(20 * 420);
    const w = d.world();
    const p = w.players[0];
    const main = w.map.bases[p.startBase];
    d.camera(main.x + 7, main.y + 9, 32);
    const sel = w.buildings.filter((b) => b.owner === 0 && b.type === 'portal').map((b) => b.id);
    d.select(sel.slice(0, 1));
  });
  await shot(page, '11-classic-base', 4000);
  await page.close();
}

if (want('12-classic-battle')) {
  const page = await open('/?quality=high&play=frostgate&ai=easy&seed=2');
  await page.evaluate(() => {
    const d = window.__pvzlite.debug;
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
  await shot(page, '12-classic-battle', 1200);
  await page.close();
}

if (want('maps')) {
  const page = await open('/?quality=low&attract=0');
  const ids = ['wilds', 'expanse', 'labyrinth', 'frostgate', 'ember', 'verdant', 'quarry', 'proving'];
  fs.mkdirSync(path.join(OUT, 'maps'), { recursive: true });
  for (const id of ids) {
    const url = await page.evaluate((m) => window.__pvzlite.debug.mapPreview(m, 256), id);
    fs.writeFileSync(path.join(OUT, 'maps', `${id}.png`), Buffer.from(url.split(',')[1], 'base64'));
  }
  console.log('  ✓ map previews');
  await page.close();
}

await browser.close();
await server.close();
console.log(`screenshots written to ${OUT}`);
