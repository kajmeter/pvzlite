// Visual effects: particles, glaive slashes, barrier flashes, beams, markers, warp columns.
import * as THREE from 'three';

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Particles {
  constructor(scene, max = 6000) {
    this.max = max;
    this.n = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 400 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `attribute float size; attribute vec4 pcolor; varying vec4 vColor; uniform float uScale;
        void main(){ vColor = pcolor; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vColor;
        void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.05, d); gl_FragColor = vec4(vColor.rgb, vColor.a * a); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
    this.geo = geo;
  }

  emit(x, y, z, o = {}) {
    const count = o.count || 10;
    const color = o.color || [1, 1, 1];
    for (let k = 0; k < count; k++) {
      if (this.n >= this.max) return;
      const i = this.n++;
      const sp = (o.speed ?? 2) * (0.4 + Math.random() * 0.6);
      const a = Math.random() * Math.PI * 2;
      const up = o.up ?? 0.5;
      const el = (Math.random() * 2 - 1) * (o.spread ?? 1);
      let vx = Math.cos(a) * sp * (1 - Math.abs(el) * 0.5);
      let vz = Math.sin(a) * sp * (1 - Math.abs(el) * 0.5);
      let vy = up * sp + el * sp * 0.5;
      if (o.dir) {
        vx = o.dir[0] * sp + vx * 0.3;
        vy = o.dir[1] * sp + vy * 0.3;
        vz = o.dir[2] * sp + vz * 0.3;
      }
      const j = o.jitter ?? 0.1;
      this.pos[i * 3] = x + (Math.random() - 0.5) * j;
      this.pos[i * 3 + 1] = y + (Math.random() - 0.5) * j;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * j;
      this.vel[i * 3] = vx;
      this.vel[i * 3 + 1] = vy;
      this.vel[i * 3 + 2] = vz;
      const life = (o.life ?? 0.6) * (0.6 + Math.random() * 0.4);
      this.life[i] = life;
      this.maxLife[i] = life;
      this.s0[i] = o.size ?? 0.3;
      this.s1[i] = o.sizeEnd ?? (o.size ?? 0.3) * 0.2;
      this.a0[i] = o.alpha ?? 1;
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 1.5;
      const cv = o.colorVar ?? 0.1;
      this.col[i * 4] = color[0] * (1 - cv + Math.random() * cv * 2);
      this.col[i * 4 + 1] = color[1] * (1 - cv + Math.random() * cv * 2);
      this.col[i * 4 + 2] = color[2] * (1 - cv + Math.random() * cv * 2);
      this.col[i * 4 + 3] = this.a0[i];
      this.size[i] = this.s0[i];
    }
  }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        const last = --this.n;
        if (i !== last) this.copy(last, i);
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.col[i * 4 + 3] = this.a0[i] * (1 - t * t);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.pcolor.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }

  copy(from, to) {
    for (let k = 0; k < 3; k++) {
      this.pos[to * 3 + k] = this.pos[from * 3 + k];
      this.vel[to * 3 + k] = this.vel[from * 3 + k];
    }
    for (let k = 0; k < 4; k++) this.col[to * 4 + k] = this.col[from * 4 + k];
    this.size[to] = this.size[from];
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.s0[to] = this.s0[from];
    this.s1[to] = this.s1[from];
    this.a0[to] = this.a0[from];
    this.grav[to] = this.grav[from];
    this.drag[to] = this.drag[from];
  }
}

// Pool of short-lived meshes animated by a callback
class Pool {
  constructor(scene, make, size) {
    this.items = [];
    for (let i = 0; i < size; i++) {
      const m = make();
      m.visible = false;
      scene.add(m);
      this.items.push({ mesh: m, t: 0, life: 0, active: false, data: null });
    }
    this.next = 0;
  }

  spawn(life, data) {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    it.active = true;
    it.t = 0;
    it.life = life;
    it.data = data;
    it.mesh.visible = true;
    return it;
  }

  update(dt, fn) {
    for (const it of this.items) {
      if (!it.active) continue;
      it.t += dt;
      if (it.t >= it.life) {
        it.active = false;
        it.mesh.visible = false;
        continue;
      }
      fn(it, it.t / it.life);
    }
  }
}

const barrierShader = {
  vertexShader: `varying vec3 vN; varying vec3 vV;
    void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying vec3 vN; varying vec3 vV;
    void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.2); gl_FragColor = vec4(uColor * (0.4 + f * 1.6), uAlpha * (0.15 + f)); }`,
};

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.particles = new Particles(scene);
    this.flashTex = radialTexture();
    const slashGeo = new THREE.RingGeometry(0.55, 0.95, 20, 1, -Math.PI * 0.45, Math.PI * 0.9);
    slashGeo.rotateX(-Math.PI / 2);
    this.slashes = new Pool(
      scene,
      () =>
        new THREE.Mesh(
          slashGeo,
          new THREE.MeshBasicMaterial({
            color: 0xbff3ff,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          }),
        ),
      64,
    );
    const sph = new THREE.SphereGeometry(1, 20, 14);
    this.bubbles = new Pool(
      scene,
      () =>
        new THREE.Mesh(
          sph,
          new THREE.ShaderMaterial({
            uniforms: { uColor: { value: new THREE.Color(0x7fd0ff) }, uAlpha: { value: 1 } },
            ...barrierShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        ),
      48,
    );
    this.flashes = new Pool(
      scene,
      () =>
        new THREE.Sprite(
          new THREE.SpriteMaterial({ map: this.flashTex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
        ),
      40,
    );
    const ringGeo = new THREE.RingGeometry(0.8, 1.0, 32);
    ringGeo.rotateX(-Math.PI / 2);
    this.markers = new Pool(
      scene,
      () =>
        new THREE.Mesh(
          ringGeo,
          new THREE.MeshBasicMaterial({ color: 0x46e08a, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
        ),
      24,
    );
    this.shockwaves = new Pool(
      scene,
      () =>
        new THREE.Mesh(
          ringGeo,
          new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
        ),
      16,
    );
    const boltGeo = new THREE.SphereGeometry(1, 10, 8);
    this.bolts = new Pool(
      scene,
      () => new THREE.Mesh(boltGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })),
      48,
    );
    // beams: instanced thin cylinders
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    beamGeo.translate(0, 0.5, 0);
    this.beamMesh = new THREE.InstancedMesh(
      beamGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
      256,
    );
    this.beamMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(256 * 3), 3);
    this.beamMesh.frustumCulled = false;
    this.beamMesh.count = 0;
    scene.add(this.beamMesh);
    this.beamCount = 0;
    // warp columns
    this.warpGeo = new THREE.CylinderGeometry(0.7, 0.7, 3.5, 20, 1, true);
    this.warpGeo.translate(0, 1.75, 0);
    this.warps = new Map();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._c = new THREE.Color();
  }

  // crystal bolt fired by a turret: a glowing head travelling to the target with a trail
  bolt(ax, ay, az, bx, by, bz, color, heavy = false) {
    const it = this.bolts.spawn(heavy ? 0.22 : 0.16, { a: [ax, ay, az], b: [bx, by, bz], heavy, color: [color.r, color.g, color.b] });
    it.mesh.material.color.setRGB(color.r * 2.2, color.g * 2.2, color.b * 2.2);
    it.mesh.scale.setScalar(heavy ? 0.35 : 0.22);
    it.mesh.position.set(ax, ay, az);
  }

  slash(x, y, z, facing, color, flip) {
    const it = this.slashes.spawn(0.22, { flip });
    const m = it.mesh;
    m.position.set(x, y, z);
    m.rotation.set(flip ? Math.PI : 0, -facing, 0);
    m.material.color.copy(color).lerp(new THREE.Color(0xffffff), 0.45).multiplyScalar(1.35);
  }

  bubble(x, y, z, r, color) {
    const it = this.bubbles.spawn(0.3, { r });
    it.mesh.position.set(x, y, z);
    it.mesh.scale.setScalar(r);
    it.mesh.material.uniforms.uColor.value.copy(color);
  }

  flash(x, y, z, size, color = 0xffffff, life = 0.35) {
    const it = this.flashes.spawn(life, { size });
    it.mesh.position.set(x, y, z);
    it.mesh.material.color.set(color);
    it.mesh.scale.setScalar(size * 0.3);
  }

  marker(x, y, z, color) {
    const it = this.markers.spawn(0.55, {});
    it.mesh.position.set(x, y + 0.08, z);
    it.mesh.material.color.set(color);
  }

  shockwave(x, y, z, size, color = 0xffc070) {
    const it = this.shockwaves.spawn(0.6, { size });
    it.mesh.position.set(x, y + 0.15, z);
    it.mesh.material.color.set(color);
  }

  explosion(x, y, z, size = 1, color = [1, 0.6, 0.25]) {
    this.flash(x, y + 0.4 * size, z, 6 * size, 0xffd9a0, 0.4);
    this.particles.emit(x, y + 0.4, z, { count: Math.round(28 * size), color, speed: 4 * size, life: 0.9, size: 0.55 * size, sizeEnd: 0.1, gravity: 3, up: 0.8, jitter: 0.5 * size });
    this.particles.emit(x, y + 0.3, z, { count: Math.round(14 * size), color: [0.35, 0.35, 0.38], speed: 2 * size, life: 1.6, size: 0.9 * size, sizeEnd: 1.6 * size, gravity: -0.6, up: 0.6, alpha: 0.4, drag: 2 });
    if (size >= 1.5) this.shockwave(x, y, z, size * 3);
  }

  // Draws a beam between two points this frame
  beam(a, b, color, radius = 0.04) {
    if (this.beamCount >= 256) return;
    const dir = this._v.subVectors(b, a);
    const len = dir.length();
    if (len < 1e-3) return;
    this._q.setFromUnitVectors(this._up, dir.normalize());
    this._m.compose(a, this._q, this._s.set(radius, len, radius));
    this.beamMesh.setMatrixAt(this.beamCount, this._m);
    this.beamMesh.setColorAt(this.beamCount, color);
    this.beamCount++;
  }

  beginBeams() {
    this.beamCount = 0;
  }

  endBeams() {
    this.beamMesh.count = this.beamCount;
    this.beamMesh.instanceMatrix.needsUpdate = true;
    if (this.beamMesh.instanceColor) this.beamMesh.instanceColor.needsUpdate = true;
  }

  // Keeps a warp column alive for a warping unit
  warpColumn(id, x, y, z, progress, color) {
    let w = this.warps.get(id);
    if (!w) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(color) }, uP: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `varying vec2 vUv; uniform vec3 uColor; uniform float uP;
          void main(){ float a = (1.0 - vUv.y) * (0.35 + 0.65 * sin(vUv.y * 30.0 - uP * 40.0) * 0.5 + 0.5) * (1.0 - uP * 0.7);
            gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.5) * 1.8, a * 0.7); }`,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(this.warpGeo, mat);
      this.scene.add(mesh);
      w = { mesh, seen: 0 };
      this.warps.set(id, w);
    }
    w.seen = this.frame;
    w.mesh.position.set(x, y, z);
    w.mesh.material.uniforms.uP.value = progress;
    w.mesh.scale.set(1 - progress * 0.4, 1, 1 - progress * 0.4);
    if (Math.random() < 0.4) this.particles.emit(x, y + 0.2, z, { count: 1, color: [0.6, 0.9, 1.2], speed: 0.5, up: 3, life: 0.8, size: 0.2, spread: 0.2, jitter: 1.0, drag: 0.5 });
  }

  update(dt) {
    this.frame = (this.frame || 0) + 1;
    this.particles.update(dt);
    this.slashes.update(dt, (it, f) => {
      it.mesh.material.opacity = 0.7 * (1 - f);
      const s = 0.9 + f * 0.35;
      it.mesh.scale.set(s, 1, s);
    });
    this.bubbles.update(dt, (it, f) => {
      it.mesh.material.uniforms.uAlpha.value = 0.55 * (1 - f);
      it.mesh.scale.setScalar(it.data.r * (1 + f * 0.08));
    });
    this.flashes.update(dt, (it, f) => {
      it.mesh.material.opacity = 1 - f;
      it.mesh.scale.setScalar(it.data.size * (0.3 + f * 0.7));
    });
    this.bolts.update(dt, (it, f) => {
      const { a, b, heavy, color } = it.data;
      const x = a[0] + (b[0] - a[0]) * f;
      const y = a[1] + (b[1] - a[1]) * f;
      const z = a[2] + (b[2] - a[2]) * f;
      it.mesh.position.set(x, y, z);
      this.particles.emit(x, y, z, { count: heavy ? 3 : 1, color: [color[0] * 1.6 + 0.3, color[1] * 1.6 + 0.3, color[2] * 1.6 + 0.3], speed: 0.3, life: 0.25, size: heavy ? 0.35 : 0.2, sizeEnd: 0.02, jitter: 0.05 });
      if (it.t + dt >= it.life) {
        this.particles.emit(b[0], b[1], b[2], { count: heavy ? 18 : 8, color: [1.4, 1.4, 1.6], speed: heavy ? 4 : 2.5, life: 0.3, size: 0.2, gravity: 3 });
        this.flash(b[0], b[1], b[2], heavy ? 2.4 : 1.2, 0xbfeaff, 0.18);
      }
    });
    this.markers.update(dt, (it, f) => {
      it.mesh.material.opacity = 1 - f;
      it.mesh.scale.setScalar(0.9 - f * 0.5);
    });
    this.shockwaves.update(dt, (it, f) => {
      it.mesh.material.opacity = 0.8 * (1 - f);
      it.mesh.scale.setScalar(0.5 + f * it.data.size);
    });
    for (const [id, w] of this.warps) {
      if (w.seen !== this.frame - 1 && w.seen !== this.frame) {
        this.scene.remove(w.mesh);
        w.mesh.material.dispose();
        this.warps.delete(id);
      }
    }
  }
}
