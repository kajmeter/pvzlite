import { test, expect } from '@playwright/test';

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

test('main menu renders with the 3D background battle', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/?quality=low');
  await expect(page.locator('.title-logo')).toHaveText('SHARDFALL');
  await expect(page.getByRole('button', { name: /Play vs AI/ })).toBeVisible();
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => ({ attract: !!window.__shardfall.game?.attract, units: window.__shardfall.game.session.units().length }));
  expect(state.attract).toBe(true);
  expect(state.units).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test('skirmish: start a game, select workers and order a Conduit', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/?quality=low&attract=0');
  await page.getByRole('button', { name: /Play vs AI/ }).click();
  await expect(page.locator('.map-item')).toHaveCount(5);
  await page.getByRole('button', { name: 'Start Game' }).click();
  await expect(page.locator('.hud-bottom')).toBeVisible();
  await expect(page.locator('.clock')).toBeVisible();
  // select all own workers through the debug API (box selection is covered below)
  await page.evaluate(() => {
    const g = window.__shardfall.game;
    const me = g.session.localPlayer;
    g.setSelection(g.session.units().filter((u) => u.owner === me).map((u) => u.id));
  });
  await expect(page.locator('.multi-cell')).toHaveCount(12);
  await expect(page.locator('.cmd[data-cmd=buildmenu]')).toBeVisible();
  await page.keyboard.press('b');
  await expect(page.locator('.cmd[data-cmd="build:conduit"]')).toBeVisible();
  // place a conduit through the API helpers at a valid spot
  const placed = await page.evaluate(() => {
    const g = window.__shardfall.game;
    const s = g.session;
    const p = s.player();
    const base = s.map.bases[p.startBase];
    for (let r = 6; r < 14; r++) {
      for (let a = 0; a < Math.PI * 2; a += 0.4) {
        const bx = Math.round(base.x - Math.cos(base.dir) * r + Math.cos(a) * 2);
        const by = Math.round(base.y - Math.sin(base.dir) * r + Math.sin(a) * 2);
        if (s.canPlace('conduit', bx, by).ok) {
          s.world.players[p.id].crystals += 100;
          const worker = s.units().find((u) => u.owner === p.id && u.type === 'shaper');
          g.issue({ type: 'build', ids: [worker.id], building: 'conduit', bx, by });
          return { bx, by };
        }
      }
    }
    return null;
  });
  expect(placed).not.toBeNull();
  await expect
    .poll(async () => page.evaluate(() => window.__shardfall.game.session.buildings().filter((b) => b.type === 'conduit').length), { timeout: 60000 })
    .toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('box selection and smart move', async ({ page }) => {
  await page.goto('/?quality=low&play=proving&ai=easy');
  await expect(page.locator('.hud-bottom')).toBeVisible();
  await page.waitForTimeout(1000);
  const vp = page.viewportSize();
  await page.mouse.move(80, 60);
  await page.mouse.down();
  await page.mouse.move(vp.width - 80, vp.height - 260, { steps: 6 });
  await page.mouse.up();
  const n = await page.evaluate(() => window.__shardfall.game.selection.size);
  expect(n).toBeGreaterThan(0);
  await page.mouse.click(vp.width / 2, vp.height / 2 - 120, { button: 'right' });
  const ordered = await page.evaluate(() => {
    const g = window.__shardfall.game;
    return [...g.selection].map((id) => g.session.byId(id)).filter((u) => u && u.orders && u.orders.length).length;
  });
  expect(ordered).toBeGreaterThan(0);
});

test('multiplayer: two players meet in a lobby and start a game', async ({ browser }) => {
  const mk = async (name) => {
    const page = await browser.newPage();
    const errors = trackErrors(page);
    await page.goto('/?quality=low&attract=0');
    await page.getByRole('button', { name: /Multiplayer/ }).click();
    await page.locator('.pname').fill(name);
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(page.getByText('Game Lobbies')).toBeVisible();
    return { page, errors };
  };
  const a = await mk('Alice');
  const b = await mk('Bob');
  await a.page.selectOption('.rmap', 'proving');
  await a.page.getByRole('button', { name: 'Create' }).click();
  await expect(a.page.locator('.room-dialog')).toBeVisible();
  await expect(b.page.locator('.lobby-item')).toHaveCount(1);
  await b.page.locator('.lobby-item button').click();
  await expect(b.page.locator('.room-dialog')).toBeVisible();
  await b.page.getByRole('button', { name: 'Ready' }).click();
  await expect(a.page.getByText('✔ ready')).toBeVisible();
  await a.page.getByRole('button', { name: 'Start Game' }).click();
  await expect(a.page.locator('.hud-bottom')).toBeVisible();
  await expect(b.page.locator('.hud-bottom')).toBeVisible();
  await expect.poll(async () => a.page.evaluate(() => window.__shardfall.game.session.units().length), { timeout: 15000 }).toBeGreaterThanOrEqual(12);
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
  await a.page.close();
  await b.page.close();
});
