// Main three.js renderer: scene graph for a running game session.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { heightAt } from '../../shared/maps/mapgen.js';
import { BUILDINGS, UNITS } from '../../shared/data/defs.js';
import { POWER_RADIUS, AEGIS_RANGE } from '../../shared/constants.js';
import { buildTerrain } from './terrain.js';
import { UnitRenderer } from './units.js';
import { Effects } from './effects.js';
import { fogUniforms, hologram, crystalMat, glow, applyFog } from './materials.js';
import { buildStructureModel, crystalClusterGeometry, buildVentModel, buildBeaconModel, buildRubbleModel } from './models.js';
import { RTSCamera } from '../input/camera.js';

const QUALITY = {
  low: { pixelRatio: 1, shadows: false, bloom: false, antialias: false, shadowSize: 1024 },
  medium: { pixelRatio: 1, shadows: true, bloom: false, antialias: true, shadowSize: 2048 },
  high: { pixelRatio: 1.5, shadows: true, bloom: true, antialias: true, shadowSize: 2048 },
  ultra: { pixelRatio: 2, shadows: true, bloom: true, antialias: true, shadowSize: 4096 },
};

export class GameRenderer {
  constructor(container, overlay, settings) {
    this.container = container;
    this.overlay = overlay;
    this.octx = overlay.getContext('2d');
    this.settings = settings;
    this.quality = QUALITY[settings.quality] || QUALITY.high;
    this.renderer = new THREE.WebGLRenderer({ antialias: this.quality.antialias, powerPreference: 'high-performance', preserveDrawingBuffer: !!settings.preserveDrawingBuffer });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 600);
    this.scene = null;
    this.session = null;
    this.time = 0;
    this.selected = new Set();
    this.hover = null;
    this.placement = null; // {type, bx, by, ok}
    this.warpPreview = null; // {x,y,ok}
    this.buildingMeshes = new Map();
    this.ghosts = new Map();
    this.neutralMeshes = new Map();
    this.ventMeshes = new Map();
    this.teamColors = new Map();
    this.fogTimer = 0;
    this.powerTimer = 0;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.tmpV = new THREE.Vector3();
    this.showPowerFor = false;
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q) {
    this.settings.quality = q;
    this.quality = QUALITY[q] || QUALITY.high;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio));
    this.renderer.shadowMap.enabled = this.quality.shadows;
    if (this.sun) {
      this.sun.castShadow = this.quality.shadows;
      this.sun.shadow.mapSize.set(this.quality.shadowSize, this.quality.shadowSize);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
    this.scene?.traverse((o) => {
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => (m.needsUpdate = true));
      }
    });
    this.resize();
  }

  // ------------------------------------------------------------------ session setup

  setSession(session) {
    this.disposeScene();
    this.session = session;
    const map = session.map;
    this.map = map;
    const scene = (this.scene = new THREE.Scene());
    const terrain = buildTerrain(map, scene);
    this.terrain = terrain;
    const theme = terrain.theme;
    scene.background = new THREE.Color(theme.sky);
    scene.fog = new THREE.Fog(theme.sky, 90, 260);
    this.hemi = new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, theme.hemiIntensity);
    scene.add(this.hemi);
    const sun = (this.sun = new THREE.DirectionalLight(theme.sun, theme.sunIntensity));
    sun.position.set(-30, 60, -20);
    sun.castShadow = this.quality.shadows;
    sun.shadow.mapSize.set(this.quality.shadowSize, this.quality.shadowSize);
    const sc = sun.shadow.camera;
    sc.left = -48;
    sc.right = 48;
    sc.top = 48;
    sc.bottom = -48;
    sc.near = 1;
    sc.far = 200;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    scene.add(sun.target);
    this.units = new UnitRenderer(scene);
    this.effects = new Effects(scene);
    this.rtsCamera = new RTSCamera(this.camera, map, (x, y) => heightAt(map, x, y));
    const start = session.startLocation();
    if (start) {
      this.rtsCamera.jumpTo(start.x, start.y + 4);
    }
    // fog & power textures
    const W = map.width;
    const H = map.height;
    this.fogData = new Uint8Array(W * H);
    this.fogTex = new THREE.DataTexture(this.fogData, W, H, THREE.RedFormat, THREE.UnsignedByteType);
    this.fogTex.magFilter = THREE.LinearFilter;
    this.fogTex.minFilter = THREE.LinearFilter;
    this.fogTex.needsUpdate = true;
    this.powerData = new Uint8Array(W * H);
    this.powerTex = new THREE.DataTexture(this.powerData, W, H, THREE.RedFormat, THREE.UnsignedByteType);
    this.powerTex.magFilter = THREE.LinearFilter;
    this.powerTex.minFilter = THREE.LinearFilter;
    this.powerTex.needsUpdate = true;
    fogUniforms.fogTex.value = this.fogTex;
    fogUniforms.powerTex.value = this.powerTex;
    fogUniforms.fogSize.value.set(W, H);
    fogUniforms.fogEnabled.value = session.fogEnabled === false ? 0 : 1;
    this.updateFog(true);

    // resources
    this.crystalGeo = crystalClusterGeometry(3);
    this.crystalMesh = new THREE.InstancedMesh(this.crystalGeo, crystalMat(0x2bb4ff, 0.75), 512);
    this.richMesh = new THREE.InstancedMesh(this.crystalGeo, crystalMat(0xffc23d, 0.6), 128);
    for (const m of [this.crystalMesh, this.richMesh]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      scene.add(m);
    }
    // selection rings
    const ringGeo = new THREE.RingGeometry(0.88, 1.0, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }),
      600,
    );
    this.rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(600 * 3), 3);
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 5;
    scene.add(this.rings);
    // placement ghost cells
    const cellGeo = new THREE.PlaneGeometry(0.92, 0.92);
    cellGeo.rotateX(-Math.PI / 2);
    this.cells = new THREE.InstancedMesh(
      cellGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false }),
      64,
    );
    this.cells.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3);
    this.cells.frustumCulled = false;
    this.cells.count = 0;
    scene.add(this.cells);
    this.placementModel = null;
    // aegis range / power radius preview disc
    this.rangeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1.0, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x6fd0ff, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false }),
    );
    this.rangeRing.visible = false;
    scene.add(this.rangeRing);

    // composer
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.5, 0.86);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.resize();
  }

  disposeScene() {
    if (!this.scene) return;
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.buildingMeshes.clear();
    this.ghosts.clear();
    this.neutralMeshes.clear();
    this.ventMeshes.clear();
    this.composer?.dispose?.();
    this.scene = null;
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.overlay.width = Math.floor(w * pr);
    this.overlay.height = Math.floor(h * pr);
    this.overlayScale = pr;
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
    }
    if (this.effects) this.effects.particles.uniforms.uScale.value = (h * pr) / 2;
    this.width = w;
    this.height = h;
  }

  teamColor(owner) {
    let c = this.teamColors.get(owner);
    if (!c) {
      const p = this.session.players[owner];
      c = new THREE.Color(p ? p.colorHex : 0xcccccc);
      this.teamColors.set(owner, c);
    }
    return c;
  }

  // ------------------------------------------------------------------ fog / power textures

  updateFog(force = false) {
    const s = this.session;
    const vis = s.visionArray();
    const exp = s.exploredArray();
    const d = this.fogData;
    const W = this.map.width;
    const H = this.map.height;
    if (!vis) {
      d.fill(255);
    } else {
      for (let i = 0; i < d.length; i++) d[i] = vis[i] ? 255 : exp[i] ? 120 : 0;
      // soften edges (one box blur pass on interior cells)
      if (!this.blurBuf || this.blurBuf.length !== d.length) this.blurBuf = new Uint8Array(d.length);
      const b = this.blurBuf;
      b.set(d);
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          d[i] = (b[i] * 4 + b[i - 1] + b[i + 1] + b[i - W] + b[i + W]) >> 3;
        }
      }
    }
    this.fogTex.needsUpdate = true;
    void force;
  }

  updatePower() {
    const s = this.session;
    const W = this.map.width;
    const H = this.map.height;
    const d = this.powerData;
    d.fill(0);
    for (const b of s.buildings()) {
      if (b.type !== 'conduit' || b.owner !== s.localPlayer || !b.built) continue;
      const R = POWER_RADIUS;
      for (let y = Math.max(0, Math.floor(b.y - R - 1)); y <= Math.min(H - 1, Math.ceil(b.y + R + 1)); y++) {
        for (let x = Math.max(0, Math.floor(b.x - R - 1)); x <= Math.min(W - 1, Math.ceil(b.x + R + 1)); x++) {
          const dd = Math.hypot(x + 0.5 - b.x, y + 0.5 - b.y);
          const v = Math.max(0, Math.min(1, 0.5 + (R - dd) * 0.9));
          const i = y * W + x;
          d[i] = Math.max(d[i], Math.round(v * 255));
        }
      }
    }
    this.powerTex.needsUpdate = true;
  }

  // ------------------------------------------------------------------ picking

  hAt(x, y) {
    return heightAt(this.map, x, y);
  }

  screenRay(sx, sy) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((sx - rect.left) / rect.width) * 2 - 1, -((sy - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.ray;
  }

  // Ray-march the heightfield to find the ground point under the cursor
  pickGround(sx, sy) {
    const ray = this.screenRay(sx, sy);
    const o = ray.origin;
    const d = ray.direction;
    if (d.y >= -1e-4) return null;
    let t = Math.max(0, (o.y - 5) / -d.y);
    const tEnd = (o.y + 4) / -d.y;
    let prevT = t;
    for (let i = 0; i < 400 && t < tEnd; i++) {
      const x = o.x + d.x * t;
      const z = o.z + d.z * t;
      const y = o.y + d.y * t;
      const h = this.hAt(Math.min(Math.max(x, 0), this.map.width), Math.min(Math.max(z, 0), this.map.height));
      if (y <= h) {
        // refine
        let lo = prevT;
        let hi = t;
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) / 2;
          const mx = o.x + d.x * mid;
          const mz = o.z + d.z * mid;
          const my = o.y + d.y * mid;
          if (my <= this.hAt(mx, mz)) hi = mid;
          else lo = mid;
        }
        const x2 = o.x + d.x * hi;
        const z2 = o.z + d.z * hi;
        return { x: Math.min(Math.max(x2, 0), this.map.width - 0.01), y: Math.min(Math.max(z2, 0), this.map.height - 0.01) };
      }
      prevT = t;
      t += 0.35;
    }
    const x = o.x + d.x * tEnd;
    const z = o.z + d.z * tEnd;
    return { x: Math.min(Math.max(x, 0), this.map.width - 0.01), y: Math.min(Math.max(z, 0), this.map.height - 0.01) };
  }

  project(x, y, h) {
    this.tmpV.set(x, h, y).project(this.camera);
    return {
      x: (this.tmpV.x * 0.5 + 0.5) * this.width,
      y: (-this.tmpV.y * 0.5 + 0.5) * this.height,
      z: this.tmpV.z,
    };
  }

  entityRadiusPx(e, cx, cy, h) {
    const r = e.kind === 'unit' ? Math.max(0.45, e.r * 1.2) : Math.max(e.w, e.h) * 0.55;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const p2 = this.tmpV.set(e.x + right.x * r, h, e.y + right.z * r).project(this.camera);
    const px = (p2.x * 0.5 + 0.5) * this.width;
    const py = (-p2.y * 0.5 + 0.5) * this.height;
    return Math.hypot(px - cx, py - cy);
  }

  pickEntity(sx, sy, { includeResources = true } = {}) {
    const s = this.session;
    let best = null;
    let bestScore = Infinity;
    const consider = (e, hMid) => {
      const gh = this.hAt(e.x, e.y);
      const c = this.project(e.x, e.y, gh + hMid);
      if (c.z > 1) return;
      const r = this.entityRadiusPx(e, c.x, c.y, gh + hMid) + 6;
      const d = Math.hypot(sx - c.x, sy - c.y);
      if (d > r) return;
      const score = d / r + (e.kind === 'unit' ? 0 : 0.6);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    };
    for (const u of s.units()) {
      if (u.hidden || !s.isVisible(u)) continue;
      consider(u, u.type === 'lancer' ? 0.8 : 0.6);
    }
    for (const b of s.buildings()) {
      if (!s.isVisible(b) && b.owner !== s.localPlayer) continue;
      consider(b, 1.0);
    }
    if (includeResources) {
      for (const r of s.resources()) {
        if (!s.isExplored(r.x, r.y)) continue;
        consider(r, 0.4);
      }
      for (const n of s.neutrals()) {
        if (!s.isExplored(n.x, n.y)) continue;
        consider(n, 0.8);
      }
    }
    return best;
  }

  unitsInRect(x0, y0, x1, y1) {
    const s = this.session;
    const out = [];
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    for (const u of s.units()) {
      if (u.hidden || !s.isVisible(u)) continue;
      const c = this.project(u.x, u.y, this.hAt(u.x, u.y) + 0.6);
      if (c.x >= minX - 6 && c.x <= maxX + 6 && c.y >= minY - 6 && c.y <= maxY + 6) out.push(u);
    }
    for (const b of s.buildings()) {
      if (!s.isVisible(b)) continue;
      const c = this.project(b.x, b.y, this.hAt(b.x, b.y) + 1);
      if (c.x >= minX && c.x <= maxX && c.y >= minY && c.y <= maxY) out.push(b);
    }
    return out;
  }

  // corners of the camera view on the ground (for the minimap)
  viewQuad() {
    const pts = [
      [0, 0],
      [this.width, 0],
      [this.width, this.height],
      [0, this.height],
    ];
    const rect = this.renderer.domElement.getBoundingClientRect();
    return pts.map(([x, y]) => {
      const ray = this.screenRay(rect.left + x, rect.top + y);
      const gy = this.rtsCamera.ground;
      const t = ray.direction.y < -1e-3 ? (ray.origin.y - gy) / -ray.direction.y : 200;
      return { x: ray.origin.x + ray.direction.x * t, y: ray.origin.z + ray.direction.z * t };
    });
  }

  // ------------------------------------------------------------------ per-frame sync

  render(dt) {
    if (!this.scene || !this.session) return;
    this.time += dt;
    fogUniforms.time.value = this.time;
    const s = this.session;
    this.rtsCamera.update(dt);
    // shadow camera follows view
    const tgt = this.rtsCamera.target;
    const snap = 2;
    this.sun.position.set(Math.round(tgt.x / snap) * snap - 30, 60, Math.round(tgt.z / snap) * snap - 20);
    this.sun.target.position.set(Math.round(tgt.x / snap) * snap, 0, Math.round(tgt.z / snap) * snap);

    this.fogTimer -= dt;
    if (this.fogTimer <= 0) {
      this.fogTimer = 0.1;
      this.updateFog();
    }
    const wantPower = !!(this.placement && BUILDINGS[this.placement.type]?.needsPower) || this.warpPreview || this.showPowerFor;
    fogUniforms.powerShow.value = wantPower ? 1 : 0;
    if (wantPower) {
      this.powerTimer -= dt;
      if (this.powerTimer <= 0) {
        this.powerTimer = 0.5;
        this.updatePower();
      }
    }
    const alpha = s.alpha();
    const ctx = {
      alpha,
      time: this.time,
      dt,
      heightAt: (x, y) => this.hAt(x, y),
      teamColor: (o) => this.teamColor(o),
    };
    const visibleUnits = [];
    for (const u of s.units()) {
      if (u.owner === s.localPlayer || s.isVisible(u)) visibleUnits.push(u);
    }
    this.visibleUnits = visibleUnits;
    this.units.update(visibleUnits, ctx);
    this.syncBuildings(alpha);
    this.syncResources();
    this.syncNeutrals();
    this.effects.beginBeams();
    this.unitEffects(visibleUnits, alpha);
    this.syncSelection(alpha);
    this.syncPlacement();
    this.effects.endBeams();
    this.effects.update(dt);
    if (this.terrain.group.userData.lava) this.terrain.group.userData.lava.uniforms.uTime.value = this.time;

    if (this.quality.bloom) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.drawOverlay();
  }

  syncBuildings(alpha) {
    const s = this.session;
    const seen = new Set();
    const local = s.localPlayer;
    // remember enemy structures as ghosts once seen
    for (const b of s.buildings()) {
      const visible = b.owner === local || s.isAllied(b.owner) || s.isVisible(b);
      if (visible) {
        seen.add(b.id);
        this.ghosts.delete(b.id);
        if (b.owner !== local && !s.isAllied(b.owner)) {
          this.ghosts.set(b.id, { id: b.id, type: b.type, owner: b.owner, x: b.x, y: b.y, bx: b.bx, by: b.by, w: b.w, h: b.h, built: b.built, progress: b.progress, ghost: true, kind: 'building', hp: b.hp, maxHp: b.maxHp });
        }
        this.placeBuilding(b);
      }
    }
    for (const [id, g] of this.ghosts) {
      if (seen.has(id)) continue;
      // if the location is visible now and the building isn't there, forget it
      if (s.isVisible({ kind: 'building', bx: g.bx, by: g.by, w: g.w, h: g.h, x: g.x, y: g.y })) {
        this.ghosts.delete(id);
        continue;
      }
      seen.add(id);
      this.placeBuilding(g);
    }
    for (const [id, m] of this.buildingMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(m.group);
        this.buildingMeshes.delete(id);
      }
    }
    void alpha;
  }

  placeBuilding(b) {
    let m = this.buildingMeshes.get(b.id);
    if (!m || m.type !== b.type) {
      if (m) this.scene.remove(m.group);
      const model = buildStructureModel(b.type, this.teamColor(b.owner).getHex());
      m = { ...model, type: b.type, built: null, phase: false };
      model.group.traverse((o) => {
        if (o.isMesh) o.userData.mat = o.material;
      });
      this.scene.add(model.group);
      this.buildingMeshes.set(b.id, m);
    }
    const g = m.group;
    const h = this.hAt(b.x, b.y);
    g.position.set(b.x, h, b.y);
    if (m.built !== b.built) {
      m.built = b.built;
      const holo = hologram(this.teamColor(b.owner).getHex());
      g.traverse((o) => {
        if (o.isMesh && o.userData.mat && !(o.userData.mat instanceof THREE.ShaderMaterial)) {
          o.material = b.built ? o.userData.mat : holo;
          o.castShadow = b.built;
        }
      });
    }
    if (!b.built) {
      const p = b.progress ?? 0;
      g.scale.set(1, 0.2 + 0.8 * p, 1);
      if (Math.random() < 0.3) {
        const c = this.teamColor(b.owner);
        this.effects.particles.emit(b.x + (Math.random() - 0.5) * b.w, h + (0.2 + 2.5 * p) * Math.random(), b.y + (Math.random() - 0.5) * b.h, { count: 1, color: [c.r * 1.5, c.g * 1.5, c.b * 1.5], speed: 0.3, up: 1.5, life: 0.7, size: 0.18 });
      }
    } else g.scale.set(1, 1, 1);
    const powered = b.powered !== false;
    const t = this.time;
    for (const sp of m.anim.spin) sp.obj.rotation[sp.axis] = (powered ? t : 0) * sp.speed + (b.id % 7);
    for (const bo of m.anim.bob) bo.obj.position.y = bo.base + Math.sin(t * bo.speed + b.id) * bo.amp * (powered ? 1 : 0.2);
    if (m.anim.portalSurface) {
      const u = m.anim.portalSurface.material.uniforms;
      u.uTime.value = t;
      u.uPower.value = b.built && powered ? 1 : 0.15;
      u.uPhase.value = b.phase ? 1 : Math.min(1, (b.transform || 0) / 7);
      if (m.anim.ring) m.anim.ring.rotation.z = b.phase ? t * 0.5 : 0;
    }
    for (const gl of m.anim.glows) gl.scale.setScalar(powered ? 0.9 + Math.sin(t * 4 + b.id) * 0.12 : 0.5);
    // damage fire
    if (b.built && b.hp < b.maxHp * 0.5 && !b.ghost && Math.random() < 0.25) {
      this.effects.particles.emit(b.x + (Math.random() - 0.5) * b.w * 0.6, h + 1.2, b.y + (Math.random() - 0.5) * b.h * 0.6, { count: 1, color: [1.4, 0.55, 0.15], speed: 0.4, up: 2, life: 0.9, size: 0.5, sizeEnd: 0.1 });
      if (Math.random() < 0.5) this.effects.particles.emit(b.x, h + 1.8, b.y, { count: 1, color: [0.25, 0.25, 0.28], speed: 0.3, up: 2.5, life: 2, size: 0.8, sizeEnd: 1.8, alpha: 0.5, drag: 0.5 });
    }
    if (b.overclock > 0 && Math.random() < 0.5) {
      this.effects.particles.emit(b.x, h + 2.2, b.y, { count: 1, color: [1.6, 1.4, 0.5], speed: 1.5, up: 0.5, life: 0.6, size: 0.22, spread: 0.2 });
    }
  }

  syncResources() {
    const s = this.session;
    const dummy = this.dummy || (this.dummy = new THREE.Object3D());
    let n = 0;
    let nr = 0;
    const seenVents = new Set();
    for (const r of s.resources()) {
      if (!s.isExplored(r.x, r.y)) continue;
      const h = this.hAt(r.x, r.y);
      if (r.type === 'crystal') {
        const ratio = r.maxAmount ? Math.max(0.35, r.amount / r.maxAmount) : 1;
        dummy.position.set(r.x, h, r.y);
        dummy.rotation.set(0, (r.id * 1.7) % 6.28, 0);
        dummy.scale.set(1, 0.55 + 0.45 * ratio, 1);
        dummy.updateMatrix();
        if (r.rich) this.richMesh.setMatrixAt(nr++, dummy.matrix);
        else this.crystalMesh.setMatrixAt(n++, dummy.matrix);
      } else if (r.type === 'vent') {
        seenVents.add(r.id);
        let vm = this.ventMeshes.get(r.id);
        if (!vm) {
          vm = buildVentModel();
          vm.group.position.set(r.x, h, r.y);
          this.scene.add(vm.group);
          this.ventMeshes.set(r.id, vm);
        }
        vm.group.visible = !r.siphon;
        if (!r.siphon && r.amount > 0 && Math.random() < 0.08) {
          this.effects.particles.emit(r.x, h + 0.3, r.y, { count: 1, color: [0.3, 0.9, 0.5], speed: 0.3, up: 2, life: 2.2, size: 0.9, sizeEnd: 2.0, alpha: 0.25, drag: 0.4 });
        }
      }
    }
    for (const [id, vm] of this.ventMeshes) {
      if (!seenVents.has(id)) {
        this.scene.remove(vm.group);
        this.ventMeshes.delete(id);
      }
    }
    this.crystalMesh.count = n;
    this.richMesh.count = nr;
    this.crystalMesh.instanceMatrix.needsUpdate = true;
    this.richMesh.instanceMatrix.needsUpdate = true;
  }

  syncNeutrals() {
    const s = this.session;
    const seen = new Set();
    for (const nObj of s.neutrals()) {
      if (!s.isExplored(nObj.x, nObj.y)) continue;
      seen.add(nObj.id);
      let m = this.neutralMeshes.get(nObj.id);
      if (!m) {
        m = nObj.type === 'beacon' ? buildBeaconModel() : buildRubbleModel();
        m.group.position.set(nObj.x, this.hAt(nObj.x, nObj.y), nObj.y);
        this.scene.add(m.group);
        this.neutralMeshes.set(nObj.id, m);
      }
      if (nObj.type === 'beacon') {
        const held = nObj.holders && nObj.holders.length;
        const team = held ? this.session.teamColorHex(nObj.holders[0]) : 0x9aa6b8;
        m.mat.color.set(team).multiplyScalar(held ? 2.2 : 0.9);
        m.gem.rotation.y = this.time * 0.8;
        if (held) {
          const h = this.hAt(nObj.x, nObj.y);
          this.effects.beam(new THREE.Vector3(nObj.x, h + 3.9, nObj.y), new THREE.Vector3(nObj.x, h + 14, nObj.y), new THREE.Color(team).multiplyScalar(0.6), 0.12);
        }
      }
    }
    for (const [id, m] of this.neutralMeshes) {
      if (!seen.has(id)) {
        if (m.group.userData.dying) continue;
        this.scene.remove(m.group);
        this.neutralMeshes.delete(id);
      }
    }
  }

  unitEffects(units, alpha) {
    const s = this.session;
    const beamC = this._beamC || (this._beamC = new THREE.Color());
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const u of units) {
      const rx = u.px + (u.x - u.px) * alpha;
      const ry = u.py + (u.y - u.py) * alpha;
      const h = this.hAt(rx, ry);
      if (u.warping > 0) {
        const prog = u.warpTotal ? 1 - u.warping / u.warpTotal : 0.5;
        this.effects.warpColumn(u.id, rx, h, ry, prog, this.teamColor(u.owner).getHex());
      }
      if (u.mining && !u.hidden) {
        const r = s.byId(u.mining);
        if (r) {
          const cx = Math.min(Math.max(rx, r.bx), r.bx + r.w);
          const cy = Math.min(Math.max(ry, r.by), r.by + r.h);
          a.set(rx, h + 0.45, ry);
          b.set(cx, this.hAt(cx, cy) + 0.35, cy);
          const flick = 0.6 + Math.sin(this.time * 40 + u.id) * 0.3;
          beamC.setRGB(0.4 * flick, 1.0 * flick, 1.4 * flick);
          this.effects.beam(a, b, beamC, 0.025);
          if (Math.random() < 0.15) this.effects.particles.emit(b.x, b.y, b.z, { count: 2, color: [0.5, 1.3, 1.8], speed: 1.2, life: 0.35, size: 0.12 });
        }
      }
      if (u.lunging > 0 && Math.random() < 0.9) {
        const c = this.teamColor(u.owner);
        this.effects.particles.emit(rx, h + 0.9, ry, { count: 2, color: [c.r * 1.8, c.g * 1.8, c.b * 1.8], speed: 0.4, up: 0.2, life: 0.4, size: 0.5, sizeEnd: 0.05, jitter: 0.4 });
      }
    }
    // Aegis beams
    for (const bld of s.buildings()) {
      if (bld.type !== 'aegis' || !bld.beam) continue;
      if (!(bld.owner === s.localPlayer || s.isVisible(bld))) continue;
      const t = s.byId(bld.beam);
      if (!t) continue;
      a.set(bld.x, this.hAt(bld.x, bld.y) + 1.3, bld.y);
      const tx = t.kind === 'unit' ? t.px + (t.x - t.px) * alpha : t.x;
      const ty = t.kind === 'unit' ? t.py + (t.y - t.py) * alpha : t.y;
      b.set(tx, this.hAt(tx, ty) + (t.kind === 'unit' ? 0.8 : 1.2), ty);
      beamC.setRGB(0.5, 1.2, 2.0);
      this.effects.beam(a, b, beamC, 0.06);
    }
  }

  syncSelection(alpha) {
    const s = this.session;
    const rings = this.rings;
    let n = 0;
    const c = new THREE.Color();
    const dummy = this.dummy;
    const add = (e, color, scale = 1) => {
      if (n >= 600) return;
      let x = e.x;
      let y = e.y;
      if (e.kind === 'unit') {
        x = e.px + (e.x - e.px) * alpha;
        y = e.py + (e.y - e.py) * alpha;
      }
      const r = (e.kind === 'unit' ? e.r * 1.35 + 0.08 : Math.max(e.w, e.h) * 0.62) * scale;
      dummy.position.set(x, this.hAt(x, y) + 0.06, y);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(r, 1, r);
      dummy.updateMatrix();
      rings.setMatrixAt(n, dummy.matrix);
      rings.setColorAt(n, color);
      n++;
    };
    let showRangeFor = null;
    for (const id of this.selected) {
      const e = s.byId(id);
      if (!e) continue;
      if (e.kind === 'unit' && !s.isVisible(e) && e.owner !== s.localPlayer) continue;
      if (e.owner === s.localPlayer) c.setRGB(0.3, 1.4, 0.5);
      else if (e.owner >= 0 && s.isAllied(e.owner)) c.setRGB(0.4, 0.9, 1.6);
      else if (e.owner >= 0) c.setRGB(1.6, 0.3, 0.3);
      else c.setRGB(1.5, 1.3, 0.4);
      add(e, c);
      if (e.type === 'aegis' || e.type === 'conduit') showRangeFor = e;
      // rally line
      if (e.kind === 'building' && e.owner === s.localPlayer && e.rally && e.built && (e.def?.trains?.length || UNITS_TRAINED[e.type])) {
        const a = new THREE.Vector3(e.x, this.hAt(e.x, e.y) + 0.3, e.y);
        const b = new THREE.Vector3(e.rally.x, this.hAt(e.rally.x, e.rally.y) + 0.3, e.rally.y);
        this.effects.beam(a, b, c.setRGB(0.2, 0.9, 0.35), 0.03);
      }
    }
    if (this.hover && !this.selected.has(this.hover.id)) {
      const e = this.hover;
      if (e.owner === s.localPlayer) c.setRGB(0.2, 0.7, 0.3);
      else if (e.owner >= 0 && !s.isAllied(e.owner)) c.setRGB(0.8, 0.2, 0.2);
      else c.setRGB(0.7, 0.65, 0.25);
      add(e, c, 1.0);
    }
    rings.count = n;
    rings.instanceMatrix.needsUpdate = true;
    if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
    this.showPowerFor = showRangeFor && showRangeFor.type === 'conduit' && showRangeFor.owner === s.localPlayer;
    if (showRangeFor && showRangeFor.type === 'aegis') {
      this.rangeRing.visible = true;
      const r = AEGIS_RANGE + 1;
      this.rangeRing.position.set(showRangeFor.x, this.hAt(showRangeFor.x, showRangeFor.y) + 0.1, showRangeFor.y);
      this.rangeRing.scale.set(r, 1, r);
    } else this.rangeRing.visible = false;
  }

  syncPlacement() {
    const p = this.placement;
    const cells = this.cells;
    if (!p) {
      cells.count = 0;
      if (this.placementModel) this.placementModel.group.visible = false;
      return;
    }
    const def = BUILDINGS[p.type];
    const size = def.size;
    if (!this.placementModel || this.placementModel.type !== p.type) {
      if (this.placementModel) this.scene.remove(this.placementModel.group);
      const model = buildStructureModel(p.type, this.teamColor(this.session.localPlayer).getHex());
      const holo = hologram(0x7fd0ff);
      model.group.traverse((o) => {
        if (o.isMesh && !(o.material instanceof THREE.ShaderMaterial)) {
          o.material = holo;
          o.castShadow = false;
        }
      });
      this.scene.add(model.group);
      this.placementModel = { ...model, type: p.type };
    }
    const cx = p.bx + size / 2;
    const cy = p.by + size / 2;
    this.placementModel.group.visible = true;
    this.placementModel.group.position.set(cx, this.hAt(cx, cy), cy);
    const dummy = this.dummy;
    const c = new THREE.Color();
    let n = 0;
    for (let y = p.by; y < p.by + size; y++) {
      for (let x = p.bx; x < p.bx + size; x++) {
        const ok = p.cellOk ? p.cellOk(x, y) : p.ok;
        c.setRGB(ok ? 0.2 : 1.4, ok ? 1.3 : 0.2, ok ? 0.4 : 0.2);
        dummy.position.set(x + 0.5, this.hAt(x + 0.5, y + 0.5) + 0.07, y + 0.5);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        cells.setMatrixAt(n, dummy.matrix);
        cells.setColorAt(n, c);
        n++;
      }
    }
    cells.count = n;
    cells.instanceMatrix.needsUpdate = true;
    if (cells.instanceColor) cells.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------------ 2D overlay

  drawOverlay() {
    const ctx = this.octx;
    const pr = this.overlayScale || 1;
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const s = this.session;
    const mode = this.settings.healthBars || 'damaged';
    const draw = (e, hTop) => {
      const sel = this.selected.has(e.id);
      const damaged = e.hp < e.maxHp || (e.maxBarrier && e.barrier < e.maxBarrier);
      if (!(mode === 'always' || sel || (mode === 'damaged' && damaged) || this.hover === e)) return;
      const x = e.kind === 'unit' ? e.px + (e.x - e.px) * s.alpha() : e.x;
      const y = e.kind === 'unit' ? e.py + (e.y - e.py) * s.alpha() : e.y;
      const p = this.project(x, y, this.hAt(x, y) + hTop);
      if (p.z > 1 || p.x < -50 || p.y < -50 || p.x > this.width + 50 || p.y > this.height + 50) return;
      const w = e.kind === 'unit' ? (e.type === 'lancer' ? 34 : 26) : Math.max(40, e.w * 16);
      const bx = Math.round(p.x - w / 2);
      let by = Math.round(p.y - 10);
      if (e.maxBarrier) {
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(bx - 1, by - 1, w + 2, 5);
        ctx.fillStyle = '#5fc6ff';
        ctx.fillRect(bx, by, Math.max(0, (w * e.barrier) / e.maxBarrier), 3);
        by += 4;
      }
      const f = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(bx - 1, by - 1, w + 2, 5);
      ctx.fillStyle = f > 0.6 ? '#4be37f' : f > 0.3 ? '#ffd04a' : '#ff5a5a';
      ctx.fillRect(bx, by, Math.max(0, w * f), 3);
      if (e.maxEnergy && e.owner === s.localPlayer) {
        by += 4;
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(bx - 1, by - 1, w + 2, 5);
        ctx.fillStyle = '#c47cff';
        ctx.fillRect(bx, by, Math.max(0, (w * e.energy) / e.maxEnergy), 3);
      }
      if (e.kind === 'building' && !e.built && e.owner === s.localPlayer) {
        ctx.font = '11px Consolas, monospace';
        ctx.fillStyle = '#bfe8ff';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.floor((e.progress || 0) * 100)}%`, p.x, by + 14);
      }
    };
    for (const u of this.visibleUnits || []) {
      if (u.hidden) continue;
      draw(u, u.type === 'lancer' ? 1.95 : 1.25);
    }
    for (const b of s.buildings()) {
      if (b.owner !== s.localPlayer && !s.isVisible(b)) continue;
      draw(b, b.type === 'citadel' ? 5 : b.type === 'conduit' ? 2.6 : 3);
    }
    for (const n of s.neutrals()) {
      if (n.type === 'rubble' && s.isVisible(n)) draw(n, 1.5);
    }
    // drag box
    if (this.dragBox) {
      const { x0, y0, x1, y1 } = this.dragBox;
      ctx.strokeStyle = 'rgba(80, 255, 140, 0.9)';
      ctx.fillStyle = 'rgba(80, 255, 140, 0.08)';
      ctx.lineWidth = 1;
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
    }
  }
}

const UNITS_TRAINED = { citadel: true, portal: true };
export { UNITS, applyFog, glow };
