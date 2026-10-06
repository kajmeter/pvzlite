// Runs the simulation directly in the browser (single player / skirmish / attract mode).
import { World } from '../../shared/sim/world.js';
import { DT } from '../../shared/constants.js';
import { canPlace } from '../../shared/sim/structures.js';

export class LocalSession {
  constructor({ mapId, players, seed = Date.now() & 0xffff, localPlayer = 0, speed = 1, fog = true, startCrystals, startWorkers }) {
    this.world = new World({ mapId, players, seed, startCrystals, startWorkers });
    this.map = this.world.map;
    this.localPlayer = localPlayer;
    this.speed = speed;
    this.acc = 0;
    this.paused = false;
    this.events = [];
    this.fogEnabled = fog && localPlayer >= 0;
    this.isLocal = true;
    this.players = this.world.players;
    this._alpha = 0;
  }

  get tick() {
    return this.world.tick;
  }

  get time() {
    return this.world.time;
  }

  get over() {
    return this.world.over;
  }

  get winnerTeam() {
    return this.world.winnerTeam;
  }

  update(dt) {
    if (this.paused || this.world.over) {
      if (this.world.over) this._alpha = 1;
      return;
    }
    this.acc += Math.min(dt, 0.25) * this.speed;
    let steps = 0;
    while (this.acc >= DT && steps < 12) {
      this.world.step();
      const ev = this.world.drainEvents();
      if (ev.length) this.events.push(...ev);
      this.acc -= DT;
      steps++;
    }
    if (steps >= 12) this.acc = 0;
    this._alpha = Math.min(1, this.acc / DT);
  }

  alpha() {
    return this._alpha;
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  issue(cmd) {
    if (this.localPlayer < 0) return;
    this.world.issue(this.localPlayer, cmd);
  }

  player() {
    return this.localPlayer >= 0 ? this.world.players[this.localPlayer] : null;
  }

  startLocation() {
    if (this.localPlayer < 0) return { x: this.map.width / 2, y: this.map.height / 2 };
    const p = this.world.players[this.localPlayer];
    const b = this.map.bases[p.startBase];
    return b ? { x: b.x, y: b.y } : null;
  }

  units() {
    return this.world.units;
  }

  buildings() {
    return this.world.buildings;
  }

  resources() {
    return this.world.resources;
  }

  neutrals() {
    return this.world.neutrals;
  }

  byId(id) {
    return this.world.byId.get(id);
  }

  visionArray() {
    if (!this.fogEnabled) return null;
    return this.world.vision[this.world.players[this.localPlayer].team];
  }

  exploredArray() {
    if (!this.fogEnabled) return null;
    return this.world.explored[this.world.players[this.localPlayer].team];
  }

  isVisible(e) {
    if (!this.fogEnabled) return true;
    return this.world.isVisibleTo(e, this.localPlayer);
  }

  isExplored(x, y) {
    if (!this.fogEnabled) return true;
    return this.world.isExplored(this.localPlayer, x, y);
  }

  isAllied(owner) {
    if (this.localPlayer < 0) return false;
    return this.world.isAllied(owner, this.localPlayer);
  }

  teamColorHex(team) {
    const p = this.world.players.find((pl) => pl.team === team);
    return p ? p.colorHex : 0xffffff;
  }

  canPlace(type, bx, by) {
    return canPlace(this.world, this.localPlayer, type, bx, by);
  }

  isPoweredAt(x, y) {
    return this.world.isPoweredAt(this.localPlayer, x, y);
  }

  researchStatus(id) {
    return this.world.researchStatus(this.localPlayer, id);
  }

  hasCompleted(type) {
    return this.world.hasCompleted(this.localPlayer, type);
  }

  setSpeed(s) {
    this.speed = s;
  }

  setPaused(p) {
    this.paused = p;
  }

  stats() {
    return this.world.players.map((p) => ({ id: p.id, name: p.name, team: p.team, colorHex: p.colorHex, ...p.stats, eliminated: p.eliminated }));
  }

  dispose() {}
}
