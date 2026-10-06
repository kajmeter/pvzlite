// Application shell: settings, render loop, screens and session lifecycle.
import { GameRenderer } from './render/renderer.js';
import { Audio } from './audio/audio.js';
import { Menus } from './ui/menus.js';
import { Game } from './game/game.js';
import { LocalSession } from './game/localSession.js';
import { NetClient } from './net/netClient.js';
import { RemoteSession } from './net/remoteSession.js';
import { AIController } from '../shared/ai/ai.js';

const SETTINGS_KEY = 'shardfall.settings.v1';

const DEFAULTS = {
  quality: 'high',
  healthBars: 'damaged',
  showFps: false,
  edgeScroll: true,
  cameraSpeed: 1,
  masterVolume: 0.8,
  sfxVolume: 0.8,
  musicVolume: 0.35,
  playerName: 'Commander',
  serverUrl: '',
  color: 0,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // storage unavailable (private mode / sandbox): use defaults
  }
  return { ...DEFAULTS };
}

export class App {
  constructor() {
    this.params = new URLSearchParams(location.search);
    this.settings = loadSettings();
    if (this.params.get('quality')) this.settings.quality = this.params.get('quality');
    this.viewport = document.getElementById('viewport');
    this.overlay = document.getElementById('overlay');
    this.uiRoot = document.getElementById('ui');
    this.renderer = new GameRenderer(this.viewport, this.overlay, {
      ...this.settings,
      preserveDrawingBuffer: this.params.has('capture'),
    });
    this.renderer.settings = this.settings;
    this.audio = new Audio(this.settings);
    this.menus = new Menus(this);
    this.game = null;
    this.net = null;
    this.last = performance.now();
    this.applySettings(false);
    this.debug = this.makeDebug();
    window.addEventListener('pointerdown', () => {
      if (this.audio.ensure() && !this.audio.musicNodes && (this.settings.musicVolume ?? 0) > 0) this.audio.startMusic();
    });
    requestAnimationFrame((t) => this.frame(t));
  }

  // Helpers for automated tests, screenshots and tinkering from the dev console.
  makeDebug() {
    const app = this;
    const world = () => app.game?.session?.world || null;
    return {
      world,
      autoplay(pid = 0, difficulty = 'hard') {
        const w = world();
        if (!w) return false;
        w.players[pid].difficulty = difficulty;
        w.ais.push(new AIController(w, pid));
        return true;
      },
      run(ticks) {
        const w = world();
        if (w) w.run(ticks);
        return w ? w.tick : -1;
      },
      spawn(type, owner, x, y, n = 1) {
        const w = world();
        const ids = [];
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const r = n > 1 ? 0.8 + Math.sqrt(i) * 0.7 : 0;
          ids.push(w.createUnit(type, owner, x + Math.cos(a) * r, y + Math.sin(a) * r).id);
        }
        return ids;
      },
      give(pid, crystals = 1000, flux = 1000) {
        const p = world().players[pid];
        p.crystals += crystals;
        p.flux += flux;
      },
      reveal(on = true) {
        const s = app.game.session;
        s.fogEnabled = !on;
      },
      camera(x, y, dist) {
        const c = app.renderer.rtsCamera;
        c.jumpTo(x, y);
        if (dist) {
          c.targetDistance = dist;
          c.distance = dist;
        }
      },
      select(ids) {
        app.game.setSelection(ids);
      },
      command(pid, cmd) {
        world().issue(pid, cmd);
      },
    };
  }

  saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // ignore
    }
  }

  applySettings(save = true) {
    const st = this.settings;
    if (this.renderer.settings.quality !== st.quality || !this.appliedQuality) {
      this.renderer.setQuality(st.quality);
      this.appliedQuality = st.quality;
    }
    this.renderer.settings = st;
    if (this.renderer.rtsCamera) {
      this.renderer.rtsCamera.edgeScroll = st.edgeScroll !== false;
      this.renderer.rtsCamera.speed = st.cameraSpeed ?? 1;
    }
    this.audio.applyVolumes();
    if (save) this.saveSettings();
  }

  defaultServerUrl() {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      if (window.__SHARDFALL_SERVER__) return `${proto}//${location.host}/ws`;
      return `${proto}//${location.hostname}:7777/ws`;
    }
    return 'ws://localhost:7777/ws';
  }

  frame(t) {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    if (this.game) {
      try {
        this.game.update(dt);
      } catch (err) {
        console.error(err);
        if (!this.crashShown) {
          this.crashShown = true;
          const box = document.createElement('div');
          box.className = 'overlay-center';
          box.innerHTML = `<div class="dialog panel" style="max-width:560px"><h2>Something went wrong</h2><p class="muted"></p><div class="actions"><button class="btn primary">Main Menu</button></div></div>`;
          box.querySelector('p').textContent = String(err && err.stack ? err.stack.split('\n').slice(0, 3).join(' ') : err);
          box.querySelector('button').onclick = () => {
            this.crashShown = false;
            this.quitToMenu();
          };
          this.menus.modal(box);
        }
      }
    }
    requestAnimationFrame((tt) => this.frame(tt));
  }

  setGame(game) {
    if (this.game) this.game.dispose();
    this.game = game;
    if (this.renderer.rtsCamera) {
      this.renderer.rtsCamera.edgeScroll = !game.attract && this.settings.edgeScroll !== false;
      this.renderer.rtsCamera.speed = this.settings.cameraSpeed ?? 1;
    }
  }

  // ---------------------------------------------------------------- flows

  start() {
    const boot = document.getElementById('boot');
    const play = this.params.get('play');
    if (play) {
      // quick start: ?play=<mapId>&ai=<difficulty>&seed=n
      const diff = this.params.get('ai') || 'normal';
      this.startSkirmish({
        mapId: play,
        seed: Number(this.params.get('seed')) || 7,
        players: [
          { name: this.settings.playerName || 'Commander', type: 'human', color: 0, team: 1 },
          { name: `AI (${diff})`, type: 'ai', difficulty: diff, color: 1, team: 2 },
        ],
        speed: Number(this.params.get('speed')) || 1,
        startCrystals: this.params.has('rich') ? 1000 : undefined,
      });
    } else {
      if (this.params.get('attract') !== '0') this.startAttract();
      this.menus.showMain();
    }
    setTimeout(() => boot && boot.classList.add('hidden'), 150);
    setTimeout(() => boot && boot.remove(), 900);
  }

  startAttract() {
    const maps = ['frostgate', 'verdant', 'ember', 'proving'];
    const mapId = this.params.get('attractMap') || maps[Math.floor(Math.random() * maps.length)];
    const session = new LocalSession({
      mapId,
      seed: (Math.random() * 1e6) | 0,
      localPlayer: -1,
      speed: 1.6,
      fog: false,
      startCrystals: 600,
      players: [
        { name: 'Azure', type: 'ai', difficulty: 'brutal', color: 0, team: 1 },
        { name: 'Crimson', type: 'ai', difficulty: 'brutal', color: 1, team: 2 },
      ],
    });
    // fast-forward so the menu shows a developed game
    session.world.run(20 * 150);
    const game = new Game(this, session, { attract: true });
    this.setGame(game);
    const p = session.world.players[0];
    const b = session.map.bases[p.startBase];
    this.renderer.rtsCamera.jumpTo(b.x + 10, b.y + 12);
    this.renderer.rtsCamera.targetDistance = 30;
  }

  restartAttract() {
    if (this.game && this.game.attract) this.startAttract();
  }

  startSkirmish(cfg) {
    this.menus.clear();
    this.menus.closeModal();
    const session = new LocalSession({
      mapId: cfg.mapId,
      players: cfg.players,
      seed: cfg.seed ?? ((Math.random() * 1e6) | 0),
      localPlayer: cfg.players.findIndex((p) => p.type === 'human'),
      speed: cfg.speed || 1,
      startCrystals: cfg.startCrystals,
    });
    const game = new Game(this, session);
    this.setGame(game);
  }

  async connect(url, name) {
    if (this.net) this.net.close();
    const net = new NetClient();
    await net.connect(url, name);
    this.net = net;
    net.onStart = (msg) => {
      const session = new RemoteSession(net, msg);
      this.menus.clear();
      this.menus.closeModal();
      this.setGame(new Game(this, session));
    };
    return net;
  }

  quitToMenu() {
    if (this.game && this.game.session && !this.game.session.isLocal) {
      this.game.session.leave();
    }
    this.menus.closeModal();
    if (this.params.get('attract') !== '0') this.startAttract();
    else if (this.game) {
      this.game.dispose();
      this.game = null;
    }
    this.menus.showMain();
  }
}
