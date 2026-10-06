// Mouse & keyboard RTS controls: selection, smart commands, hotkeys, control groups, placement.
import { BUILDINGS } from '../../shared/data/defs.js';
import { commandCard } from '../game/commands.js';

const EDGE = 8;

export class Controls {
  constructor(game) {
    this.game = game;
    this.mode = null; // {kind:'attack'|'move'|'patrol'|'gather'|'rally'|'overclock'|'warp'|'build', type}
    this.submenu = null;
    this.groups = new Map();
    this.lastGroupKey = { k: 0, t: 0 };
    this.mouse = { x: 0, y: 0, inside: false };
    this.drag = null;
    this.lastClick = { t: 0, id: 0 };
    this.idleIndex = 0;
    this.baseIndex = 0;
    this.lastAlert = null;
    this.enabled = true;
    this.handlers = [];
    this.bind();
  }

  get session() {
    return this.game.session;
  }

  get renderer() {
    return this.game.renderer;
  }

  on(target, ev, fn, opts) {
    target.addEventListener(ev, fn, opts);
    this.handlers.push([target, ev, fn, opts]);
  }

  dispose() {
    for (const [t, ev, fn, opts] of this.handlers) t.removeEventListener(ev, fn, opts);
    this.handlers = [];
  }

  bind() {
    const canvas = this.renderer.renderer.domElement;
    this.on(canvas, 'contextmenu', (e) => e.preventDefault());
    this.on(canvas, 'mousedown', (e) => this.onMouseDown(e));
    this.on(window, 'mousemove', (e) => this.onMouseMove(e));
    this.on(window, 'mouseup', (e) => this.onMouseUp(e));
    this.on(canvas, 'wheel', (e) => {
      e.preventDefault();
      this.renderer.rtsCamera.zoom(e.deltaY);
    }, { passive: false });
    this.on(window, 'keydown', (e) => this.onKeyDown(e));
    this.on(window, 'keyup', (e) => this.onKeyUp(e));
    this.on(document, 'mouseleave', () => {
      this.mouse.inside = false;
      this.renderer.rtsCamera.edge.x = 0;
      this.renderer.rtsCamera.edge.y = 0;
    });
    this.on(window, 'blur', () => {
      const k = this.renderer.rtsCamera.keys;
      k.left = k.right = k.up = k.down = false;
    });
  }

  // ---------------------------------------------------------------- helpers

  own(e) {
    return e && e.owner === this.session.localPlayer;
  }

  selectionEntities() {
    return this.game.selectionEntities();
  }

  ownUnits() {
    return this.selectionEntities().filter((e) => this.own(e) && e.kind === 'unit');
  }

  ownBuildings() {
    return this.selectionEntities().filter((e) => this.own(e) && e.kind === 'building');
  }

  currentButtons() {
    if (this.session.localPlayer < 0) return [];
    const sel = this.selectionEntities();
    if (this.submenu === 'build' && !sel.some((e) => this.own(e) && e.type === 'shaper')) this.submenu = null;
    return commandCard({ session: this.session, selection: sel, submenu: this.submenu, mode: this.mode });
  }

  setMode(mode) {
    this.mode = mode;
    this.renderer.placement = null;
    this.renderer.warpPreview = null;
    document.body.style.cursor = mode ? 'crosshair' : '';
    if (mode && mode.kind === 'build') this.updatePlacement();
  }

  issue(cmd, sound = true) {
    this.game.issue(cmd, sound);
  }

  idleWorkers() {
    const me = this.session.localPlayer;
    return this.session
      .units()
      .filter((u) => u.owner === me && u.type === 'shaper' && !u.dead && !u.hidden && !(u.warping > 0) && (u.orders ? u.orders.length === 0 : !!u.idle));
  }

  armyUnits() {
    const me = this.session.localPlayer;
    return this.session.units().filter((u) => u.owner === me && u.type !== 'shaper' && !(u.warping > 0));
  }

  // ---------------------------------------------------------------- mouse

  onMouseDown(e) {
    if (!this.enabled) return;
    this.game.audio.ensure();
    const { clientX: x, clientY: y } = e;
    if (e.button === 1) {
      e.preventDefault();
      this.panDrag = { x, y, tx: this.renderer.rtsCamera.target.x, tz: this.renderer.rtsCamera.target.z };
      return;
    }
    if (e.button === 2) {
      if (this.mode) {
        this.setMode(null);
        return;
      }
      this.smartCommand(x, y, e.shiftKey);
      return;
    }
    if (e.button !== 0) return;
    if (this.mode) {
      this.executeMode(x, y, e.shiftKey);
      return;
    }
    this.drag = { x0: x, y0: y, x1: x, y1: y, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
  }

  onMouseMove(e) {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    this.mouse.inside = true;
    const cam = this.renderer.rtsCamera;
    if (this.panDrag) {
      const k = cam.distance / 600;
      cam.target.x = this.panDrag.tx - (e.clientX - this.panDrag.x) * k;
      cam.target.z = this.panDrag.tz - (e.clientY - this.panDrag.y) * k;
      cam.clamp();
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    cam.edge.x = e.clientX <= EDGE ? -1 : e.clientX >= w - EDGE ? 1 : 0;
    cam.edge.y = e.clientY <= EDGE ? -1 : e.clientY >= h - EDGE ? 1 : 0;
    if (this.drag) {
      this.drag.x1 = e.clientX;
      this.drag.y1 = e.clientY;
      if (Math.abs(this.drag.x1 - this.drag.x0) + Math.abs(this.drag.y1 - this.drag.y0) > 6) {
        this.renderer.dragBox = this.drag;
      }
    }
  }

  onMouseUp(e) {
    if (e.button === 1) {
      this.panDrag = null;
      return;
    }
    if (e.button !== 0 || !this.drag) return;
    const d = this.drag;
    this.drag = null;
    this.renderer.dragBox = null;
    if (Math.abs(d.x1 - d.x0) + Math.abs(d.y1 - d.y0) > 6) this.boxSelect(d);
    else this.clickSelect(d.x0, d.y0, d.shift, d.ctrl);
  }

  overUI(x, y) {
    const el = document.elementFromPoint(x, y);
    return el && el !== this.renderer.renderer.domElement;
  }

  update() {
    // hover & placement preview
    if (!this.mouse.inside || this.drag) return;
    if (this.overUI(this.mouse.x, this.mouse.y)) {
      this.renderer.hover = null;
      return;
    }
    this.hoverTimer = (this.hoverTimer || 0) + 1;
    if (this.hoverTimer % 3 === 0) this.renderer.hover = this.renderer.pickEntity(this.mouse.x, this.mouse.y);
    if (this.mode?.kind === 'build') this.updatePlacement();
    if (this.mode?.kind === 'warp') {
      const g = this.renderer.pickGround(this.mouse.x, this.mouse.y);
      this.renderer.warpPreview = g;
    }
  }

  // ---------------------------------------------------------------- selection

  setSelection(ents, sound = true) {
    const me = this.session.localPlayer;
    let list = ents.filter(Boolean);
    const own = list.filter((e) => e.owner === me);
    if (own.length) list = own;
    else list = list.slice(0, 1);
    this.game.setSelection(list.map((e) => e.id));
    this.submenu = null;
    if (sound && list.length && list[0].owner === me) {
      const t = list[0];
      this.game.audio.play(t.kind === 'building' ? 'select-building' : `select-${t.type}`);
    }
  }

  clickSelect(x, y, shift, ctrl) {
    const e = this.renderer.pickEntity(x, y);
    const now = performance.now();
    const dbl = e && this.lastClick.id === e.id && now - this.lastClick.t < 350;
    this.lastClick = { t: now, id: e ? e.id : 0 };
    if (!e) {
      if (!shift) this.setSelection([]);
      return;
    }
    if ((ctrl || dbl) && this.own(e)) {
      const sameType = this.onScreenOwn().filter((o) => o.type === e.type);
      if (shift) this.setSelection([...this.selectionEntities(), ...sameType]);
      else this.setSelection(sameType);
      return;
    }
    if (shift && this.own(e)) {
      const cur = this.selectionEntities().filter((o) => this.own(o));
      if (cur.some((o) => o.id === e.id)) this.setSelection(cur.filter((o) => o.id !== e.id), false);
      else this.setSelection([...cur, e]);
      return;
    }
    this.setSelection([e]);
  }

  onScreenOwn() {
    const all = this.renderer.unitsInRect(0, 0, this.renderer.width, this.renderer.height);
    return all.filter((e) => this.own(e));
  }

  boxSelect(d) {
    const ents = this.renderer.unitsInRect(d.x0, d.y0, d.x1, d.y1);
    const me = this.session.localPlayer;
    const units = ents.filter((e) => e.owner === me && e.kind === 'unit');
    let pick;
    if (units.length) pick = units;
    else {
      const bl = ents.filter((e) => e.owner === me && e.kind === 'building');
      pick = bl.length ? bl : ents.slice(0, 1);
    }
    if (d.shift) {
      const cur = this.selectionEntities().filter((o) => this.own(o));
      const ids = new Set(cur.map((o) => o.id));
      pick = [...cur, ...pick.filter((p) => !ids.has(p.id))];
    }
    this.setSelection(pick);
  }

  clickSelectionCell(e, ev) {
    const sel = this.selectionEntities();
    if (ev.shiftKey) this.setSelection(sel.filter((o) => o.id !== e.id), false);
    else if (ev.ctrlKey || ev.metaKey) this.setSelection(sel.filter((o) => o.type === e.type));
    else {
      this.setSelection([e]);
      this.renderer.rtsCamera.jumpTo(e.x, e.y + 3);
    }
  }

  selectIdleWorker(all) {
    const idle = this.idleWorkers();
    if (!idle.length) return;
    if (all) {
      this.setSelection(idle);
      return;
    }
    this.idleIndex = (this.idleIndex + 1) % idle.length;
    const u = idle[this.idleIndex];
    this.setSelection([u]);
    this.renderer.rtsCamera.jumpTo(u.x, u.y + 3);
  }

  selectArmy() {
    this.setSelection(this.armyUnits());
  }

  cycleBases() {
    const me = this.session.localPlayer;
    const bases = this.session.buildings().filter((b) => b.owner === me && b.type === 'citadel');
    if (!bases.length) return;
    this.baseIndex = (this.baseIndex + 1) % bases.length;
    const b = bases[this.baseIndex];
    this.setSelection([b], false);
    this.renderer.rtsCamera.jumpTo(b.x, b.y + 3);
  }

  // ---------------------------------------------------------------- control groups

  setGroup(k, add) {
    const ids = this.selectionEntities().filter((e) => this.own(e)).map((e) => e.id);
    if (!ids.length) return;
    if (add) {
      const cur = new Set(this.groups.get(k) || []);
      ids.forEach((i) => cur.add(i));
      this.groups.set(k, [...cur]);
    } else this.groups.set(k, ids);
    this.game.hud.message(`Control group ${k} ${add ? 'updated' : 'set'} (${this.groups.get(k).length})`, 'info');
  }

  recallGroup(k) {
    const ids = (this.groups.get(k) || []).filter((id) => this.session.byId(id));
    this.groups.set(k, ids);
    if (!ids.length) return;
    const now = performance.now();
    const double = this.lastGroupKey.k === k && now - this.lastGroupKey.t < 400;
    this.lastGroupKey = { k, t: now };
    this.setSelection(ids.map((id) => this.session.byId(id)));
    if (double) {
      const ents = ids.map((id) => this.session.byId(id));
      const cx = ents.reduce((s, e) => s + e.x, 0) / ents.length;
      const cy = ents.reduce((s, e) => s + e.y, 0) / ents.length;
      this.renderer.rtsCamera.jumpTo(cx, cy + 3);
    }
  }

  // ---------------------------------------------------------------- commands

  smartCommand(x, y, queue) {
    const units = this.ownUnits();
    const buildings = this.ownBuildings();
    if (!units.length && !buildings.length) return;
    const target = this.renderer.pickEntity(x, y);
    const g = this.renderer.pickGround(x, y);
    if (!g) return;
    this.smartAt(g, target, queue, units, buildings);
  }

  smartAt(g, target, queue, units, buildings) {
    const s = this.session;
    const me = s.localPlayer;
    const fx = this.renderer.effects;
    const h = this.renderer.hAt(g.x, g.y);
    if (buildings.length && !units.length) {
      const trainers = buildings.filter((b) => BUILDINGS[b.type].trains.length);
      if (trainers.length) {
        const tgt = target && (target.kind === 'resource' || target.kind === 'unit' || target.type === 'siphon') ? target : null;
        this.issue({ type: 'rally', ids: trainers.map((b) => b.id), x: g.x, y: g.y, target: tgt ? tgt.id : 0 });
        fx.marker(g.x, h, g.y, 0x46e08a);
      }
      return;
    }
    if (buildings.length) {
      const trainers = buildings.filter((b) => BUILDINGS[b.type].trains.length);
      if (trainers.length) this.issue({ type: 'rally', ids: trainers.map((b) => b.id), x: g.x, y: g.y }, false);
    }
    const ids = units.map((u) => u.id);
    const workers = units.filter((u) => u.type === 'shaper');
    const others = units.filter((u) => u.type !== 'shaper');
    if (target) {
      const enemy = target.owner >= 0 && target.owner !== me && !s.isAllied(target.owner);
      if (enemy || (target.type === 'rubble' && target.hp > 0)) {
        this.issue({ type: 'attack', ids, target: target.id, queue });
        fx.marker(target.x, this.renderer.hAt(target.x, target.y), target.y, 0xff4040);
        return;
      }
      const isRes = target.type === 'crystal' || (target.type === 'siphon' && target.owner === me) || (target.type === 'vent' && target.siphon);
      if (isRes && workers.length) {
        this.issue({ type: 'gather', ids: workers.map((u) => u.id), target: target.id, queue });
        if (others.length) this.issue({ type: 'move', ids: others.map((u) => u.id), x: g.x, y: g.y, queue }, false);
        fx.marker(target.x, this.renderer.hAt(target.x, target.y), target.y, 0xffd04a);
        return;
      }
      if (target.type === 'citadel' && target.owner === me && workers.some((w) => w.carry)) {
        const carriers = workers.filter((w) => w.carry);
        this.issue({ type: 'returnCargo', ids: carriers.map((u) => u.id), queue });
        const rest = units.filter((u) => !carriers.includes(u));
        if (rest.length) this.issue({ type: 'move', ids: rest.map((u) => u.id), x: g.x, y: g.y, queue }, false);
        fx.marker(target.x, this.renderer.hAt(target.x, target.y), target.y, 0xffd04a);
        return;
      }
      if (target.kind === 'unit' && target.owner === me && !units.includes(target)) {
        this.issue({ type: 'follow', ids, target: target.id, queue });
        fx.marker(target.x, this.renderer.hAt(target.x, target.y), target.y, 0x46e08a);
        return;
      }
    }
    this.issue({ type: 'move', ids, x: g.x, y: g.y, queue });
    fx.marker(g.x, h, g.y, 0x46e08a);
  }

  executeMode(x, y, shift) {
    const mode = this.mode;
    const g = this.renderer.pickGround(x, y);
    if (!g) return;
    this.executeModeAt(mode, g, this.renderer.pickEntity(x, y), shift);
  }

  executeModeAt(mode, g, target, shift) {
    const s = this.session;
    const fx = this.renderer.effects;
    const units = this.ownUnits();
    const ids = units.map((u) => u.id);
    const h = this.renderer.hAt(g.x, g.y);
    let keep = shift;
    switch (mode.kind) {
      case 'attack':
        if (target && target.owner !== s.localPlayer && (target.owner >= 0 || target.type === 'rubble') && target.kind !== 'resource') {
          this.issue({ type: 'attack', ids, target: target.id, queue: shift });
          fx.marker(target.x, h, target.y, 0xff4040);
        } else {
          this.issue({ type: 'attackMove', ids, x: g.x, y: g.y, queue: shift });
          fx.marker(g.x, h, g.y, 0xff4040);
        }
        break;
      case 'move':
        if (target && target.kind === 'unit' && target.owner === s.localPlayer) this.issue({ type: 'follow', ids, target: target.id, queue: shift });
        else this.issue({ type: 'move', ids, x: g.x, y: g.y, queue: shift });
        fx.marker(g.x, h, g.y, 0x46e08a);
        break;
      case 'patrol':
        this.issue({ type: 'patrol', ids, x: g.x, y: g.y, queue: shift });
        fx.marker(g.x, h, g.y, 0xffd04a);
        break;
      case 'gather': {
        if (target && (target.type === 'crystal' || target.type === 'siphon' || target.type === 'vent')) {
          this.issue({ type: 'gather', ids: units.filter((u) => u.type === 'shaper').map((u) => u.id), target: target.id, queue: shift });
          fx.marker(target.x, h, target.y, 0xffd04a);
        } else {
          this.game.hud.message('Must target a crystal field or a Siphon', 'error');
          this.game.audio.play('error');
          keep = true;
        }
        break;
      }
      case 'rally': {
        const bl = this.ownBuildings().filter((b) => BUILDINGS[b.type].trains.length);
        this.issue({ type: 'rally', ids: bl.map((b) => b.id), x: g.x, y: g.y, target: target ? target.id : 0 });
        fx.marker(g.x, h, g.y, 0x46e08a);
        break;
      }
      case 'overclock': {
        if (target && target.kind === 'building' && target.owner === s.localPlayer) {
          const src = this.ownBuildings().filter((b) => b.type === 'citadel').sort((a, b) => b.energy - a.energy)[0];
          this.issue({ type: 'overclock', target: target.id, source: src ? src.id : 0 });
          this.game.audio.play('overclock');
        } else {
          this.game.hud.message('Must target a friendly structure', 'error');
          this.game.audio.play('error');
          keep = true;
        }
        break;
      }
      case 'warp': {
        const portals = this.ownBuildings().filter((b) => b.type === 'portal' && b.phase && b.warpCd <= 0);
        this.issue({ type: 'warp', x: g.x, y: g.y, portal: portals[0] ? portals[0].id : 0 });
        const remaining = portals.length - 1;
        keep = shift && remaining > 0;
        break;
      }
      case 'build': {
        const p = this.renderer.placement;
        if (!p) return;
        const workers = units.filter((u) => u.type === 'shaper');
        if (!workers.length) break;
        const cx = p.bx + BUILDINGS[p.type].size / 2;
        const cy = p.by + BUILDINGS[p.type].size / 2;
        workers.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) + (a.carry ? 3 : 0) - (Math.hypot(b.x - cx, b.y - cy) + (b.carry ? 3 : 0)));
        if (!p.ok) {
          this.game.hud.message(p.reason || "Can't build there", 'error');
          this.game.audio.play('error');
          return;
        }
        this.issue({ type: 'build', ids: [workers[0].id], building: p.type, bx: p.bx, by: p.by, queue: shift });
        fx.marker(cx, h, cy, 0x46e08a);
        break;
      }
      default:
        break;
    }
    if (!keep) {
      this.setMode(null);
      if (mode.kind === 'build') this.submenu = null;
    }
  }

  updatePlacement() {
    const type = this.mode.type;
    const def = BUILDINGS[type];
    const g = this.renderer.pickGround(this.mouse.x, this.mouse.y);
    if (!g) return;
    let bx = Math.round(g.x - def.size / 2);
    let by = Math.round(g.y - def.size / 2);
    if (def.onVent) {
      // snap to nearest vent
      let best = null;
      let bd = 6;
      for (const r of this.session.resources()) {
        if (r.type !== 'vent') continue;
        const d = Math.hypot(r.x - g.x, r.y - g.y);
        if (d < bd) {
          bd = d;
          best = r;
        }
      }
      if (best) {
        bx = best.bx;
        by = best.by;
      }
    }
    const res = this.session.canPlace(type, bx, by);
    const grid = this.game.placementGrid();
    this.renderer.placement = {
      type,
      bx,
      by,
      ok: res.ok,
      reason: res.reason,
      cellOk: def.onVent ? () => res.ok : (x, y) => res.ok || (grid ? grid.buildable(x, y) : false),
    };
  }

  pressButton(b, shift = false) {
    if (!b || b.disabled) {
      if (b && b.tooltip) {
        this.game.hud.message(b.tooltip.desc?.split('\n').pop() || 'Not available', 'error');
        this.game.audio.play('error');
      }
      return;
    }
    const a = b.action;
    this.game.audio.play('click');
    if ('submenu' in a) {
      this.submenu = a.submenu;
      this.setMode(null);
      return;
    }
    if (a.mode) {
      if (a.mode === 'build') {
        this.setMode({ kind: 'build', type: a.type });
      } else this.setMode({ kind: a.mode });
      return;
    }
    if (a.cmd) {
      const ids = this.selectionEntities().filter((e) => this.own(e)).map((e) => e.id);
      const cmd = { ...a.cmd, ids };
      if (cmd.type === 'train' && shift) cmd.count = 5;
      this.issue(cmd);
    }
  }

  minimapLeftClick(p, e) {
    if (!this.mode) return false;
    const target = null;
    this.executeModeAt(this.mode, p, target, e.shiftKey);
    return true;
  }

  minimapRightClick(p, e) {
    const units = this.ownUnits();
    const buildings = this.ownBuildings();
    if (!units.length && !buildings.length) return;
    this.smartAt(p, null, e.shiftKey, units, buildings);
  }

  // ---------------------------------------------------------------- keyboard

  onKeyDown(e) {
    if (!this.enabled) return;
    const hud = this.game.hud;
    if (hud.chatOpen) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const cam = this.renderer.rtsCamera;
    const key = e.key;
    if (key === 'ArrowLeft') cam.keys.left = true;
    else if (key === 'ArrowRight') cam.keys.right = true;
    else if (key === 'ArrowUp') cam.keys.up = true;
    else if (key === 'ArrowDown') cam.keys.down = true;
    if (key.startsWith('Arrow')) {
      e.preventDefault();
      return;
    }
    if (key === 'F10' || (key === 'Escape' && !this.mode && !this.submenu && !this.hasCancelButton())) {
      e.preventDefault();
      this.game.togglePause();
      return;
    }
    if (this.game.paused && !this.game.session.isLocal) return;
    if (key === 'Escape') {
      if (this.mode) {
        this.setMode(null);
        return;
      }
      const cancelBtn = this.currentButtons().find((b) => b.hotkey === 'Escape');
      if (cancelBtn) this.pressButton(cancelBtn);
      return;
    }
    if (key === 'Enter') {
      e.preventDefault();
      hud.openChat();
      return;
    }
    if (key === 'F1') {
      e.preventDefault();
      this.selectIdleWorker(e.ctrlKey);
      return;
    }
    if (key === 'F2') {
      e.preventDefault();
      this.selectArmy();
      return;
    }
    if (key === 'Backspace') {
      e.preventDefault();
      this.cycleBases();
      return;
    }
    if (key === ' ') {
      e.preventDefault();
      if (this.lastAlert) cam.jumpTo(this.lastAlert.x, this.lastAlert.y + 3);
      return;
    }
    if (key === 'Pause' || (key === 'p' && e.ctrlKey)) {
      e.preventDefault();
      this.game.togglePause();
      return;
    }
    if ((key === '+' || key === '=') && this.session.isLocal) {
      this.game.changeSpeed(1);
      return;
    }
    if ((key === '-' || key === '_') && this.session.isLocal) {
      this.game.changeSpeed(-1);
      return;
    }
    const digit = e.code && e.code.startsWith('Digit') ? Number(e.code.slice(5)) : NaN;
    if (digit >= 1 && digit <= 9) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) this.setGroup(digit, false);
      else if (e.shiftKey) this.setGroup(digit, true);
      else this.recallGroup(digit);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = key.length === 1 ? key.toUpperCase() : key;
    const b = this.currentButtons().find((btn) => btn.hotkey === k);
    if (b) {
      e.preventDefault();
      this.pressButton(b, e.shiftKey);
    }
  }

  hasCancelButton() {
    return this.currentButtons().some((b) => b.hotkey === 'Escape');
  }

  onKeyUp(e) {
    const cam = this.renderer.rtsCamera;
    if (e.key === 'ArrowLeft') cam.keys.left = false;
    else if (e.key === 'ArrowRight') cam.keys.right = false;
    else if (e.key === 'ArrowUp') cam.keys.up = false;
    else if (e.key === 'ArrowDown') cam.keys.down = false;
  }
}
