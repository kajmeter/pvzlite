// Renders the link-preview cards from a README screenshot:
//   docs/social-preview.png (1280×640, upload in GitHub → Settings → Social preview)
//   public/og-image.png     (1200×630, Open Graph / Twitter card for the web build)
//   npm run screenshots && node scripts/social-preview.mjs [screenshot.png]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const shot = path.resolve(process.argv[2] || 'docs/screenshots/03-fortress.png');
const bg = `data:image/png;base64,${fs.readFileSync(shot).toString('base64')}`;

const card = (w, h) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; background: #070b14; }
  .bg { position: absolute; inset: 0; background: url(${bg}) center / cover; filter: saturate(1.1); }
  .shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(5, 9, 18, 0.94) 0%, rgba(5, 9, 18, 0.78) 42%, rgba(5, 9, 18, 0.05) 75%); }
  .text { position: absolute; left: ${Math.round(w * 0.06)}px; top: 50%; transform: translateY(-50%); width: ${Math.round(w * 0.5)}px;
          font-family: 'Segoe UI', 'DejaVu Sans', 'Liberation Sans', Arial, sans-serif; color: #dbe8ff; }
  h1 { margin: 0; font-size: ${Math.round(h * 0.17)}px; letter-spacing: 0.08em; font-weight: 800;
       background: linear-gradient(180deg, #ffffff, #7fd6ff); -webkit-background-clip: text; color: transparent; }
  .sub { margin-top: ${Math.round(h * 0.02)}px; font-size: ${Math.round(h * 0.052)}px; font-weight: 600; color: #9fdcff; }
  .tags { margin-top: ${Math.round(h * 0.045)}px; display: flex; flex-wrap: wrap; gap: 10px; }
  .tags span { font-size: ${Math.round(h * 0.03)}px; padding: 6px 14px; border-radius: 999px; border: 1px solid rgba(110, 200, 255, 0.55);
               background: rgba(12, 24, 44, 0.75); color: #cfe8ff; }
</style></head><body>
  <div class="bg"></div><div class="shade"></div>
  <div class="text">
    <h1>PVZLITE</h1>
    <div class="sub">Probes vs Zealot, remade in 3D</div>
    <div class="tags"><span>Free</span><span>Browser</span><span>Windows</span><span>Linux</span><span>Multiplayer</span><span>three.js</span></div>
  </div>
</body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [w, h, out] of [
  [1280, 640, 'docs/social-preview.png'],
  [1200, 630, 'public/og-image.png'],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(card(w, h));
  await page.waitForTimeout(300);
  await page.screenshot({ path: out });
  await page.close();
  console.log('  ✓', out);
}
await browser.close();
