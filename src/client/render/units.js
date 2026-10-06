// Instanced, procedurally animated unit renderer (one InstancedMesh per rig part).
import * as THREE from 'three';
import { TICK_RATE } from '../../shared/constants.js';
import { lancerGeometries, shaperGeometries } from './models.js';
import { instTint, instGlow } from './materials.js';

const tmpM = new THREE.Matrix4();
const tmpM2 = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);

function compose(out, x, y, z, rx, ry, rz, sx = 1, sy = 1, sz = 1, order = 'YZX') {
  tmpE.set(rx, ry, rz, order);
  tmpQ.setFromEuler(tmpE);
  return out.compose(tmpV.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
}

class Part {
  constructor(scene, geo, mat, perUnit, { shadow = true } = {}) {
    this.scene = scene;
    this.geo = geo;
    this.mat = mat;
    this.perUnit = perUnit;
    this.capacity = 0;
    this.mesh = null;
    this.count = 0;
    this.shadow = shadow;
    this.ensure(64);
  }

  ensure(n) {
    if (n <= this.capacity) return;
    const cap = Math.max(n, this.capacity * 2, 64);
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.dispose();
    }
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = this.shadow;
    mesh.receiveShadow = false;
    mesh.count = 0;
    this.scene.add(mesh);
    this.mesh = mesh;
    this.capacity = cap;
  }

  push(matrix, color) {
    if (this.count >= this.capacity) this.ensure(this.count + 1);
    this.mesh.setMatrixAt(this.count, matrix);
    this.mesh.setColorAt(this.count, color);
    this.count++;
  }

  begin() {
    this.count = 0;
  }

  end() {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class UnitRenderer {
  constructor(scene) {
    this.scene = scene;
    const tint = instTint({ metalness: 0.65, rough: 0.32 });
    const tintArmor = instTint({ metalness: 0.5, rough: 0.4, emissive: 0.0 });
    const g = instGlow();
    const L = lancerGeometries();
    this.lancer = {
      body: new Part(scene, L.body, tint, 1),
      plates: new Part(scene, L.plates, tintArmor, 1),
      visor: new Part(scene, L.visor, g, 1, { shadow: false }),
      leg: new Part(scene, L.leg, tint, 2),
      shaft: new Part(scene, L.shaft, tint, 1),
      blade: new Part(scene, L.blade, g, 1, { shadow: false }),
    };
    const S = shaperGeometries();
    this.shaper = {
      core: new Part(scene, S.core, g, 1, { shadow: false }),
      shell: new Part(scene, S.shell, tint, 1),
      ring: new Part(scene, S.ring, tint, 1),
      prong: new Part(scene, S.prong, tint, 3),
      thruster: new Part(scene, S.thruster, g, 1, { shadow: false }),
      cargo: new Part(scene, S.cargo, g, 1, { shadow: false }),
      eye: new Part(scene, S.eye, g, 1, { shadow: false }),
    };
    this.parts = [...Object.values(this.lancer), ...Object.values(this.shaper)];
    this.anim = new Map();
    this.colors = {
      armor: new THREE.Color(0xa9b4c8),
      dark: new THREE.Color(0x3a4252),
      shaft: new THREE.Color(0x9da7b8),
      shell: new THREE.Color(0xd9c58f),
      crystal: new THREE.Color(0x6fe2ff).multiplyScalar(2.0),
      flux: new THREE.Color(0x6bff9f).multiplyScalar(2.0),
      thruster: new THREE.Color(0x7fd8ff).multiplyScalar(1.6),
      blade: new THREE.Color(0xbff3ff).multiplyScalar(2.2),
    };
  }

  animState(u) {
    let a = this.anim.get(u.id);
    if (!a) {
      a = { walk: Math.random() * 6, lx: u.x, ly: u.y, speed: 0, seen: 0, swingTick: u.attackAnim ?? -100, swingStart: -10 };
      this.anim.set(u.id, a);
    }
    return a;
  }

  /**
   * @param {Array} units visible unit view-objects
   * @param {object} ctx { alpha, time, tick, heightAt(x,y), teamColor(owner), dt }
   */
  update(units, ctx) {
    for (const p of this.parts) p.begin();
    const frame = (this.frame = (this.frame || 0) + 1);
    for (const u of units) {
      if (u.hidden) continue;
      const a = this.animState(u);
      a.seen = frame;
      const rx = u.px + (u.x - u.px) * ctx.alpha;
      const ry = u.py + (u.y - u.py) * ctx.alpha;
      let df = u.facing - u.pfacing;
      while (df > Math.PI) df -= Math.PI * 2;
      while (df < -Math.PI) df += Math.PI * 2;
      const facing = u.pfacing + df * ctx.alpha;
      const moved = Math.hypot(rx - a.lx, ry - a.ly);
      a.lx = rx;
      a.ly = ry;
      const inst = ctx.dt > 0 ? moved / ctx.dt : 0;
      a.speed += (inst - a.speed) * Math.min(1, ctx.dt * 10);
      a.walk += moved * (u.type === 'lancer' ? 3.4 : 2);
      if (u.attackAnim !== undefined && u.attackAnim !== a.swingTick) {
        a.swingTick = u.attackAnim;
        a.swingStart = ctx.time;
      }
      const h = ctx.heightAt(rx, ry);
      const team = ctx.teamColor(u.owner);
      const warp = u.warping > 0 && u.warpTotal ? 1 - u.warping / u.warpTotal : 1;
      if (u.type === 'lancer') this.poseLancer(u, a, rx, ry, h, facing, team, warp, ctx);
      else this.poseShaper(u, a, rx, ry, h, facing, team, warp, ctx);
    }
    for (const p of this.parts) p.end();
    // GC animation state of units not seen for a while
    if (frame % 120 === 0) {
      for (const [id, a] of this.anim) if (frame - a.seen > 240) this.anim.delete(id);
    }
  }

  poseLancer(u, a, x, y, h, facing, team, warp, ctx) {
    const P = this.lancer;
    const moving = a.speed > 0.4;
    const t = ctx.time;
    const lunging = u.lunging > 0;
    const legSwing = moving ? Math.sin(a.walk) * (lunging ? 0.9 : 0.55) : 0;
    const bob = moving ? Math.abs(Math.cos(a.walk)) * 0.06 : Math.sin(t * 2 + u.id) * 0.012;
    const lean = lunging ? 0.42 : moving ? 0.1 : 0;
    const sc = (warp < 1 ? 0.35 + 0.65 * warp : 1) * 1.15;
    const base = compose(new THREE.Matrix4(), x, h, y, 0, -facing, 0, sc, sc, sc);
    // body with lean around hip
    const hip = 0.72;
    const bodyL = compose(tmpM2, 0, hip + bob, 0, 0, 0, -lean).multiply(tmpM.makeTranslation(0, -hip, 0));
    const bodyM = base.clone().multiply(bodyL);
    const warpTint = warp < 1;
    const armorC = warpTint ? tmpC.copy(team).multiplyScalar(1.5) : this.colors.armor;
    P.body.push(bodyM, armorC);
    P.plates.push(bodyM, warpTint ? tmpC.copy(team).multiplyScalar(1.6) : team);
    P.visor.push(bodyM, tmpC.copy(team).multiplyScalar(2.2));
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const legL = compose(tmpM2, 0, hip + bob, side * 0.13, 0, 0, legSwing * side);
      P.leg.push(base.clone().multiply(legL), this.colors.dark);
    }
    // weapon: rest pose diagonal, swing animation
    const since = ctx.time - a.swingStart;
    let wy = 0.55;
    let wz = 0.45;
    let wx = 0.9;
    if (since >= 0 && since < 0.55) {
      const k = since;
      if (k < 0.16) {
        const f = k / 0.16;
        wy = 0.55 + f * 0.75; // wind back
        wz = 0.45 - f * 0.35;
      } else if (k < 0.27) {
        const f = (k - 0.16) / 0.11;
        wy = 1.3 - f * 2.5; // forehand sweep
        wz = 0.1 - f * 0.05;
        wx = 0.9 - f * 0.4;
      } else if (k < 0.4) {
        const f = (k - 0.27) / 0.13;
        wy = -1.2 + f * 2.3; // backhand sweep
        wz = 0.05;
        wx = 0.5 + f * 0.2;
      } else {
        const f = (k - 0.4) / 0.15;
        wy = 1.1 - f * 0.55;
        wz = 0.05 + f * 0.4;
        wx = 0.7 + f * 0.2;
      }
    }
    if (lunging) {
      wy = 0.0;
      wz = -0.15;
      wx = 0.2;
    }
    const weaponL = compose(tmpM2, 0.32, 0.93, 0, wx * 0.0, wy, wz, 1, 1, 1, 'YZX');
    const weaponM = bodyM.clone().multiply(weaponL).multiply(compose(tmpM, 0, 0, 0, wx, 0, 0));
    P.shaft.push(weaponM, this.colors.shaft);
    const bladeC = tmpC.copy(this.colors.blade).lerp(team, 0.35).multiplyScalar(since >= 0 && since < 0.45 ? 1.4 : 1);
    P.blade.push(weaponM, bladeC);
  }

  poseShaper(u, a, x, y, h, facing, team, warp, ctx) {
    const P = this.shaper;
    const t = ctx.time;
    const moving = a.speed > 0.4;
    const mining = !!u.mining;
    const hover = 0.62 + Math.sin(t * 2.6 + u.id * 1.7) * 0.05;
    const tilt = moving ? 0.22 : 0;
    const sc = (warp < 1 ? 0.4 + 0.6 * warp : 1) * 1.15;
    const base = compose(new THREE.Matrix4(), x, h + hover, y, 0, -facing, -tilt, sc, sc, sc);
    P.core.push(base.clone().multiply(compose(tmpM, 0, 0, 0, 0, t * 2.2, 0)), tmpC.copy(team).multiplyScalar(2.0));
    P.shell.push(base, this.colors.shell);
    P.eye.push(base, tmpC.copy(team).multiplyScalar(2.4));
    P.ring.push(base.clone().multiply(compose(tmpM, 0, 0, 0, Math.PI / 2 + 0.35 * Math.sin(t + u.id), 0, t * 3)), this.colors.dark);
    const open = mining ? 0.35 + Math.sin(t * 14) * 0.12 : 0.12;
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2 + 0.3;
      const pl = compose(tmpM2, Math.cos(ang) * 0.13, -0.08, Math.sin(ang) * 0.13, 0, -ang, 0).multiply(compose(tmpM, 0, 0, 0, 0, 0, open));
      P.prong.push(base.clone().multiply(pl), this.colors.dark);
    }
    P.thruster.push(base.clone().multiply(compose(tmpM, 0, -0.17, 0, 0, 0, 0)), this.colors.thruster);
    if (u.carry) {
      const c = u.carry === 'flux' || u.carry.kind === 'flux' ? this.colors.flux : this.colors.crystal;
      P.cargo.push(base.clone().multiply(compose(tmpM, 0, -0.36, 0, 0, t * 3, 0)), c);
    }
  }

  // Bounding info for picking: approx height of each unit type
  static heightOf(type) {
    return type === 'lancer' ? 1.6 : 0.9;
  }
}

export { WHITE };
export const UNIT_TICK = 1 / TICK_RATE;
