// Terrain mesh, water/lava/abyss planes, doodads and sky for each map theme.
import * as THREE from 'three';
import { CELL_PATHABLE, CELL_RAMP, CELL_CLIFF, fbm, hash2 } from '../../shared/maps/mapgen.js';
import { LEVEL_HEIGHT } from '../../shared/constants.js';
import { applyFog, stone, crystalMat, metal, glow } from './materials.js';
import { rockGeometry } from './models.js';

export const THEMES = {
  frost: {
    sky: 0x0b1626,
    ground: [0x9fb0c6, 0xc2cfdf, 0xe2eaf5],
    ramp: 0xb3c0d2,
    cliff: 0x5c6677,
    rock: 0x707b8c,
    abyss: 0x0b1a2c,
    abyssEmissive: 0x000000,
    hemiSky: 0xcfe0ff,
    hemiGround: 0x283244,
    sun: 0xfff6ea,
    sunIntensity: 2.4,
    hemiIntensity: 1.0,
    doodad: 'ice',
    patch: 0x8fb3d9,
  },
  ember: {
    sky: 0x170806,
    ground: [0x3b302d, 0x4b3c37, 0x5d4a42],
    ramp: 0x5a463c,
    cliff: 0x241a17,
    rock: 0x2f2522,
    abyss: 0xff4a10,
    abyssEmissive: 0xff3a00,
    hemiSky: 0xffb08a,
    hemiGround: 0x2a0d05,
    sun: 0xffd2a8,
    sunIntensity: 2.2,
    hemiIntensity: 0.9,
    doodad: 'basalt',
    patch: 0x2a2321,
  },
  verdant: {
    sky: 0x0c1912,
    ground: [0x3f6a35, 0x52803f, 0x6b9548],
    ramp: 0x80704f,
    cliff: 0x5a4a3a,
    rock: 0x5d5446,
    abyss: 0x0b2224,
    abyssEmissive: 0x000000,
    hemiSky: 0xd9ffd8,
    hemiGround: 0x1f2a14,
    sun: 0xfff1d6,
    sunIntensity: 2.5,
    hemiIntensity: 0.95,
    doodad: 'tree',
    patch: 0x6b5a3a,
  },
  desert: {
    sky: 0x1d140c,
    ground: [0xa78658, 0xbf9a66, 0xd5b27f],
    ramp: 0xc4a170,
    cliff: 0x7a4f33,
    rock: 0x8c6a4c,
    abyss: 0x2b1a0e,
    abyssEmissive: 0x000000,
    hemiSky: 0xffe7c4,
    hemiGround: 0x3a2412,
    sun: 0xfff0d0,
    sunIntensity: 2.6,
    hemiIntensity: 0.9,
    doodad: 'rock',
    patch: 0x9c7c52,
  },
  void: {
    sky: 0x03040a,
    ground: [0x56637c, 0x6a7896, 0x7f8eae],
    ramp: 0x8190b0,
    cliff: 0x2a3244,
    rock: 0x3a4458,
    abyss: null,
    abyssEmissive: 0x000000,
    hemiSky: 0xbcc8ff,
    hemiGround: 0x101420,
    sun: 0xeef2ff,
    sunIntensity: 2.3,
    hemiIntensity: 1.0,
    doodad: 'tech',
    patch: 0x4b5872,
  },
};

const S = 2; // sub-vertices per cell

function detailTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x / 16, y / 16, 3, 4) * 0.6 + hash2(x, y, 9) * 0.4;
      const v = Math.floor(200 + n * 55);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function buildTerrain(map, scene) {
  const theme = THEMES[map.theme] || THEMES.frost;
  const W = map.width;
  const H = map.height;
  const flags = map.flags;
  const heights = map.heights;
  const blocked = map.blocked;
  const group = new THREE.Group();
  scene.add(group);

  const cellType = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return 'out';
    const i = y * W + x;
    const f = flags[i];
    if (f & CELL_CLIFF) return 'cliff';
    if (blocked[i] === 2) return 'pit';
    if (blocked[i] === 1) return 'rock';
    if (f & CELL_PATHABLE || f & CELL_RAMP) return 'ground';
    return 'edge';
  };

  // corner heights
  const CW = W + 1;
  const corner = new Float32Array(CW * (H + 1));
  const cornerKind = new Uint8Array(CW * (H + 1)); // 0 ground,1 cliff,2 rock,3 pit,4 edge
  for (let cy = 0; cy <= H; cy++) {
    for (let cx = 0; cx <= W; cx++) {
      let sum = 0;
      let n = 0;
      let csum = 0;
      let cn = 0;
      let rocks = 0;
      let pits = 0;
      let edges = 0;
      let total = 0;
      for (let oy = -1; oy <= 0; oy++) {
        for (let ox = -1; ox <= 0; ox++) {
          const x = cx + ox;
          const y = cy + oy;
          const t = cellType(x, y);
          if (t === 'out') continue;
          total++;
          const hgt = heights[y * W + x];
          if (t === 'ground' || t === 'rock') {
            sum += hgt;
            n++;
            if (t === 'rock') rocks++;
          } else if (t === 'cliff') {
            csum += hgt;
            cn++;
          } else if (t === 'pit') pits++;
          else edges++;
        }
      }
      let h;
      let kind = 0;
      if (n) {
        h = sum / n;
        if (rocks === total && total > 0) {
          h += 0.9 + fbm(cx * 0.3, cy * 0.3, 5) * 1.4;
          kind = 2;
        }
      } else if (cn) {
        h = csum / cn - LEVEL_HEIGHT * 0.15;
        kind = 1;
      } else if (pits) {
        h = -2.4;
        kind = 3;
      } else {
        h = -3.2;
        kind = 4;
      }
      if (pits && n) h -= 0.25 * pits;
      if (edges && n === 0 && cn === 0 && !pits) kind = 4;
      corner[cy * CW + cx] = h;
      cornerKind[cy * CW + cx] = kind;
    }
  }

  // sub-vertex grid
  const VW = W * S + 1;
  const VH = H * S + 1;
  const pos = new Float32Array(VW * VH * 3);
  const col = new Float32Array(VW * VH * 3);
  const uv = new Float32Array(VW * VH * 2);
  const ground = theme.ground.map((c) => new THREE.Color(c));
  const rampC = new THREE.Color(theme.ramp);
  const cliffC = new THREE.Color(theme.cliff);
  const rockC = new THREE.Color(theme.rock);
  const edgeC = new THREE.Color(theme.cliff).multiplyScalar(0.6);
  const patchC = new THREE.Color(theme.patch ?? theme.ramp);
  const tmp = new THREE.Color();
  for (let vy = 0; vy < VH; vy++) {
    for (let vx = 0; vx < VW; vx++) {
      const fx = vx / S;
      const fy = vy / S;
      const x0 = Math.min(W - 1, Math.floor(fx));
      const y0 = Math.min(H - 1, Math.floor(fy));
      const tx = fx - x0;
      const ty = fy - y0;
      const c00 = corner[y0 * CW + x0];
      const c10 = corner[y0 * CW + x0 + 1];
      const c01 = corner[(y0 + 1) * CW + x0];
      const c11 = corner[(y0 + 1) * CW + x0 + 1];
      let h = (c00 * (1 - tx) + c10 * tx) * (1 - ty) + (c01 * (1 - tx) + c11 * tx) * ty;
      const steep = Math.max(Math.abs(c00 - c11), Math.abs(c10 - c01), Math.abs(c00 - c10), Math.abs(c00 - c01));
      const nz = fbm(fx * 0.45, fy * 0.45, map.seed || 1, 3);
      let px = fx;
      let pz = fy;
      if (steep > 0.6) {
        // rocky cliff faces: jitter
        px += (hash2(vx, vy, 3) - 0.5) * 0.35;
        pz += (hash2(vx, vy, 4) - 0.5) * 0.35;
        h += (hash2(vx, vy, 5) - 0.5) * 0.35;
      } else {
        h += (nz - 0.5) * 0.12;
      }
      const vi = vy * VW + vx;
      pos[vi * 3] = px;
      pos[vi * 3 + 1] = h;
      pos[vi * 3 + 2] = pz;
      uv[vi * 2] = fx / 6;
      uv[vi * 2 + 1] = fy / 6;
      // color from the containing cell
      const cxl = Math.min(W - 1, Math.max(0, Math.floor(fx - 0.001 + (tx > 0.5 ? 0.5 : 0))));
      const cyl = Math.min(H - 1, Math.max(0, Math.floor(fy - 0.001 + (ty > 0.5 ? 0.5 : 0))));
      const t = cellType(cxl, cyl);
      const ci = cyl * W + cxl;
      if (t === 'ground') {
        if (flags[ci] & CELL_RAMP) tmp.copy(rampC);
        else {
          tmp.copy(ground[Math.min(ground.length - 1, map.level[ci])]);
          const pn = fbm(fx * 0.07, fy * 0.07, (map.seed || 1) + 11, 3);
          const pk = Math.min(1, Math.max(0, (pn - 0.45) / 0.3));
          tmp.lerp(patchC, pk * 0.5);
        }
      } else if (t === 'rock') tmp.copy(rockC);
      else if (t === 'cliff') tmp.copy(cliffC);
      else if (t === 'pit') tmp.copy(cliffC).multiplyScalar(0.5);
      else tmp.copy(edgeC);
      if (steep > 0.9) tmp.lerp(cliffC, 0.75);
      const v = 0.82 + nz * 0.3;
      tmp.multiplyScalar(v);
      if (map.theme === 'void' && t === 'ground') {
        const gx = Math.abs(((fx + 0.5) % 4) - 0.5) < 0.06 || Math.abs(((fy + 0.5) % 4) - 0.5) < 0.06;
        if (gx) tmp.multiplyScalar(0.7);
      }
      col[vi * 3] = tmp.r;
      col[vi * 3 + 1] = tmp.g;
      col[vi * 3 + 2] = tmp.b;
    }
  }
  const idx = new Uint32Array((VW - 1) * (VH - 1) * 6);
  let k = 0;
  for (let vy = 0; vy < VH - 1; vy++) {
    for (let vx = 0; vx < VW - 1; vx++) {
      const a = vy * VW + vx;
      const b = a + 1;
      const c = a + VW;
      const d = c + 1;
      // alternate diagonal for less banding
      if ((vx + vy) % 2 === 0) {
        idx[k++] = a;
        idx[k++] = c;
        idx[k++] = b;
        idx[k++] = b;
        idx[k++] = c;
        idx[k++] = d;
      } else {
        idx[k++] = a;
        idx[k++] = c;
        idx[k++] = d;
        idx[k++] = a;
        idx[k++] = d;
        idx[k++] = b;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  // darken steep faces using normals
  const nrm = geo.attributes.normal;
  for (let i = 0; i < nrm.count; i++) {
    const ny = nrm.getY(i);
    if (ny < 0.8) {
      const f = Math.max(0.55, ny + 0.2);
      col[i * 3] = col[i * 3] * f + cliffC.r * (1 - f) * 0.6;
      col[i * 3 + 1] = col[i * 3 + 1] * f + cliffC.g * (1 - f) * 0.6;
      col[i * 3 + 2] = col[i * 3 + 2] * f + cliffC.b * (1 - f) * 0.6;
    }
  }
  geo.attributes.color.needsUpdate = true;
  const mat = applyFog(
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.04, map: detailTexture() }),
    { power: true },
  );
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  group.add(mesh);

  // abyss / lava / water plane
  if (theme.abyss !== null) {
    const isLava = map.theme === 'ember';
    const planeMat = isLava
      ? new THREE.ShaderMaterial({
          uniforms: { uTime: { value: 0 } },
          vertexShader: 'varying vec2 vP; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vP = wp.xz; gl_Position = projectionMatrix * viewMatrix * wp; }',
          fragmentShader: `varying vec2 vP; uniform float uTime;
            float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
            float n(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
              return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
            void main(){ vec2 p = vP * 0.18; float t = uTime * 0.15;
              float v = n(p + vec2(t, -t)) * 0.6 + n(p * 2.3 - vec2(t * 1.7, t)) * 0.4;
              vec3 c = mix(vec3(0.55, 0.06, 0.0), vec3(1.6, 0.55, 0.08), smoothstep(0.35, 0.85, v));
              gl_FragColor = vec4(c, 1.0); }`,
          toneMapped: false,
        })
      : applyFog(new THREE.MeshStandardMaterial({ color: theme.abyss, roughness: 0.25, metalness: 0.4 }));
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(W * 4, H * 4), planeMat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(W / 2, isLava ? -1.3 : -2.4, H / 2);
    plane.receiveShadow = !isLava;
    group.add(plane);
    group.userData.lava = isLava ? planeMat : null;
  } else {
    group.add(starfield());
  }

  // doodads
  group.add(buildDoodads(map, theme, corner, CW));

  return { group, mesh, theme };
}

function starfield() {
  const n = 2500;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 200 + Math.random() * 200;
    pos[i * 3] = Math.cos(a) * r + 50;
    pos[i * 3 + 1] = -40 - Math.random() * 160;
    pos[i * 3 + 2] = Math.sin(a) * r + 50;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 1.2, sizeAttenuation: false }));
}

function buildDoodads(map, theme, corner, CW) {
  const group = new THREE.Group();
  const hAt = (x, y) => {
    const cx = Math.min(map.width, Math.max(0, Math.round(x)));
    const cy = Math.min(map.height, Math.max(0, Math.round(y)));
    return corner[cy * CW + cx];
  };
  const rocks = map.doodads.filter((d) => d.kind === 'rock');
  const pebbles = map.doodads.filter((d) => d.kind === 'pebble');
  const dummy = new THREE.Object3D();
  const addInstanced = (geo, mat, list, place) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((d, i) => {
      place(d, i, dummy);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    group.add(im);
  };
  const kind = theme.doodad;
  if (kind === 'tree') {
    const trunk = new THREE.CylinderGeometry(0.12, 0.18, 1.2, 5);
    trunk.translate(0, 0.6, 0);
    const crown = new THREE.ConeGeometry(0.9, 2.2, 7);
    crown.translate(0, 2.0, 0);
    addInstanced(trunk, stone(0x4a3626), rocks, (d, i, o) => {
      o.position.set(d.x, hAt(d.x, d.y) - 0.1, d.y);
      o.scale.setScalar(0.9 + d.s * 0.6);
      o.rotation.set(0, i, 0);
    });
    addInstanced(crown, stone(0x2f5a2c), rocks, (d, i, o) => {
      o.position.set(d.x, hAt(d.x, d.y) - 0.1, d.y);
      o.scale.setScalar(0.9 + d.s * 0.6);
      o.rotation.set(0, i, 0);
    });
  } else if (kind === 'ice') {
    addInstanced(rockGeometry(2), stone(theme.rock), rocks, (d, i, o) => {
      o.position.set(d.x, hAt(d.x, d.y), d.y);
      o.scale.set(0.7 + d.s, 0.6 + d.s * 0.8, 0.7 + d.s);
      o.rotation.set(0, i * 1.3, 0);
    });
    const shard = new THREE.CylinderGeometry(0, 0.25, 1.6, 5);
    shard.translate(0, 0.7, 0);
    addInstanced(shard, crystalMat(0xe4f1fb, 0.05), rocks.filter((_, i) => i % 2 === 0), (d, i, o) => {
      o.position.set(d.x + 0.6, hAt(d.x, d.y), d.y - 0.3);
      o.scale.setScalar(0.6 + d.s * 0.6);
      o.rotation.set(0.3, i, 0.2);
    });
  } else if (kind === 'basalt') {
    const col = new THREE.CylinderGeometry(0.45, 0.5, 1, 6);
    col.translate(0, 0.5, 0);
    addInstanced(col, stone(0x2a2220), rocks, (d, i, o) => {
      o.position.set(d.x, hAt(d.x, d.y) - 0.2, d.y);
      o.scale.set(1 + d.s * 0.3, 0.8 + d.s * 1.8, 1 + d.s * 0.3);
      o.rotation.set(0, i, 0);
    });
  } else if (kind === 'tech') {
    addInstanced(new THREE.BoxGeometry(1, 1, 1), metal(0x2b3446), rocks, (d, i, o) => {
      o.position.set(d.x, hAt(d.x, d.y) + 0.3, d.y);
      o.scale.set(0.8 + d.s * 0.6, 0.6 + d.s, 0.8 + d.s * 0.6);
      o.rotation.set(0, (i % 4) * (Math.PI / 4), 0);
    });
    const light = new THREE.BoxGeometry(0.15, 0.15, 0.15);
    addInstanced(light, glow(0x5fb4ff, 1.8), rocks.filter((_, i) => i % 3 === 0), (d, i, o) => {
      o.position.set(d.x, hAt(d.x, d.y) + 1.0 + d.s * 0.6, d.y);
    });
  } else {
    addInstanced(rockGeometry(4), stone(theme.rock), rocks, (d, i, o) => {
      o.position.set(d.x, hAt(d.x, d.y), d.y);
      o.scale.set(0.8 + d.s, 0.6 + d.s, 0.8 + d.s);
      o.rotation.set(0, i * 1.7, 0);
    });
  }
  // rocky cliff walls break up the cell outline of plateaus
  const cliffs = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!(map.flags[y * map.width + x] & CELL_CLIFF)) continue;
      if (hash2(x, y, 21) < 0.6) cliffs.push({ x: x + 0.3 + hash2(x, y, 22) * 0.4, y: y + 0.3 + hash2(x, y, 23) * 0.4, s: hash2(x, y, 24) });
    }
  }
  addInstanced(rockGeometry(9), stone(theme.cliff), cliffs, (d, i, o) => {
    const cx = Math.floor(d.x);
    const cy = Math.floor(d.y);
    const hh = (corner[cy * CW + cx] + corner[cy * CW + cx + 1] + corner[(cy + 1) * CW + cx] + corner[(cy + 1) * CW + cx + 1]) / 4;
    o.position.set(d.x, hh - 0.2, d.y);
    o.scale.set(0.45 + d.s * 0.35, 0.6 + d.s * 0.8, 0.45 + d.s * 0.35);
    o.rotation.set(d.s * 0.6, i * 2.3, d.s * 0.4);
  });
  addInstanced(rockGeometry(7), stone(theme.rock), pebbles, (d, i, o) => {
    o.position.set(d.x, hAt(d.x, d.y) + 0.02, d.y);
    o.scale.setScalar(0.12 + d.s * 0.05);
    o.rotation.set(i, i * 2, 0);
  });
  return group;
}
