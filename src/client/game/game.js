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
        if (session.mode === 'survival') {
          const msg =
            p.role === 'hunter'
              ? 'You are the Hunter. Buy upgrades while caged, then hunt down every Shaper! (R = reveal pulse)'
              : 'You are a Shaper. Mine crystals, wall yourself in with Barricade Wards (W), build Turrets (T) and level up (U)!';
          this.hud.message(msg, 'info');
          setTimeout(() => this.controls?.selectHero(true), 50);
        } else {
          this.hud.message(`Welcome, ${p.name}. Harvest crystals, build Conduits and Portals, and destroy every enemy structure.`, 'info');
        }
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

  // Where the most interesting fight is happening (used by the menu camera and tooling)
  findAction() {
    const s = this.session;
    if (s.mode === 'survival') {
      // follow a Hunter that is breaking into a fortress, else any Hunter, else a fortress
      let best = null;
      let bestScore = 0;
      for (const h of s.units()) {
        if (h.type !== 'hunter' || h.caged) continue;
        let near = 0;
        for (const b of s.buildings()) if (Math.hypot(b.x - h.x, b.y - h.y) < 9) near += b.type === 'barricade' ? 1 : 3;
        const score = 5 + near * 4;
        if (score > bestScore) {
          bestScore = score;
          best = { x: h.x, y: h.y, score };
        }
      }
      if (!best) {
        const b = s.buildings().find((x) => x.type === 'turret') || s.buildings()[0];
        if (b) best = { x: b.x, y: b.y, score: 1 };
      }
      return best;
    }
    const lancers = s.units().filter((u) => u.type === 'lancer' && !u.hidden);
    let best = null;
    let bestScore = 0;
    const step = Math.max(1, Math.floor(lancers.length / 40));
    for (let i = 0; i < lancers.length; i += step) {
      const u = lancers[i];
      let friends = 0;
      let enemies = 0;
      for (const v of lancers) {
        if (Math.hypot(v.x - u.x, v.y - u.y) < 12) {
          if (v.owner === u.owner) friends++;
          else enemies++;
        }
      }
      const score = enemies > 0 ? (friends + enemies) * 3 : friends;
      if (score > bestScore) {
        bestScore = score;
        best = { x: u.x, y: u.y, score };
      }
    }
    return best;
  }

  // menu background: follow the action
  updateAttract(dt) {
    const s = this.session;
    const cam = this.renderer.rtsCamera;
    this.attractTimer -= dt;
    if (this.attractTimer <= 0) {
      this.attractTimer = 9;
      // follow the biggest fight, or the biggest army
      let target = this.findAction();
      if (!target) {
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
      // keep the action right of the menu panel
      const offX = window.innerWidth > 900 ? -9 : 0;
      cam.target.x += (this.attractTarget.x + offX - cam.target.x) * Math.min(1, dt * 0.35);
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
        // ------------------------------------------------ survival mode
        case 'release':
          this.banner(s.player()?.role === 'hunter' ? 'THE HUNT BEGINS' : 'THE HUNTERS ARE FREE');
          audio.play('alert');
          this.renderer.rtsCamera.shake = 0.3;
          break;
        case 'bolt': {
          const a = s.byId(ev.from);
          const t = s.byId(ev.to);
          if (!a || !t || (!this.visibleAt(a.x, a.y) && !this.visibleAt(t.x, t.y))) break;
          const c = this.renderer.teamColor(a.owner);
          const heavy = !!ev.heavy;
          fx.bolt(a.x, hAt(a.x, a.y) + (heavy ? 2.0 : 1.55), a.y, t.x, hAt(t.x, t.y) + 1.2, t.y, c, heavy);
          audio.play(heavy ? 'lunge' : 'hit-barrier', a.x, a.y);
          break;
        }
        case 'mined':
          if (s.mode === 'survival' && s.byId(ev.id)?.owner === me && ev.n) this.renderer.floatText(ev.x ?? s.byId(ev.id).x, ev.y ?? s.byId(ev.id).y, `+${ev.n}`, '#7fe0ff', 0.9, 12);
          break;
        case 'levelUp': {
          const pl = s.players[ev.owner];
          if (ev.x !== undefined) {
            fx.flash(ev.x, hAt(ev.x, ev.y) + 1, ev.y, 5, 0xffe08a, 0.5);
            fx.particles.emit(ev.x, hAt(ev.x, ev.y) + 0.6, ev.y, { count: 30, color: [1.8, 1.5, 0.5], speed: 3, up: 2, life: 0.8, size: 0.25 });
            this.renderer.floatText(ev.x, ev.y, `LEVEL ${ev.level}!`, '#ffd36b', 1.6, 16);
          }
          if (ev.owner === me) {
            this.hud?.message(`Level ${ev.level}!${ev.level >= 11 ? '' : ' Mining and defenses improved.'}`, 'info');
            audio.play('research');
          } else if (pl && ev.level >= 8 && !this.attract) this.hud?.message(`${pl.name} reached level ${ev.level}`, 'info');
          break;
        }
        case 'upgraded':
          if (ev.owner === me) audio.play('build-done');
          break;
        case 'reveal': {
          const pl = s.players[ev.owner];
          if (!pl) break;
          if (s.player()?.role === 'builder') {
            this.hud?.message('You have been revealed!', 'alert');
            audio.play('alert');
          } else if (ev.owner === me) {
            for (const [x, y] of ev.spots || []) this.hud?.minimap.ping(x, y, '#ffb06a');
            audio.play('overclock');
          }
          break;
        }
        case 'sprint': {
          const u = s.byId(ev.id);
          if (u) fx.particles.emit(u.x, hAt(u.x, u.y) + 0.5, u.y, { count: 14, color: [0.5, 1.6, 0.8], speed: 2, life: 0.5, size: 0.2 });
          break;
        }
        case 'builderDown': {
          const pl = s.players[ev.owner];
          if (!pl || this.attract) break;
          const killer = ev.by >= 0 ? s.players[ev.by] : null;
          const text = ev.lives > 0 ? `${pl.name} was hunted down${killer ? ` by ${killer.name}` : ''} (${ev.lives} ${ev.lives === 1 ? 'life' : 'lives'} left)` : `${pl.name} is out of the game!`;
          this.hud?.message(text, ev.owner === me ? 'alert' : 'info');
          if (ev.owner === me) {
            audio.play('defeat');
            if (ev.lives > 0) this.banner('YOU WERE HUNTED');
          }
          break;
        }
        case 'hunterDown': {
          const pl = s.players[ev.owner];
          if (!pl || this.attract) break;
          this.hud?.message(`Hunter ${pl.name} was destroyed! (respawning)`, ev.owner === me ? 'alert' : 'info');
          if (ev.owner !== me) audio.play('victory');
          break;
        }
        case 'respawn':
          if (ev.owner === me) {
            this.hud?.message('You are back!', 'info');
            this.renderer.rtsCamera.jumpTo(ev.x, ev.y + 3);
            setTimeout(() => this.controls?.selectHero(false), 30);
          }
          break;
        case 'gameOver':
          if (!this.attract) setTimeout(() => this.showEnd(), 1800);
          break;
        default:
          break;
      }
    }
  }

  banner(text) {
    if (!this.hud) return;
    const b = document.createElement('div');
    b.className = 'big-banner';
    b.textContent = text;
    this.hud.root.append(b);
    setTimeout(() => b.remove(), 3100);
  }

  showEnd() {
    if (this.ended) return;
    this.ended = true;
    const s = this.session;
    const me = s.localPlayer;
    const myTeam = me >= 0 ? s.players[me].team : -2;
    const victory = s.winnerTeam === myTeam;
    this.audio.play(victory ? 'victory' : 'defeat');
    const info = s.survivalInfo ? s.survivalInfo() : null;
    this.app.menus.showEndScreen(this, {
      victory,
      time: fmtTime(s.time),
      stats: s.stats(),
      survival: s.mode === 'survival',
      winnerName: s.mode === 'survival' ? (s.winnerTeam === 1 ? 'THE SHAPERS SURVIVE' : 'THE HUNTERS WIN') : '',
      reason: (info && info.reason) || s.overReason || '',
    });
  }

  dispose() {
    if (this.controls) this.controls.dispose();
    this.layer.remove();
    this.session.dispose();
    document.body.style.cursor = '';
  }
}

export { UNITS };
