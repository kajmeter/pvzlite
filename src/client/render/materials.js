// Shared materials and the fog-of-war / power-field shader injection.
import * as THREE from 'three';

// Global uniforms shared by every fog-aware material.
export const fogUniforms = {
  fogTex: { value: null },
  fogSize: { value: new THREE.Vector2(128, 128) },
  fogEnabled: { value: 1 },
  powerTex: { value: null },
  powerShow: { value: 0 },
  time: { value: 0 },
};

/**
 * Patches a built-in material so fragments are darkened by the fog-of-war texture.
 * Works for regular and instanced meshes.
 */
export function applyFog(material, { power = false } = {}) {
  if (material.userData.fogPatched) return material;
  material.userData.fogPatched = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.fogTex = fogUniforms.fogTex;
    shader.uniforms.fogSize = fogUniforms.fogSize;
    shader.uniforms.fogEnabled = fogUniforms.fogEnabled;
    if (power) {
      shader.uniforms.powerTex = fogUniforms.powerTex;
      shader.uniforms.powerShow = fogUniforms.powerShow;
      shader.uniforms.uTime = fogUniforms.time;
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFogWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 fogWP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fogWP = instanceMatrix * fogWP;
        #endif
        fogWP = modelMatrix * fogWP;
        vFogWorld = fogWP.xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vFogWorld;
        uniform sampler2D fogTex;
        uniform vec2 fogSize;
        uniform float fogEnabled;
        ${power ? 'uniform sampler2D powerTex; uniform float powerShow; uniform float uTime;' : ''}`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        ${
          power
            ? `if (powerShow > 0.5) {
            float pw = texture2D(powerTex, vFogWorld.xz / fogSize).r;
            float edge = smoothstep(0.15, 0.45, pw) * (1.0 - smoothstep(0.55, 0.85, pw));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.25, 0.65, 1.0), pw * 0.22 + edge * 0.35);
          }`
            : ''
        }
        if (fogEnabled > 0.5) {
          float fv = texture2D(fogTex, vFogWorld.xz / fogSize).r;
          float f = fv < 0.5 ? mix(0.06, 0.42, fv * 2.0) : mix(0.42, 1.0, (fv - 0.5) * 2.0);
          gl_FragColor.rgb *= f;
        }`,
      );
  };
  // ensure different programs for patched/unpatched variants
  const prevKey = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : () => '';
  material.customProgramCacheKey = () => `${prevKey()}|fog${power ? 'p' : ''}`;
  material.needsUpdate = true;
  return material;
}

const cache = new Map();
function cached(key, make) {
  let m = cache.get(key);
  if (!m) {
    m = make();
    cache.set(key, m);
  }
  return m;
}

export function metal(color = 0x9aa6b8, { rough = 0.38, metalness = 0.75 } = {}) {
  return cached(`metal${color}|${rough}|${metalness}`, () =>
    applyFog(new THREE.MeshStandardMaterial({ color, metalness, roughness: rough })),
  );
}

export function stone(color = 0x6b6f7a) {
  return cached(`stone${color}`, () => applyFog(new THREE.MeshStandardMaterial({ color, metalness: 0.05, roughness: 0.9, flatShading: true })));
}

export function teamMetal(hex) {
  return cached(`team${hex}`, () =>
    applyFog(new THREE.MeshStandardMaterial({ color: hex, metalness: 0.55, roughness: 0.35, emissive: hex, emissiveIntensity: 0.12 })),
  );
}

// Unlit, bright material for glowing parts (picked up by bloom).
export function glow(hex, intensity = 1.6) {
  return cached(`glow${hex}|${intensity}`, () => {
    const c = new THREE.Color(hex).multiplyScalar(intensity);
    const m = new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
    return applyFog(m);
  });
}

export function crystalMat(hex, emissive = 0.55) {
  return cached(`crystal${hex}|${emissive}`, () =>
    applyFog(
      new THREE.MeshStandardMaterial({
        color: hex,
        emissive: hex,
        emissiveIntensity: emissive,
        metalness: 0.1,
        roughness: 0.15,
        flatShading: true,
      }),
    ),
  );
}

// White materials multiplied by per-instance colors (instanced units)
export function instTint({ metalness = 0.6, rough = 0.35, emissive = 0.1 } = {}) {
  return cached(`inst${metalness}|${rough}|${emissive}`, () =>
    applyFog(
      new THREE.MeshStandardMaterial({ color: 0xffffff, metalness, roughness: rough, emissive: 0x000000, emissiveIntensity: emissive }),
    ),
  );
}

export function instGlow() {
  return cached('instGlow', () => applyFog(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })));
}

export function hologram(hex) {
  return cached(`holo${hex}`, () =>
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(hex).multiplyScalar(1.3),
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
}
