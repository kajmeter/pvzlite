// Procedural, original 3D models for pvzlite units, structures and neutral props.
// Units are described as "rigs" (part lists animated per instance), structures as Groups.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { metal, stone, teamMetal, glow, crystalMat } from './materials.js';

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const v = new THREE.Vector3();
const s = new THREE.Vector3();

// Bake a transform into a geometry clone
export function xf(geo, { p = [0, 0, 0], r = [0, 0, 0], sc = [1, 1, 1] } = {}) {
  const g = geo.clone();
  e.set(r[0], r[1], r[2]);
  q.setFromEuler(e);
  m4.compose(v.set(p[0], p[1], p[2]), q, s.set(sc[0], sc[1], sc[2]));
  g.applyMatrix4(m4);
  return g;
}

function merge(list) {
  const norm = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    // keep attributes consistent
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((n.attributes.position.count) * 2), 2));
    return n;
  });
  const g = mergeGeometries(norm, false);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ unit geometry

const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8),
  cyl12: new THREE.CylinderGeometry(1, 1, 1, 12),
  oct: new THREE.OctahedronGeometry(1, 0),
  sph: new THREE.SphereGeometry(1, 12, 8),
  ico: new THREE.IcosahedronGeometry(1, 0),
  dode: new THREE.DodecahedronGeometry(1, 0),
};

// Lancer: armored crystal knight with a twin-bladed arc glaive (faces +X).
export function lancerGeometries() {
  const body = merge([
    // pelvis + armored skirt plates
    xf(G.box, { p: [0, 0.74, 0], sc: [0.3, 0.16, 0.36] }),
    xf(G.cyl6, { p: [0, 0.62, 0], sc: [0.24, 0.2, 0.26] }),
    // torso (tapered)
    xf(new THREE.CylinderGeometry(0.27, 0.19, 0.46, 6), { p: [0, 1.03, 0], r: [0, Math.PI / 6, 0], sc: [1, 1, 1.15] }),
    // neck + helmet
    xf(G.cyl6, { p: [0, 1.3, 0], sc: [0.07, 0.08, 0.07] }),
    xf(new THREE.CylinderGeometry(0.13, 0.11, 0.24, 6), { p: [0.02, 1.43, 0] }),
    xf(G.box, { p: [0.06, 1.55, 0], r: [0, 0, -0.2], sc: [0.24, 0.05, 0.12] }),
    // arms (upper arms hanging slightly forward)
    xf(G.box, { p: [0.08, 1.06, 0.29], r: [0.15, 0, 0.5], sc: [0.1, 0.32, 0.1] }),
    xf(G.box, { p: [0.08, 1.06, -0.29], r: [-0.15, 0, 0.5], sc: [0.1, 0.32, 0.1] }),
    xf(G.box, { p: [0.22, 0.9, 0.24], r: [0.3, 0, 1.2], sc: [0.09, 0.28, 0.09] }),
    xf(G.box, { p: [0.22, 0.9, -0.2], r: [-0.3, 0, 1.2], sc: [0.09, 0.28, 0.09] }),
  ]);
  const plates = merge([
    // pauldrons and chest plate (team colored)
    xf(new THREE.SphereGeometry(1, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), { p: [0, 1.2, 0.31], r: [0.35, 0, 0], sc: [0.21, 0.15, 0.19] }),
    xf(new THREE.SphereGeometry(1, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), { p: [0, 1.2, -0.31], r: [-0.35, 0, 0], sc: [0.21, 0.15, 0.19] }),
    xf(G.box, { p: [0.15, 1.05, 0], r: [0, 0, -0.12], sc: [0.06, 0.3, 0.3] }),
    // tabard hanging from the belt
    xf(G.box, { p: [0.17, 0.55, 0], r: [0, 0, -0.08], sc: [0.03, 0.34, 0.2] }),
    // helmet crest fin
    xf(G.box, { p: [-0.04, 1.6, 0], r: [0, 0, 0.5], sc: [0.22, 0.04, 0.025] }),
    // back banner plate
    xf(G.box, { p: [-0.2, 0.95, 0], r: [0, 0, 0.12], sc: [0.04, 0.55, 0.26] }),
  ]);
  const visor = merge([xf(G.box, { p: [0.14, 1.45, 0], sc: [0.03, 0.035, 0.17] }), xf(G.box, { p: [0.15, 1.02, 0], sc: [0.03, 0.06, 0.06] })]);
  // leg pivots at hip (origin at hip joint), extends down
  const leg = merge([
    xf(G.box, { p: [0.02, -0.17, 0], r: [0, 0, 0.08], sc: [0.13, 0.34, 0.13] }),
    xf(G.box, { p: [0.0, -0.48, 0], r: [0, 0, -0.1], sc: [0.11, 0.32, 0.11] }),
    xf(G.box, { p: [0.07, -0.66, 0], sc: [0.2, 0.06, 0.12] }),
    xf(G.sph, { p: [0.04, -0.33, 0], sc: [0.08, 0.08, 0.08] }),
  ]);
  // glaive: pivot at hands (origin), shaft along +X
  const shaft = merge([
    xf(G.cyl8, { p: [0.2, 0, 0], r: [0, 0, Math.PI / 2], sc: [0.025, 1.5, 0.025] }),
    xf(G.cyl8, { p: [0.96, 0, 0], r: [0, 0, Math.PI / 2], sc: [0.05, 0.1, 0.05] }),
    xf(G.cyl8, { p: [-0.56, 0, 0], r: [0, 0, Math.PI / 2], sc: [0.05, 0.1, 0.05] }),
  ]);
  const crescent = new THREE.TorusGeometry(0.34, 0.035, 4, 18, Math.PI * 0.95);
  const blade = merge([
    xf(crescent, { p: [1.1, 0, 0], r: [Math.PI / 2, 0, Math.PI / 2 + 0.05], sc: [1, 1, 0.6] }),
    xf(G.oct, { p: [1.32, 0, 0], sc: [0.24, 0.05, 0.05] }),
    xf(crescent, { p: [-0.66, 0, 0], r: [Math.PI / 2, 0, -Math.PI / 2], sc: [0.55, 0.55, 0.4] }),
  ]);
  return { body, plates, visor, leg, shaft, blade };
}

// Shaper: hovering worker drone with a glowing core, gyro ring and three tool prongs.
export function shaperGeometries() {
  const core = xf(G.oct, { sc: [0.17, 0.24, 0.17] });
  const shell = merge([
    xf(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), { p: [0, 0.07, 0], sc: [0.27, 0.2, 0.27] }),
    xf(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, Math.PI - Math.PI / 3.2, Math.PI / 3.2), { p: [0, -0.06, 0], sc: [0.24, 0.16, 0.24] }),
    // sensor eye
    xf(G.box, { p: [0.22, 0.05, 0], sc: [0.12, 0.05, 0.12] }),
  ]);
  const ring = new THREE.TorusGeometry(0.33, 0.035, 6, 24);
  const prong = merge([
    xf(G.box, { p: [0.0, -0.12, 0], sc: [0.04, 0.24, 0.04] }),
    xf(new THREE.ConeGeometry(0.035, 0.14, 4), { p: [0.02, -0.29, 0], r: [0, 0, Math.PI - 0.3] }),
  ]);
  const thruster = xf(new THREE.CircleGeometry(0.13, 12), { r: [Math.PI / 2, 0, 0] });
  const cargo = xf(G.oct, { sc: [0.1, 0.16, 0.1] });
  const eye = xf(G.box, { p: [0.285, 0.05, 0], sc: [0.02, 0.03, 0.08] });
  return { core, shell, ring, prong, thruster, cargo, eye };
}

// ------------------------------------------------------------------ structures

function add(group, geo, mat, opts) {
  const mesh = new THREE.Mesh(opts ? xf(geo, opts) : geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function pivot(group, pos = [0, 0, 0]) {
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1], pos[2]);
  group.add(g);
  return g;
}

const STONE = 0x7a8296;
const STONE_DARK = 0x4c5466;
const TRIM = 0xc9d3e6;

export function buildStructureModel(type, teamHex) {
  const g = new THREE.Group();
  const anim = { spin: [], bob: [], glows: [], portalSurface: null, ring: null };
  const team = teamMetal(teamHex);
  const tglow = glow(teamHex, 1.8);
  const white = glow(0xdff6ff, 1.6);
  switch (type) {
    case 'citadel': {
      add(g, G.cyl8, stone(STONE_DARK), { p: [0, 0.25, 0], r: [0, Math.PI / 8, 0], sc: [2.45, 0.5, 2.45] });
      add(g, G.cyl8, stone(STONE), { p: [0, 0.7, 0], r: [0, Math.PI / 8, 0], sc: [2.0, 0.4, 2.0] });
      add(g, G.cyl8, metal(TRIM), { p: [0, 0.95, 0], r: [0, Math.PI / 8, 0], sc: [1.55, 0.15, 1.55] });
      add(g, new THREE.TorusGeometry(1.75, 0.06, 4, 32), tglow, { p: [0, 0.92, 0], r: [Math.PI / 2, 0, 0] });
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 2;
        const x = Math.cos(a) * 1.75;
        const z = Math.sin(a) * 1.75;
        const arm = pivot(g, [x, 0.6, z]);
        arm.rotation.y = -a;
        add(arm, G.box, stone(STONE), { p: [0, 1.1, 0], r: [0, 0, 0.32], sc: [0.35, 2.2, 0.5] });
        add(arm, G.box, team, { p: [-0.26, 2.1, 0], r: [0, 0, 0.32], sc: [0.15, 0.7, 0.56] });
        add(arm, G.oct, tglow, { p: [-0.55, 2.6, 0], sc: [0.13, 0.2, 0.13] });
      }
      const spire = pivot(g, [0, 3.3, 0]);
      add(spire, G.oct, crystalMat(teamHex, 0.9), { sc: [0.55, 1.25, 0.55] });
      add(spire, G.oct, white, { sc: [0.22, 0.6, 0.22] });
      anim.spin.push({ obj: spire, speed: 0.35, axis: 'y' });
      anim.bob.push({ obj: spire, base: 3.3, amp: 0.12, speed: 1.2 });
      const halo1 = pivot(g, [0, 3.3, 0]);
      add(halo1, new THREE.TorusGeometry(1.0, 0.05, 6, 40), metal(TRIM), { r: [Math.PI / 2, 0, 0] });
      halo1.rotation.x = 0.35;
      anim.spin.push({ obj: halo1, speed: 0.6, axis: 'y' });
      const halo2 = pivot(g, [0, 3.3, 0]);
      add(halo2, new THREE.TorusGeometry(1.25, 0.03, 6, 40), tglow, { r: [Math.PI / 2, 0, 0] });
      halo2.rotation.z = -0.4;
      anim.spin.push({ obj: halo2, speed: -0.45, axis: 'y' });
      add(g, new THREE.CircleGeometry(1.2, 24), glow(0x6fd2ff, 1.2), { p: [0, 1.04, 0], r: [-Math.PI / 2, 0, 0] });
      break;
    }
    case 'conduit': {
      add(g, G.box, stone(STONE_DARK), { p: [0, 0.15, 0], sc: [1.7, 0.3, 1.7] });
      add(g, G.box, stone(STONE), { p: [0, 0.4, 0], r: [0, Math.PI / 4, 0], sc: [1.0, 0.2, 1.0] });
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 + Math.PI / 4;
        add(g, G.box, team, { p: [Math.cos(a) * 0.66, 0.6, Math.sin(a) * 0.66], r: [0, -a, 0.15], sc: [0.14, 0.9, 0.14] });
      }
      const gem = pivot(g, [0, 1.65, 0]);
      add(gem, G.oct, crystalMat(teamHex, 1.0), { sc: [0.38, 0.62, 0.38] });
      add(gem, G.oct, white, { sc: [0.14, 0.3, 0.14] });
      anim.spin.push({ obj: gem, speed: 0.9, axis: 'y' });
      anim.bob.push({ obj: gem, base: 1.65, amp: 0.1, speed: 1.8 });
      const ring = pivot(g, [0, 1.65, 0]);
      add(ring, new THREE.TorusGeometry(0.62, 0.025, 4, 30), tglow, { r: [Math.PI / 2, 0, 0] });
      ring.rotation.x = 0.5;
      anim.spin.push({ obj: ring, speed: -1.4, axis: 'y' });
      break;
    }
    case 'siphon': {
      add(g, G.cyl12, metal(0x7d8798), { p: [0, 0.25, 0], sc: [1.45, 0.5, 1.45] });
      add(g, new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal(0x9ba6b9), { p: [0, 0.5, 0], sc: [1.05, 0.8, 1.05] });
      add(g, new THREE.TorusGeometry(1.1, 0.07, 6, 32), glow(0x63f59b, 1.6), { p: [0, 0.55, 0], r: [Math.PI / 2, 0, 0] });
      add(g, new THREE.TorusGeometry(1.46, 0.05, 6, 32), team, { p: [0, 0.48, 0], r: [Math.PI / 2, 0, 0] });
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI * 2) / 3;
        add(g, G.cyl8, metal(TRIM), { p: [Math.cos(a) * 1.2, 0.8, Math.sin(a) * 1.2], r: [Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4], sc: [0.12, 1.0, 0.12] });
      }
      const cap = pivot(g, [0, 1.35, 0]);
      add(cap, G.cyl8, glow(0x63f59b, 1.8), { sc: [0.22, 0.25, 0.22] });
      anim.glows.push(cap);
      break;
    }
    case 'portal': {
      add(g, G.box, stone(STONE_DARK), { p: [0, 0.15, 0], sc: [2.8, 0.3, 2.8] });
      add(g, G.box, stone(STONE), { p: [0, 0.38, 0], sc: [2.3, 0.16, 1.2] });
      add(g, G.box, team, { p: [1.38, 0.31, 0], sc: [0.06, 0.08, 2.6] });
      add(g, G.box, team, { p: [-1.38, 0.31, 0], sc: [0.06, 0.08, 2.6] });
      add(g, G.box, stone(STONE), { p: [1.15, 1.05, 0], sc: [0.35, 1.5, 0.45] });
      add(g, G.box, stone(STONE), { p: [-1.15, 1.05, 0], sc: [0.35, 1.5, 0.45] });
      add(g, G.oct, tglow, { p: [1.15, 1.95, 0], sc: [0.12, 0.2, 0.12] });
      add(g, G.oct, tglow, { p: [-1.15, 1.95, 0], sc: [0.12, 0.2, 0.12] });
      const ring = pivot(g, [0, 1.5, 0.1]);
      ring.rotation.x = -0.35; // lean back toward the camera
      add(ring, new THREE.TorusGeometry(1.0, 0.15, 8, 36), metal(TRIM));
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        add(ring, G.box, team, { p: [Math.cos(a) * 1.0, Math.sin(a) * 1.0, 0], r: [0, 0, a], sc: [0.12, 0.38, 0.34] });
      }
      anim.ring = ring;
      const surf = new THREE.Mesh(
        new THREE.CircleGeometry(0.86, 32),
        new THREE.ShaderMaterial({
          uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(teamHex) }, uPower: { value: 1 }, uPhase: { value: 0 } },
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
          fragmentShader: `varying vec2 vUv; uniform float uTime; uniform vec3 uColor; uniform float uPower; uniform float uPhase;
            void main(){ vec2 p = vUv - 0.5; float r = length(p) * 2.0; float a = atan(p.y, p.x);
              float sw = sin(a * 5.0 + r * 9.0 - uTime * (2.5 + uPhase * 2.0)) * 0.5 + 0.5;
              vec3 col = mix(uColor * 0.6, mix(vec3(1.0), uColor, 0.35), sw * (1.0 - r));
              col = mix(col, vec3(0.85, 0.95, 1.0), uPhase * 0.4 * (1.0 - r));
              float alpha = (0.55 + 0.45 * sw) * smoothstep(1.0, 0.85, r) * uPower;
              gl_FragColor = vec4(col * (1.2 + uPhase * 0.6), alpha); }`,
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      ring.add(surf);
      anim.portalSurface = surf;
      break;
    }
    case 'foundry': {
      add(g, G.box, stone(STONE_DARK), { p: [0, 0.2, 0], sc: [2.7, 0.4, 2.7] });
      add(g, G.box, stone(STONE), { p: [0, 0.85, 0], sc: [2.2, 0.9, 2.0] });
      add(g, new THREE.CylinderGeometry(0.01, 1.6, 0.7, 4), metal(0x8d96a8), { p: [0, 1.65, 0], r: [0, Math.PI / 4, 0], sc: [1, 1, 0.9] });
      add(g, G.box, team, { p: [1.11, 0.85, 0], sc: [0.04, 0.5, 1.6] });
      add(g, G.box, team, { p: [-1.11, 0.85, 0], sc: [0.04, 0.5, 1.6] });
      add(g, G.box, metal(0x5f6779), { p: [0.4, 1.35, 0.95], sc: [1.0, 0.25, 0.3] });
      for (const z of [-0.65, 0.65]) {
        add(g, G.cyl8, metal(0x5f6779), { p: [-0.65, 1.8, z], sc: [0.2, 1.1, 0.2] });
        const fire = pivot(g, [-0.65, 2.4, z]);
        add(fire, G.cyl8, glow(0xff9a3c, 2.2), { sc: [0.16, 0.08, 0.16] });
        anim.glows.push(fire);
      }
      add(g, G.box, glow(0xff9a3c, 1.6), { p: [1.12, 0.6, 0], sc: [0.02, 0.18, 0.7] });
      break;
    }
    case 'archive': {
      add(g, G.cyl12, stone(STONE_DARK), { p: [0, 0.2, 0], sc: [1.4, 0.4, 1.4] });
      add(g, G.cyl12, stone(STONE), { p: [0, 1.1, 0], sc: [1.0, 1.5, 1.0] });
      add(g, new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal(0xa9b3c6), { p: [0, 1.85, 0], sc: [1.05, 0.8, 1.05] });
      add(g, new THREE.TorusGeometry(1.02, 0.06, 6, 32), team, { p: [0, 1.5, 0], r: [Math.PI / 2, 0, 0] });
      add(g, new THREE.TorusGeometry(1.02, 0.04, 6, 32), tglow, { p: [0, 0.7, 0], r: [Math.PI / 2, 0, 0] });
      const orbit = pivot(g, [0, 1.35, 0]);
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        add(orbit, G.box, tglow, { p: [Math.cos(a) * 1.45, Math.sin(k) * 0.15, Math.sin(a) * 1.45], r: [0, -a, 0], sc: [0.08, 0.26, 0.18] });
      }
      anim.spin.push({ obj: orbit, speed: 0.5, axis: 'y' });
      const top = pivot(g, [0, 2.9, 0]);
      add(top, G.oct, crystalMat(teamHex, 0.9), { sc: [0.2, 0.35, 0.2] });
      anim.spin.push({ obj: top, speed: 1.2, axis: 'y' });
      break;
    }
    case 'sanctum': {
      add(g, G.box, stone(STONE_DARK), { p: [0, 0.2, 0], sc: [2.8, 0.4, 2.8] });
      add(g, G.box, stone(STONE), { p: [0, 0.6, 0], sc: [2.2, 0.4, 2.2] });
      add(g, G.box, stone(STONE), { p: [0, 0.95, 0], sc: [1.6, 0.3, 1.6] });
      add(g, G.box, team, { p: [0, 0.81, 0], sc: [2.25, 0.04, 2.25] });
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 2;
        add(g, new THREE.CylinderGeometry(0.06, 0.16, 1.5, 4), stone(0x9aa3b5), { p: [Math.cos(a) * 1.25, 1.15, Math.sin(a) * 1.25] });
        add(g, G.oct, tglow, { p: [Math.cos(a) * 1.25, 2.0, Math.sin(a) * 1.25], sc: [0.07, 0.12, 0.07] });
      }
      const top = pivot(g, [0, 2.3, 0]);
      add(top, new THREE.ConeGeometry(0.7, 1.0, 4), crystalMat(teamHex, 0.85), { r: [Math.PI, Math.PI / 4, 0] });
      add(top, new THREE.ConeGeometry(0.3, 0.45, 4), white, { p: [0, 0.75, 0], r: [0, Math.PI / 4, 0] });
      anim.spin.push({ obj: top, speed: 0.4, axis: 'y' });
      anim.bob.push({ obj: top, base: 2.3, amp: 0.08, speed: 1.0 });
      break;
    }
    case 'aegis': {
      add(g, G.box, stone(STONE_DARK), { p: [0, 0.12, 0], sc: [1.7, 0.24, 1.7] });
      add(g, new THREE.CylinderGeometry(0.75, 0.45, 0.5, 10), stone(STONE), { p: [0, 0.5, 0] });
      add(g, new THREE.TorusGeometry(0.72, 0.05, 6, 24), team, { p: [0, 0.75, 0], r: [Math.PI / 2, 0, 0] });
      const orb = pivot(g, [0, 1.3, 0]);
      add(orb, G.ico, glow(0x8fdcff, 1.7), { sc: [0.3, 0.3, 0.3] });
      anim.bob.push({ obj: orb, base: 1.3, amp: 0.12, speed: 2.0 });
      anim.spin.push({ obj: orb, speed: 1.0, axis: 'y' });
      anim.glows.push(orb);
      break;
    }
    case 'barricade': {
      // crystal-stone wall block with a ward node that powers turrets
      add(g, new THREE.CylinderGeometry(0.95, 1.0, 0.3, 6), stone(STONE_DARK), { p: [0, 0.15, 0], r: [0, Math.PI / 6, 0] });
      add(g, new THREE.CylinderGeometry(0.82, 0.92, 1.0, 6), stone(0x8a93a8), { p: [0, 0.8, 0], r: [0, Math.PI / 6, 0] });
      add(g, new THREE.CylinderGeometry(0.62, 0.82, 0.25, 6), stone(STONE), { p: [0, 1.42, 0], r: [0, Math.PI / 6, 0] });
      add(g, new THREE.TorusGeometry(0.86, 0.05, 4, 6), team, { p: [0, 0.65, 0], r: [Math.PI / 2, 0, Math.PI / 6] });
      const node = pivot(g, [0, 1.75, 0]);
      add(node, G.oct, crystalMat(teamHex, 1.0), { sc: [0.16, 0.26, 0.16] });
      anim.spin.push({ obj: node, speed: 1.3, axis: 'y' });
      anim.bob.push({ obj: node, base: 1.75, amp: 0.06, speed: 2.2 });
      break;
    }
    case 'turret':
    case 'lanceTurret': {
      const heavy = type === 'lanceTurret';
      add(g, new THREE.CylinderGeometry(0.9, 1.0, 0.35, 8), stone(STONE_DARK), { p: [0, 0.18, 0], r: [0, Math.PI / 8, 0] });
      add(g, new THREE.CylinderGeometry(0.45, 0.7, heavy ? 1.5 : 1.0, 8), stone(0x8a93a8), { p: [0, heavy ? 1.1 : 0.85, 0] });
      add(g, new THREE.TorusGeometry(0.62, 0.05, 4, 16), team, { p: [0, heavy ? 0.9 : 0.7, 0], r: [Math.PI / 2, 0, 0] });
      const head = pivot(g, [0, heavy ? 2.0 : 1.55, 0]);
      add(head, G.sph, metal(0xb7c1d6), { sc: [0.42, 0.34, 0.42] });
      add(head, G.box, metal(0x5f6779), { p: [heavy ? 0.75 : 0.5, 0, 0], sc: [heavy ? 1.2 : 0.7, 0.14, 0.14] });
      add(head, G.oct, crystalMat(teamHex, 1.1), { p: [heavy ? 1.4 : 0.9, 0, 0], r: [0, 0, Math.PI / 2], sc: [0.1, heavy ? 0.3 : 0.2, 0.1] });
      add(head, G.box, tglow, { p: [0.2, 0.15, 0], sc: [0.25, 0.05, 0.36] });
      anim.head = head;
      break;
    }
    case 'mender': {
      add(g, G.box, stone(STONE_DARK), { p: [0, 0.12, 0], sc: [1.7, 0.24, 1.7] });
      add(g, new THREE.CylinderGeometry(0.75, 0.45, 0.5, 10), stone(STONE), { p: [0, 0.5, 0] });
      add(g, new THREE.TorusGeometry(0.72, 0.05, 6, 24), team, { p: [0, 0.75, 0], r: [Math.PI / 2, 0, 0] });
      const orb = pivot(g, [0, 1.3, 0]);
      add(orb, G.ico, glow(0x7dffb0, 1.6), { sc: [0.3, 0.3, 0.3] });
      anim.bob.push({ obj: orb, base: 1.3, amp: 0.12, speed: 2.0 });
      anim.spin.push({ obj: orb, speed: 1.0, axis: 'y' });
      anim.glows.push(orb);
      break;
    }
    default:
      add(g, G.box, stone(STONE), { p: [0, 0.5, 0], sc: [1, 1, 1] });
  }
  return { group: g, anim };
}

// ------------------------------------------------------------------ neutral props

export function crystalClusterGeometry(seed = 1) {
  const parts = [];
  const rnd = (k) => {
    const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  const n = 8;
  for (let i = 0; i < n; i++) {
    const big = i % 3 === 1;
    const h = (big ? 1.1 : 0.6) + rnd(i) * 0.7;
    const ox = (i - (n - 1) / 2) * 0.24 + (rnd(i + 9) - 0.5) * 0.18;
    const oz = (rnd(i + 3) - 0.5) * 0.55;
    const tilt = (rnd(i + 5) - 0.5) * 0.6;
    const tilt2 = (rnd(i + 7) - 0.5) * 0.6;
    parts.push(xf(new THREE.CylinderGeometry(0.0, big ? 0.22 : 0.15, h, 6), { p: [ox, h / 2 - 0.08, oz], r: [tilt, rnd(i) * 3, tilt2] }));
  }
  return merge(parts);
}

export function rockGeometry(seed = 1) {
  const g = new THREE.DodecahedronGeometry(1, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = 0.8 + 0.4 * (Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7 + y * 1.3 + seed * 0.7) * 0.5 + 0.5);
    pos.setXYZ(i, x * n, y * n * 0.7, z * n);
  }
  g.computeVertexNormals();
  return g;
}

export function buildVentModel() {
  const g = new THREE.Group();
  for (let k = 0; k < 11; k++) {
    const a = (k / 11) * Math.PI * 2;
    add(g, rockGeometry(k), stone(0x3f3d3b), { p: [Math.cos(a) * 1.25, 0.05, Math.sin(a) * 1.25], r: [0, k, 0], sc: [0.34, 0.28 + (k % 3) * 0.08, 0.34] });
  }
  add(g, new THREE.CircleGeometry(1.15, 24), stone(0x181a19), { p: [0, 0.04, 0], r: [-Math.PI / 2, 0, 0] });
  const core = pivot(g, [0, 0.06, 0]);
  add(core, new THREE.CircleGeometry(0.42, 20), glow(0x3fd57f, 0.9), { r: [-Math.PI / 2, 0, 0] });
  add(core, new THREE.TorusGeometry(0.62, 0.03, 4, 24), glow(0x3fd57f, 0.6), { r: [Math.PI / 2, 0, 0] });
  return { group: g, core };
}

export function buildBeaconModel() {
  const g = new THREE.Group();
  add(g, G.box, stone(0x5a6070), { p: [0, 0.25, 0], sc: [1.8, 0.5, 1.8] });
  add(g, new THREE.CylinderGeometry(0.22, 0.4, 3.2, 6), stone(0x8890a2), { p: [0, 2.0, 0] });
  add(g, new THREE.TorusGeometry(0.42, 0.06, 4, 16), metal(0xb7c1d6), { p: [0, 3.0, 0], r: [Math.PI / 2, 0, 0] });
  const gem = pivot(g, [0, 3.9, 0]);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd8e2f0), toneMapped: false });
  add(gem, G.oct, mat, { sc: [0.32, 0.55, 0.32] });
  return { group: g, gem, mat };
}

// Ring of light pillars that holds the Hunters during the grace period
export function buildCageModel(radius) {
  const g = new THREE.Group();
  const pillars = [];
  const n = 12;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    add(g, new THREE.CylinderGeometry(0.22, 0.32, 2.6, 6), stone(0x4c5466), { p: [x, 1.3, z] });
    const tip = pivot(g, [x, 2.8, z]);
    add(tip, G.oct, glow(0xff6a3d, 1.8), { sc: [0.16, 0.26, 0.16] });
    pillars.push(tip);
  }
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 2.4, 48, 1, true),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5a2a).multiplyScalar(1.4), transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  wall.position.y = 1.2;
  g.add(wall);
  return { group: g, wall, pillars };
}

export function buildRubbleModel() {
  const g = new THREE.Group();
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    const r = k === 0 ? 0 : 1.1;
    add(g, rockGeometry(k + 3), stone(0x7c6a58), {
      p: [Math.cos(a) * r, 0.4, Math.sin(a) * r],
      r: [k, k * 2, 0],
      sc: [0.8 + (k % 3) * 0.2, 0.9, 0.8],
    });
  }
  return { group: g };
}

export { G as BASE_GEOMETRIES };
