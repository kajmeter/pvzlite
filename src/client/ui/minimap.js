// Minimap: terrain, fog, units, structures, camera frustum and alert pings.
import { CELL_PATHABLE, CELL_CLIFF, CELL_RAMP } from '../../shared/maps/mapgen.js';
import { THEMES } from '../render/terrain.js';

function hex(c) {
  return `#${c.toString(16).padStart(6, '0')}`;
}

export function drawMapPreview(canvas, map, size = 120) {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const base = terrainImage(map);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(base, 0, 0, size, size);
  const sx = size / map.width;
  const sy = size / map.height;
  for (const r of map.resources) {
    ctx.fillStyle = r.kind === 'crystal' ? '#6fe0ff' : '#63f59b';
    ctx.fillRect(r.x * sx, r.y * sy, Math.max(1, r.w * sx), Math.max(1, r.h * sy));
  }
  map.starts.forEach((bid, i) => {
    const b = map.bases[bid];
    ctx.fillStyle = ['#2f8cff', '#ff3b3b', '#2fd27a', '#ffb21e'][i % 4];
    ctx.beginPath();
    ctx.arc(b.x * sx, b.y * sy, Math.max(3, 3.2 * sx), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(9, Math.round(size / 14))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), b.x * sx, b.y * sy);
  });
}

const terrainCache = new Map();
export function terrainImage(map) {
  if (terrainCache.has(map.id)) return terrainCache.get(map.id);
  const theme = THEMES[map.theme] || THEMES.frost;
  const c = document.createElement('canvas');
  c.width = map.width;
  c.height = map.height;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(map.width, map.height);
  const groundCols = theme.ground.map((g) => [(g >> 16) & 255, (g >> 8) & 255, g & 255]);
  const cliff = [(theme.cliff >> 16) & 255, (theme.cliff >> 8) & 255, theme.cliff & 255];
  for (let i = 0; i < map.width * map.height; i++) {
    const f = map.flags[i];
    let col;
    if (f & CELL_CLIFF) col = cliff.map((v) => v * 0.8);
    else if (f & CELL_PATHABLE || f & CELL_RAMP) {
      const g = groundCols[Math.min(groundCols.length - 1, map.level[i])];
      col = g.map((v) => v * 0.72);
    } else col = map.blocked[i] === 2 && map.theme === 'ember' ? [140, 40, 10] : [12, 16, 24];
    img.data[i * 4] = col[0];
    img.data[i * 4 + 1] = col[1];
    img.data[i * 4 + 2] = col[2];
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  terrainCache.set(map.id, c);
  return c;
}

export class Minimap {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.game = game;
    this.size = 200;
    canvas.width = this.size * 2;
    canvas.height = this.size * 2;
    this.ctx = canvas.getContext('2d');
    this.fogCanvas = document.createElement('canvas');
    this.pings = [];
    this.timer = 0;
  }

  setSession(session) {
    this.session = session;
    this.map = session.map;
    this.base = terrainImage(this.map);
    this.fogCanvas.width = this.map.width;
    this.fogCanvas.height = this.map.height;
    this.fogCtx = this.fogCanvas.getContext('2d');
    this.fogImg = this.fogCtx.createImageData(this.map.width, this.map.height);
  }

  ping(x, y, color = '#ff5050') {
    this.pings.push({ x, y, t: 0, color });
  }

  toMap(ev) {
    const r = this.canvas.getBoundingClientRect();
    const fx = (ev.clientX - r.left) / r.width;
    const fy = (ev.clientY - r.top) / r.height;
    return { x: Math.min(Math.max(fx, 0), 1) * this.map.width, y: Math.min(Math.max(fy, 0), 1) * this.map.height };
  }

  update(dt) {
    for (const p of this.pings) p.t += dt;
    this.pings = this.pings.filter((p) => p.t < 3);
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    this.draw();
  }

  draw() {
    const s = this.session;
    if (!s) return;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const sx = W / this.map.width;
    const sy = H / this.map.height;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0, W, H);
    // resources
    for (const r of s.resources()) {
      if (!s.isExplored(r.x, r.y)) continue;
      ctx.fillStyle = r.type === 'crystal' ? (r.rich ? '#ffd36b' : '#6fe0ff') : '#63f59b';
      ctx.fillRect(r.bx * sx, r.by * sy, Math.max(2, r.w * sx), Math.max(2, r.h * sy));
    }
    for (const n of s.neutrals()) {
      if (!s.isExplored(n.x, n.y)) continue;
      ctx.fillStyle = n.type === 'beacon' ? '#ffffff' : '#9a7a5a';
      ctx.fillRect(n.bx * sx, n.by * sy, n.w * sx, n.h * sy);
    }
    // fog
    const vis = s.visionArray();
    if (vis) {
      const exp = s.exploredArray();
      const d = this.fogImg.data;
      for (let i = 0; i < vis.length; i++) {
        d[i * 4 + 3] = vis[i] ? 0 : exp[i] ? 120 : 215;
      }
      this.fogCtx.putImageData(this.fogImg, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.fogCanvas, 0, 0, W, H);
      ctx.imageSmoothingEnabled = false;
    }
    // structures (incl. remembered ghosts)
    const ghosts = this.game.renderer.ghosts;
    for (const b of s.buildings()) {
      if (b.owner !== s.localPlayer && !s.isVisible(b)) continue;
      ctx.fillStyle = hex(this.game.colorOf(b.owner));
      ctx.fillRect(b.bx * sx, b.by * sy, b.w * sx, b.h * sy);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeRect(b.bx * sx + 0.5, b.by * sy + 0.5, b.w * sx - 1, b.h * sy - 1);
    }
    for (const g of ghosts.values()) {
      if (s.isVisible(g)) continue;
      ctx.fillStyle = hex(this.game.colorOf(g.owner));
      ctx.globalAlpha = 0.6;
      ctx.fillRect(g.bx * sx, g.by * sy, g.w * sx, g.h * sy);
      ctx.globalAlpha = 1;
    }
    // units
    for (const u of s.units()) {
      if (u.hidden) continue;
      if (u.owner !== s.localPlayer && !s.isVisible(u)) continue;
      ctx.fillStyle = this.game.isSelected(u.id) ? '#ffffff' : hex(this.game.colorOf(u.owner));
      const r = u.type === 'lancer' ? 3.2 : 2.4;
      ctx.fillRect(u.x * sx - r / 2, u.y * sy - r / 2, r, r);
    }
    // camera
    const q = this.game.renderer.viewQuad();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    q.forEach((p, i) => {
      const x = Math.min(Math.max(p.x, 0), this.map.width) * sx;
      const y = Math.min(Math.max(p.y, 0), this.map.height) * sy;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
    // pings
    for (const p of this.pings) {
      const k = (p.t % 1) / 1;
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x * sx, p.y * sy, 6 + k * 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
