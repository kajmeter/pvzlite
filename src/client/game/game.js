// A running match: ties a session (local or remote) to the renderer, HUD, input and audio.
import * as THREE from 'three';
import { Hud, fmtTime } from '../ui/hud.js';
import { Controls } from '../input/controls.js';
import { UNITS, BUILDINGS, RESEARCH } from '../../shared/data/defs.js';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export class Game {
  constructor(app, session, opts = {}) {
    this.app = app;
    this.session = session;
    this.opts = opts;
    this.attract = !!opts.attract;
    this.renderer = app.renderer;
    this.audio = app.audio;
    this.selection = new Set();
    this.renderer.selected = this.selection;
    this.renderer.setSession(session);
    this.paused = false;
    this.ended = false;
    this.fpsAcc = 0;
    this.fpsFrames = 0;
    this.layer = document.createElement('div');
    this.layer.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    app.uiRoot.append(this.layer);
    if (!this.attract) {
      this.hud = new Hud(this.layer, this);
      this.hud.minimap.setSession(session);
      this.controls = new Controls(this);
      this.layer.style.pointerEvents = 'none';
      for (const c of this.layer.children) c.style.pointerEvents = c.classList.contains('messages') || c.classList.contains('paused-tag') ? 'none' : '';
      if (session.localPlayer >= 0) {
        const p = session.player();
        this.hud.message(`Welcome, ${p.name}. Harvest crystals, build Conduits and Portals, and destroy every enemy structure.`, 'info');
      }
    } else {
      this.renderer.rtsCamera.orbit = false;
      this.attractTarget = null;
      this.attractTimer = 0;
    }
  }

  colorOf(owner) {
    const p = this.session.players[owner];
    return p ? p.colorHex : 0xaaaaaa;
  }

  isSelected(id) {
    return this.selection.has(id);
  }

  setSelection(ids) {
    this.selection.clear();
    for (const id of ids) this.selection.add(id);
  }

  selectionEntities() {
    const out = [];
    for (const id of this.selection) {
      const e = this.session.byId(id);
      if (!e || e.dead) {
        this.selection.delete(id);
        continue;
      }
      if (e.owner !== this.session.localPlayer && e.kind === 'unit' && !this.session.isVisible(e)) {
        this.selection.delete(id);
        continue;
      }
      out.push(e);
    }
    return out;
  }

  placementGrid() {
    return this.session.world ? this.session.world.grid : this.session.grid;
  }

  issue(cmd, sound = true) {
    this.session.issue(cmd);
    if (sound) this.audio.play('ack');
  }

  sendChat(text) {
    if (this.session.sendChat) this.session.sendChat(text);
    else this.hud.message(`${this.session.player()?.name || 'You'}: ${text}`, 'chat');
  }

  changeSpeed(dir) {
    const s = this.session;
    let i = SPEEDS.indexOf(s.speed);
    if (i < 0) i = 2;
    i = Math.min(SPEEDS.length - 1, Math.max(0, i + dir));
    s.setSpeed(SPEEDS[i]);
    this.hud.message(`Game speed ×${SPEEDS[i]}`, 'info');
  }

  togglePause(force) {
    if (this.ended) return;
    const want = force === undefined ? !this.paused : force;
    this.paused = want;
    if (this.session.isLocal) this.session.setPaused(want);
    this.hud.setPaused(want && this.session.isLocal);
    if (want) this.app.menus.showPauseMenu(this);
    else this.app.menus.closeModal();
  }

  // ---------------------------------------------------------------- frame

  update(dt) {
    this.session.update(dt);
    const events = this.session.drainEvents();
    if (events.length) this.handleEvents(events);
    if (this.controls) this.controls.update(dt);
    if (this.attract) this.updateAttract(dt);
    const cam = this.renderer.rtsCamera;
    if (cam) this.audio.setListener(cam.target.x, cam.target.z);
    this.renderer.render(dt);
    if (this.hud) {
      this.hud.update(dt);
      this.fpsAcc += dt;
      this.fpsFrames++;
      if (this.fpsAcc >= 1) {
        if (this.app.settings.showFps) this.hud.fpsEl.textContent = `${Math.round(this.fpsFrames / this.fpsAcc)} fps`;
        else this.hud.fpsEl.textContent = '';
        if (this.session.netInfo) this.hud.netEl.textContent = this.session.netInfo();
        this.fpsAcc = 0;
        this.fpsFrames = 0;
      }
    }
  }

  // menu background: follow the action
  updateAttract(dt) {
    const s = this.session;
    const cam = this.renderer.rtsCamera;
    this.attractTimer -= dt;
    if (this.attractTimer <= 0) {
      this.attractTimer = 9;
      // find the biggest cluster of combat units
      const army = s.units().filter((u) => u.type === 'lancer');
      let target = null;
      if (army.length) {
        const u = army[Math.floor(Math.random() * army.length)];
        target = { x: u.x, y: u.y };
      } else {
        const bl = s.buildings();
        if (bl.length) {
          const b = bl[Math.floor(Math.random() * bl.length)];
          target = { x: b.x, y: b.y };
        }
      }
      this.attractTarget = target;
      cam.targetDistance = 24 + Math.random() * 10;
    }
    if (this.attractTarget) {
      cam.target.x += (this.attractTarget.x - cam.target.x) * Math.min(1, dt * 0.35);
      cam.target.z += (this.attractTarget.y + 4 - cam.target.z) * Math.min(1, dt * 0.35);
    }
    // restart the attract match when it ends
    if (s.over && !this.restartQueued) {
      this.restartQueued = true;
      setTimeout(() => this.app.restartAttract(), 3000);
    }
  }

  visibleAt(x, y) {
    return this.session.isVisible({ kind: 'point', x, y });
  }

  handleEvents(events) {
    const s = this.session;
    const me = s.localPlayer;
    const fx = this.renderer.effects;
    const hAt = (x, y) => this.renderer.hAt(x, y);
    const audio = this.attract ? { play() {} } : this.audio;
    for (const ev of events) {
      switch (ev.e) {
        case 'strike': {
          const a = s.byId(ev.a);
          if (!a || !this.visibleAt(a.x, a.y)) break;
          const h = hAt(a.x, a.y);
          if (a.type === 'lancer') {
            fx.slash(a.x, h + 0.95, a.y, a.facing, this.renderer.teamColor(a.owner), ev.n % 2 === 0);
            audio.play('swing', a.x, a.y);
          } else {
            const t = s.byId(ev.t);
            if (t) fx.particles.emit((a.x + t.x) / 2, h + 0.5, (a.y + t.y) / 2, { count: 4, color: [1.5, 1.3, 0.6], speed: 2, life: 0.25, size: 0.12 });
          }
          break;
        }
        case 'hit': {
          if (!this.visibleAt(ev.x, ev.y)) break;
          const t = s.byId(ev.t);
          const h = hAt(ev.x, ev.y);
          if (ev.b && t) {
            const r = t.kind === 'unit' ? (t.type === 'lancer' ? 1.0 : 0.6) : Math.max(t.w, t.h) * 0.75;
            const yOff = t.kind === 'unit' ? (t.type === 'lancer' ? 0.85 : 0.6) : 1;
            fx.bubble(t.x, h + yOff, t.y, r, new THREE.Color(0x6fc8ff));
            audio.play('hit-barrier', ev.x, ev.y);
          } else {
            const yOff = t && t.kind === 'building' ? 1.2 : 0.8;
            fx.particles.emit(ev.x, h + yOff, ev.y, { count: 6, color: [1.6, 0.8, 0.3], speed: 3, life: 0.35, size: 0.15, gravity: 6 });
            audio.play('hit', ev.x, ev.y);
          }
          break;
        }
        case 'death': {
          if (ev.silent) break;
          if (!this.visibleAt(ev.x, ev.y) && ev.owner !== me) break;
          const h = hAt(ev.x, ev.y);
          if (ev.kind === 'unit') {
            const c = this.renderer.teamColor(ev.owner);
            fx.explosion(ev.x, h, ev.y, ev.type === 'lancer' ? 0.9 : 0.6, [c.r * 1.4 + 0.4, c.g * 1.4 + 0.3, c.b * 1.4 + 0.2]);
            audio.play('death-unit', ev.x, ev.y);
          } else if (ev.kind === 'building') {
            const size = ev.type === 'citadel' ? 3 : ev.type === 'conduit' || ev.type === 'aegis' ? 1.4 : 2;
            fx.explosion(ev.x, h, ev.y, size);
            this.renderer.rtsCamera.shake = Math.max(this.renderer.rtsCamera.shake, 0.2 * size);
            audio.play('death-building', ev.x, ev.y);
          } else if (ev.type === 'crystal') {
            fx.particles.emit(ev.x, h + 0.5, ev.y, { count: 30, color: [0.4, 1.3, 1.8], speed: 3, life: 0.8, size: 0.25, gravity: 5 });
          } else if (ev.type === 'rubble') {
            fx.explosion(ev.x, h, ev.y, 1.8, [0.8, 0.6, 0.4]);
            audio.play('death-building', ev.x, ev.y);
          }
          break;
        }
        case 'lunge': {
          const u = s.byId(ev.id);
          if (!u || !this.visibleAt(u.x, u.y)) break;
          const c = this.renderer.teamColor(u.owner);
          fx.particles.emit(u.x, hAt(u.x, u.y) + 0.8, u.y, { count: 14, color: [c.r * 2, c.g * 2, c.b * 2], speed: 2.5, life: 0.4, size: 0.3 });
          audio.play('lunge', u.x, u.y);
          break;
        }
        case 'warpStart': {
          const u = s.byId(ev.id);
          if (u && (u.owner === me || this.visibleAt(u.x, u.y))) audio.play('warp', u.x, u.y);
          break;
        }
        case 'warped': {
          const u = s.byId(ev.id);
          if (u && (u.owner === me || this.visibleAt(u.x, u.y))) fx.flash(u.x, hAt(u.x, u.y) + 1, u.y, 4, 0xbfefff, 0.4);
          break;
        }
        case 'buildStart':
          if (ev.owner === me) {
            const b = s.byId(ev.id);
            if (b) {
              fx.flash(b.x, hAt(b.x, b.y) + 1, b.y, 5, 0x9fe0ff, 0.5);
              audio.play('build-start', b.x, b.y);
            }
          }
          break;
        case 'buildDone':
          if (ev.owner === me) {
            this.hud?.message(`${BUILDINGS[ev.type].name} complete`, 'info');
            audio.play('build-done');
            fx.flash(ev.x, hAt(ev.x, ev.y) + 1.5, ev.y, 7, 0xd8f4ff, 0.5);
          }
          break;
        case 'trained':
          if (ev.owner === me) audio.play('trained');
          break;
        case 'research':
          if (ev.owner === me) {
            const r = RESEARCH[ev.id];
            this.hud?.message(`Research complete: ${r.name}${r.levels.length > 1 ? ` ${ev.level}` : ''}`, 'info');
            audio.play('research');
          }
          break;
        case 'phase':
          if (s.byId(ev.id)?.owner === me && !this.phaseAnnounced) {
            this.phaseAnnounced = true;
            this.hud?.message('Portals are now Phase Portals: warp Lancers into any power field (Z)', 'info');
          }
          break;
        case 'overclock': {
          const t = s.byId(ev.id);
          const src = s.byId(ev.src);
          if (t && src && (t.owner === me || this.visibleAt(t.x, t.y))) {
            fx.flash(t.x, hAt(t.x, t.y) + 2, t.y, 4, 0xffe08a, 0.5);
          }
          break;
        }
        case 'error':
          if (ev.owner === me) {
            this.hud?.message(ev.msg, 'error');
            audio.play('error');
          }
          break;
        case 'alert':
          if (ev.owner === me) {
            this.hud?.message(ev.msg, 'alert');
            audio.play('alert');
            this.hud?.minimap.ping(ev.x, ev.y);
            if (this.controls) this.controls.lastAlert = { x: ev.x, y: ev.y };
          }
          break;
        case 'eliminated': {
          const p = s.players[ev.owner];
          if (p && !this.attract) this.hud?.message(`${p.name} has been eliminated`, ev.owner === me ? 'alert' : 'info');
          break;
        }
        case 'chat':
          this.hud?.message(`${ev.from}: ${ev.text}`, 'chat');
          break;
        case 'gameOver':
          if (!this.attract) setTimeout(() => this.showEnd(), 1800);
          break;
        default:
          break;
      }
    }
  }

  showEnd() {
    if (this.ended) return;
    this.ended = true;
    const s = this.session;
    const me = s.localPlayer;
    const myTeam = me >= 0 ? s.players[me].team : -2;
    const victory = s.winnerTeam === myTeam;
    this.audio.play(victory ? 'victory' : 'defeat');
    this.app.menus.showEndScreen(this, { victory, time: fmtTime(s.time), stats: s.stats() });
  }

  dispose() {
    if (this.controls) this.controls.dispose();
    this.layer.remove();
    this.session.dispose();
    document.body.style.cursor = '';
  }
}

export { UNITS };
