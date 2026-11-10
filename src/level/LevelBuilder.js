// Builds the riverside diorama for a level: terrain (+ Rapier trimesh), water,
// scenery, the beaver dam, and the material piles.

import * as THREE from 'three';
import { COLORS, GAME, WORLD, MATERIALS, MATERIAL_ORDER } from '../core/Constants.js';
import { terrainHeight, gapHalf } from './levels.js';
import { createPile, createCrate, makeLabelSprite, mat, woodMaterial, mergeStatic } from './models.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function gridAxis(g) {
  const xs = new Set();
  const outer = g + WORLD.X_MARGIN;
  for (let x = -outer; x <= outer + 1e-6; x += 0.6) xs.add(Math.round(x * 1000) / 1000);
  for (let x = -g - 2.5; x <= g + 2.5 + 1e-6; x += 0.25) xs.add(Math.round(x * 1000) / 1000);
  xs.add(-g);
  xs.add(g);
  return [...xs].sort((a, b) => a - b);
}

const WATER_VERT = /* glsl */ `
  uniform float uTime;
  varying vec2 vXZ;
  varying vec3 vWorld;
  void main() {
    vec3 p = position;
    vec4 world = modelMatrix * vec4(p, 1.0);
    world.y += sin(world.x * 0.9 + uTime * 1.4) * 0.025 + sin(world.z * 0.7 - uTime * 1.9) * 0.025;
    vXZ = world.xz;
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const WATER_FRAG = /* glsl */ `
  uniform float uTime;
  uniform sampler2D uDepth;
  uniform vec4 uBounds; // minX, minZ, sizeX, sizeZ
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uFoam;
  uniform float uFlow;
  varying vec2 vXZ;
  varying vec3 vWorld;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    vec2 uv = (vXZ - uBounds.xy) / uBounds.zw;
    float depth = texture2D(uDepth, uv).r * 4.0;
    if (depth <= 0.02) discard;
    vec2 flowUv = vXZ * vec2(0.35, 0.18) + vec2(0.0, uTime * uFlow * 0.25);
    float n = noise(flowUv * 3.0) * 0.6 + noise(flowUv * 7.0 + 3.1) * 0.4;
    vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 2.2, depth));
    float ripple = smoothstep(0.62, 0.8, n);
    col += ripple * 0.12;
    float sparkle = step(0.985, noise(vXZ * 6.0 + vec2(uTime * 0.7, -uTime * 1.3)));
    float foam = 1.0 - smoothstep(0.0, 0.35, depth + (n - 0.5) * 0.25);
    col = mix(col, uFoam, foam * 0.85);
    col += sparkle * 0.35;
    float alpha = mix(0.6, 0.93, smoothstep(0.0, 1.4, depth));
    alpha = max(alpha, foam);
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`;

export class LevelBuilder {
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    this.group = null;
    this.animated = [];
    this.time = 0;
  }

  build(level) {
    this.dispose();
    this.level = level;
    this.group = new THREE.Group();
    this.group.name = `level-${level.id}`;
    this.scene.add(this.group);
    this.animated = [];
    const rand = rng(level.id * 9973 + 17);
    this.rand = rand;

    this.buildTerrain(level);
    this.buildWater(level);
    this.buildDam(level);
    this.buildScenery(level, rand);
    this.buildSite(level);
    this.piles = this.buildPiles(level);
    this.buildWorldBounds(level);
    return this;
  }

  // ---------------------------------------------------------------- terrain

  buildTerrain(level) {
    const g = level.gap / 2;
    const xs = gridAxis(g);
    const zs = [];
    for (let z = -WORLD.Z_HALF; z <= WORLD.Z_HALF + 1e-6; z += 0.6) zs.push(Math.round(z * 1000) / 1000);
    if (!zs.includes(0)) zs.push(0);
    zs.sort((a, b) => a - b);
    const nx = xs.length;
    const nz = zs.length;
    const pos = new Float32Array(nx * nz * 3);
    const col = new Float32Array(nx * nz * 3);
    const grass = new THREE.Color(level.theme.grass);
    const grassDark = new THREE.Color(COLORS.GRASS_DARK);
    const dirt = new THREE.Color(COLORS.DIRT);
    const rock = new THREE.Color(COLORS.ROCK);
    const sand = new THREE.Color(COLORS.SAND);
    const bed = new THREE.Color(0xa8916a);
    const bedDeep = new THREE.Color(0x6f7f73);
    const c = new THREE.Color();
    const heights = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = xs[i];
        const z = zs[j];
        const y = terrainHeight(level, x, z);
        heights[j * nx + i] = y;
        const k = (j * nx + i) * 3;
        pos[k] = x;
        pos[k + 1] = y;
        pos[k + 2] = z;
      }
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const y = heights[j * nx + i];
        const yl = heights[j * nx + Math.max(0, i - 1)];
        const yr = heights[j * nx + Math.min(nx - 1, i + 1)];
        const dx = xs[Math.min(nx - 1, i + 1)] - xs[Math.max(0, i - 1)] || 1;
        const slope = Math.abs(yr - yl) / dx;
        const n = Math.sin(xs[i] * 1.7 + zs[j] * 0.9) * 0.5 + Math.sin(xs[i] * 0.4 - zs[j] * 1.3) * 0.5;
        if (y < -0.25) {
          c.copy(bed).lerp(bedDeep, Math.min(1, -y / 3));
        } else if (y < 0.35) {
          c.copy(sand);
        } else if (slope > 1.4) {
          c.copy(level.theme.rocky || level.bankRun < 1 ? rock : dirt);
        } else if (slope > 0.6) {
          c.copy(dirt).lerp(grass, 0.35);
        } else {
          c.copy(grass).lerp(grassDark, 0.25 + n * 0.25);
        }
        const k = (j * nx + i) * 3;
        col[k] = c.r;
        col[k + 1] = c.g;
        col[k + 2] = c.b;
      }
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let p = 0;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const cc = a + nx;
        const d = cc + 1;
        idx[p++] = a;
        idx[p++] = cc;
        idx[p++] = b;
        idx[p++] = b;
        idx[p++] = cc;
        idx[p++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }),
    );
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.group.add(mesh);
    this.terrainMesh = mesh;
    this.physics.addTrimesh(pos, idx);
    // Rock ledges/pillars read better with a stone cap
    for (const f of level.features) {
      if (f.type === 'ledge') {
        const ledge = new THREE.Mesh(new THREE.BoxGeometry(f.w + 0.3, 0.35, 5.6), mat(0x8f8f9c, { flatShading: true }));
        ledge.position.set(f.x + (f.dir * (f.w - 0.3)) / 2, f.y - 0.12, 0);
        ledge.receiveShadow = true;
        ledge.castShadow = true;
        this.group.add(ledge);
      }
      if (f.type === 'pillar') {
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(f.r * 1.05, f.r * 1.15, 0.4, 9), mat(0x8f8f9c, { flatShading: true }));
        cap.position.set(f.x, f.top - 0.15, 0);
        cap.castShadow = true;
        cap.receiveShadow = true;
        this.group.add(cap);
      }
    }
  }

  // ---------------------------------------------------------------- water

  buildWater(level) {
    const g = level.gap / 2;
    const minX = -g - 10;
    const sizeX = level.gap + 20;
    const minZ = -WORLD.Z_HALF;
    const sizeZ = WORLD.Z_HALF * 2;
    const W = 128;
    const H = 128;
    const data = new Uint8Array(W * H * 4);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const x = minX + ((i + 0.5) / W) * sizeX;
        const z = minZ + ((j + 0.5) / H) * sizeZ;
        const depth = Math.max(0, GAME.WATER_Y - terrainHeight(level, x, z));
        const v = Math.min(255, Math.round((depth / 4) * 255));
        const k = (j * W + i) * 4;
        data[k] = v;
        data[k + 1] = v;
        data[k + 2] = v;
        data[k + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.waterUniforms = {
      uTime: { value: 0 },
      uDepth: { value: tex },
      uBounds: { value: new THREE.Vector4(minX, minZ, sizeX, sizeZ) },
      uShallow: { value: new THREE.Color(COLORS.WATER_SHALLOW) },
      uDeep: { value: new THREE.Color(COLORS.WATER_DEEP) },
      uFoam: { value: new THREE.Color(0xf4fffd) },
      uFlow: { value: WORLD.CURRENT },
    };
    const geo = new THREE.PlaneGeometry(sizeX, sizeZ, 60, 60);
    geo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.waterUniforms,
        vertexShader: WATER_VERT,
        fragmentShader: WATER_FRAG,
        transparent: true,
        depthWrite: false,
      }),
    );
    water.position.set(minX + sizeX / 2, GAME.WATER_Y, 0);
    water.renderOrder = 2;
    water.name = 'water';
    this.group.add(water);
  }

  // ---------------------------------------------------------------- dam

  buildDam(level) {
    const z = WORLD.DAM_Z;
    const half = gapHalf(level, z) + 1;
    const logMat = woodMaterial(0x8a5a33);
    const logGeos = [];
    const rows = 4;
    const m4 = new THREE.Matrix4();
    for (let r = 0; r < rows; r++) {
      for (let x = -half; x < half; x += 3.2) {
        const len = 3.6;
        const geo = new THREE.CylinderGeometry(0.28, 0.3, len, 8);
        const y = -level.depth + 0.25 + r * 0.45;
        m4.makeRotationFromEuler(new THREE.Euler(0, (this.rand() - 0.5) * 0.25, Math.PI / 2));
        m4.setPosition(x + len / 2 + (r % 2) * 1.2, Math.min(y, 0.55 + r * 0.05), z + (this.rand() - 0.5) * 0.5 - r * 0.15);
        geo.applyMatrix4(m4);
        logGeos.push(geo);
      }
    }
    const logs = new THREE.Mesh(mergeGeometries(logGeos), logMat);
    logs.castShadow = true;
    this.group.add(logs);
    this.physics.addStaticBox(0, -level.depth / 2, z, half, level.depth / 2 + 0.6, 0.5);
    // Beaver lodge on the dam side
    const lodge = new THREE.Group();
    for (let i = 0; i < 40; i++) {
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.6 + this.rand(), 5), mat(0x6e4a2b));
      const a = this.rand() * Math.PI * 2;
      const r = 0.4 + this.rand() * 1.3;
      stick.position.set(Math.cos(a) * r, 0.4 + this.rand() * (1.6 - r * 0.6), Math.sin(a) * r);
      stick.rotation.set(this.rand() * 2, this.rand() * 3, this.rand() * 2);
      stick.castShadow = true;
      lodge.add(stick);
    }
    mergeStatic(lodge);
    const mound = new THREE.Mesh(new THREE.SphereGeometry(1.7, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x7a5434, { flatShading: true }));
    lodge.add(mound);
    const lx = -gapHalf(level, z - 2.5) + 2.2;
    lodge.position.set(lx, Math.max(GAME.WATER_Y - 0.1, terrainHeight(level, lx, z - 2.5)), z - 2.5);
    this.group.add(lodge);
  }

  // ---------------------------------------------------------------- scenery

  placeable(level, x, z) {
    const g = level.gap / 2;
    if (Math.abs(x) < gapHalf(level, z) + 1.2) return false;
    if (Math.abs(z) < 2.4 && Math.abs(x) < g + 22) return false; // parade route
    if (x < -g && x > -g - 13 && z > -8 && z < 8) return false; // building site
    if (x > g && x < g + 9 && z > -4 && z < 5) return false; // duck meadow
    return terrainHeight(level, x, z) > 0.4;
  }

  buildScenery(level, rand) {
    const g = level.gap / 2;
    const theme = level.theme;
    // Trees
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 1.4, 6);
    trunkGeo.translate(0, 0.7, 0);
    const canopyGeo = new THREE.IcosahedronGeometry(1, 1);
    const pineGeo = new THREE.ConeGeometry(1, 2.4, 7);
    const trees = [];
    let tries = 0;
    while (trees.length < theme.trees && tries++ < 3000) {
      const x = (rand() * 2 - 1) * (g + WORLD.X_MARGIN - 2);
      const z = (rand() * 2 - 1) * (WORLD.Z_HALF - 2);
      if (!this.placeable(level, x, z)) continue;
      if (Math.abs(z) < 7 && Math.abs(x) < g + 6) continue;
      trees.push({ x, z, y: terrainHeight(level, x, z), s: 0.8 + rand() * 0.9, pine: rand() < (level.id === 2 ? 0.6 : 0.3) });
    }
    const trunks = new THREE.InstancedMesh(trunkGeo, mat(0x7a5232), trees.length);
    const leafy = trees.filter((t) => !t.pine);
    const pines = trees.filter((t) => t.pine);
    const canopies = new THREE.InstancedMesh(canopyGeo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), leafy.length * 2);
    const pineMesh = new THREE.InstancedMesh(pineGeo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), pines.length * 2);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const leafColors = [0x5fb64a, 0x79c94f, 0x4ea64a, 0x9bd35a, 0xf2a65a];
    trees.forEach((t, i) => {
      m4.compose(v.set(t.x, t.y - 0.1, t.z), q.identity(), s.set(t.s, t.s, t.s));
      trunks.setMatrixAt(i, m4);
    });
    leafy.forEach((t, i) => {
      for (let k = 0; k < 2; k++) {
        const r = t.s * (k === 0 ? 1.15 : 0.8);
        m4.compose(v.set(t.x + (k ? 0.3 : 0), t.y + t.s * (1.9 + k * 0.9), t.z + (k ? 0.2 : 0)), q.identity(), s.set(r, r * 0.9, r));
        canopies.setMatrixAt(i * 2 + k, m4);
        canopies.setColorAt(i * 2 + k, new THREE.Color(leafColors[Math.floor(rand() * (level.id === 5 ? 5 : 4))]));
      }
    });
    pines.forEach((t, i) => {
      for (let k = 0; k < 2; k++) {
        const r = t.s * (k === 0 ? 1.0 : 0.72);
        m4.compose(v.set(t.x, t.y + t.s * (2.0 + k * 1.1), t.z), q.identity(), s.set(r, r, r));
        pineMesh.setMatrixAt(i * 2 + k, m4);
        pineMesh.setColorAt(i * 2 + k, new THREE.Color(k ? 0x3f8f4a : 0x357a45));
      }
    });
    for (const im of [trunks, canopies, pineMesh]) {
      im.castShadow = true;
      im.receiveShadow = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      this.group.add(im);
    }

    // Bushes, rocks, flowers, reeds
    const bushGeo = new THREE.IcosahedronGeometry(0.6, 1);
    const rockGeo = new THREE.DodecahedronGeometry(0.5, 0);
    const flowerGeo = new THREE.SphereGeometry(0.07, 6, 4);
    const stemGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.25, 3);
    stemGeo.translate(0, 0.125, 0);
    const bushes = [];
    const rocks = [];
    const flowers = [];
    const reeds = [];
    for (let i = 0; i < 900; i++) {
      const x = (rand() * 2 - 1) * (g + WORLD.X_MARGIN - 1);
      const z = (rand() * 2 - 1) * (WORLD.Z_HALF - 1);
      const y = terrainHeight(level, x, z);
      const edge = Math.abs(Math.abs(x) - gapHalf(level, z));
      if (edge < 1.5 && y > -0.3 && y < 0.6 && Math.abs(z) > 3 && reeds.length < 70) {
        reeds.push({ x, y, z });
        continue;
      }
      if (!this.placeable(level, x, z)) continue;
      const r = rand();
      if (r < 0.12 && bushes.length < 60) bushes.push({ x, y, z, s: 0.6 + rand() * 0.8 });
      else if (r < 0.2 && rocks.length < 50) rocks.push({ x, y, z, s: 0.3 + rand() * (theme.rocky ? 1.4 : 0.8) });
      else if (flowers.length < theme.flowers) flowers.push({ x, y, z });
    }
    const bushMesh = new THREE.InstancedMesh(bushGeo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), bushes.length);
    bushes.forEach((b, i) => {
      m4.compose(v.set(b.x, b.y + b.s * 0.3, b.z), q.identity(), s.set(b.s, b.s * 0.75, b.s));
      bushMesh.setMatrixAt(i, m4);
      bushMesh.setColorAt(i, new THREE.Color(rand() < 0.5 ? 0x5aa646 : 0x6cbf52));
    });
    const rockMesh = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: COLORS.ROCK, roughness: 0.95, flatShading: true }), rocks.length);
    rocks.forEach((b, i) => {
      q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3));
      m4.compose(v.set(b.x, b.y + b.s * 0.15, b.z), q, s.set(b.s, b.s * 0.7, b.s));
      rockMesh.setMatrixAt(i, m4);
    });
    q.identity();
    const flowerColors = [0xff6b8a, 0xffe14a, 0xffffff, 0xb48cff, 0xff9d2a, 0x6fc3ff];
    const flowerMesh = new THREE.InstancedMesh(flowerGeo, new THREE.MeshStandardMaterial({ roughness: 0.6 }), flowers.length);
    const stemMesh = new THREE.InstancedMesh(stemGeo, mat(0x3f9a3a), flowers.length);
    flowers.forEach((f, i) => {
      m4.compose(v.set(f.x, f.y + 0.25, f.z), q, s.set(1, 0.8, 1));
      flowerMesh.setMatrixAt(i, m4);
      flowerMesh.setColorAt(i, new THREE.Color(flowerColors[Math.floor(rand() * flowerColors.length)]));
      m4.compose(v.set(f.x, f.y, f.z), q, s.set(1, 1, 1));
      stemMesh.setMatrixAt(i, m4);
    });
    const reedGeo = new THREE.CylinderGeometry(0.02, 0.025, 1.2, 3);
    reedGeo.translate(0, 0.6, 0);
    const reedMesh = new THREE.InstancedMesh(reedGeo, mat(0x5c9a3c), reeds.length * 3);
    const cattailGeo = new THREE.CapsuleGeometry(0.045, 0.18, 2, 5);
    const cattailMesh = new THREE.InstancedMesh(cattailGeo, mat(0x6b4226), reeds.length);
    reeds.forEach((r, i) => {
      for (let k = 0; k < 3; k++) {
        q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.3, 0, (rand() - 0.5) * 0.3));
        const h = 0.7 + rand() * 0.6;
        m4.compose(v.set(r.x + (rand() - 0.5) * 0.4, r.y - 0.1, r.z + (rand() - 0.5) * 0.4), q, s.set(1, h, 1));
        reedMesh.setMatrixAt(i * 3 + k, m4);
        if (k === 0) {
          m4.compose(v.set(r.x, r.y - 0.1 + 1.2 * h, r.z), q, s.set(1, 1, 1));
          cattailMesh.setMatrixAt(i, m4);
        }
      }
    });
    q.identity();
    for (const im of [bushMesh, rockMesh, flowerMesh, stemMesh, reedMesh, cattailMesh]) {
      im.castShadow = im !== flowerMesh && im !== stemMesh;
      im.receiveShadow = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      this.group.add(im);
    }

    // Distant hills / mountains
    const hillMat = new THREE.MeshStandardMaterial({ color: theme.windy ? 0x9fb7a5 : 0x8fbf7a, roughness: 1, flatShading: true });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rand() * 0.3;
      const r = 95 + rand() * 40;
      const h = theme.windy || theme.rocky ? 18 + rand() * 30 : 10 + rand() * 16;
      const geo = theme.windy || theme.rocky ? new THREE.ConeGeometry(18 + rand() * 12, h, 6) : new THREE.SphereGeometry(20 + rand() * 12, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      const hill = new THREE.Mesh(geo, hillMat);
      hill.position.set(Math.cos(a) * r, theme.windy || theme.rocky ? h / 2 - 4 : -4, Math.sin(a) * r);
      if (!(theme.windy || theme.rocky)) hill.scale.y = h / 25;
      this.group.add(hill);
      if (theme.windy && h > 32) {
        const cap = new THREE.Mesh(new THREE.ConeGeometry(6, 8, 6), mat(0xffffff, { flatShading: true }));
        cap.position.set(hill.position.x, h - 4 - 4 + 0.5, hill.position.z);
        this.group.add(cap);
      }
    }

    // Clouds
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0.25 });
    for (let i = 0; i < 9; i++) {
      const cloud = new THREE.Group();
      for (let k = 0; k < 5; k++) {
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(2 + rand() * 2.2, 1), cloudMat);
        puff.position.set(k * 2.6 - 5, rand() * 1.2, rand() * 1.6);
        cloud.add(puff);
      }
      cloud.position.set((rand() * 2 - 1) * 90, 26 + rand() * 14, -30 - rand() * 60);
      cloud.userData.speed = 0.6 + rand() * 0.8;
      this.group.add(cloud);
      this.animated.push((dt) => {
        cloud.position.x += cloud.userData.speed * dt * (theme.windy ? 3 : 1);
        if (cloud.position.x > 110) cloud.position.x = -110;
      });
    }
  }

  // ---------------------------------------------------------------- site props

  buildSite(level) {
    const g = level.gap / 2;
    const yAt = (x, z) => terrainHeight(level, x, z);
    // Sign
    const sign = new THREE.Group();
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = '#2b2b2b';
    for (let i = 0; i < 12; i++) ctx.fillRect(i * 48 - 20, 0, 22, 26), ctx.fillRect(i * 48 - 20, 230, 22, 26);
    ctx.font = 'bold 64px Fredoka, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BRIDGE', 256, 100);
    ctx.font = 'bold 40px Fredoka, system-ui, sans-serif';
    ctx.fillText('INSPECTION TODAY!', 256, 160);
    ctx.font = '34px Fredoka, system-ui, sans-serif';
    ctx.fillText('🦛 + 🐥🐥🐥', 256, 210);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.08), [mat(0xffd23f), mat(0xffd23f), mat(0xffd23f), mat(0xffd23f), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), mat(0xffd23f)]);
    board.position.y = 1.5;
    board.castShadow = true;
    sign.add(board);
    for (const sx of [-0.8, 0.8]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6), woodMaterial(0x8a5a33));
      pole.position.set(sx, 0.8, -0.05);
      sign.add(pole);
    }
    const sx = -g - 11;
    const sz = -2.4;
    sign.position.set(sx, yAt(sx, sz), sz);
    sign.rotation.y = 0.35;
    this.group.add(sign);

    // Cones
    const coneGeo = new THREE.ConeGeometry(0.18, 0.5, 10);
    for (const [cx, cz] of [[-g - 1.2, -2.2], [-g - 1.2, 2.2], [g + 1.2, -2.2], [g + 1.2, 2.2]]) {
      const cone = new THREE.Mesh(coneGeo, mat(0xff7a1a));
      cone.position.set(cx, yAt(cx, cz) + 0.25, cz);
      cone.castShadow = true;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.08, 10), mat(0xffffff));
      band.position.y = 0.02;
      cone.add(band);
      this.group.add(cone);
    }

    // Sawhorse with a plank
    const saw = new THREE.Group();
    for (const lx of [-0.6, 0.6]) {
      for (const lz of [-0.25, 0.25]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.06), woodMaterial(0x9c6b3e));
        leg.position.set(lx, 0.38, lz);
        leg.rotation.x = lz > 0 ? -0.25 : 0.25;
        saw.add(leg);
      }
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.12), woodMaterial(0x9c6b3e));
    top.position.y = 0.78;
    saw.add(top);
    saw.traverse((o) => (o.castShadow = true));
    const swx = -g - 11.5;
    const swz = 4.5;
    saw.position.set(swx, yAt(swx, swz), swz);
    this.group.add(saw);

    // Finish meadow flag + bunting on the far bank
    const flag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), mat(0xffffff));
    pole.position.y = 1.3;
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55, 6, 2), mat(0xff5f7e, { side: THREE.DoubleSide }));
    cloth.position.set(0.47, 2.25, 0);
    flag.add(pole, cloth);
    const fx = g + 4.5;
    const fz = -2.6;
    flag.position.set(fx, yAt(fx, fz), fz);
    this.group.add(flag);
    const base = cloth.geometry.attributes.position.array.slice();
    this.animated.push((dt, t) => {
      const arr = cloth.geometry.attributes.position.array;
      for (let i = 0; i < arr.length; i += 3) {
        const x = base[i] + 0.45;
        arr[i + 2] = Math.sin(t * 5 + x * 6) * 0.08 * x;
      }
      cloth.geometry.attributes.position.needsUpdate = true;
    });
    // Little nest for rescued ducklings
    const nest = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.25, 6, 14), mat(0xb08a4e, { flatShading: true }));
    nest.rotation.x = -Math.PI / 2;
    const nx = g + 5;
    nest.position.set(nx, yAt(nx, 0.8) + 0.12, 0.8);
    nest.receiveShadow = true;
    this.group.add(nest);
    this.nestPos = new THREE.Vector3(nx, yAt(nx, 0.8), 0.8);
  }

  // ---------------------------------------------------------------- piles

  buildPiles(level) {
    const g = level.gap / 2;
    const piles = [];
    const spots = { shortPlank: -g - 2.6, longPlank: -g - 4.6, beam: -g - 6.6, post: -g - 8.6 };
    const z = -4.4;
    for (const type of MATERIAL_ORDER) {
      const count = level.budget[type] || 0;
      const x = spots[type];
      const y = terrainHeight(level, x, z);
      const pile = createPile(type, count);
      pile.group.rotation.y = Math.PI / 2;
      pile.group.position.set(x, y, z);
      this.group.add(pile.group);
      const label = makeLabelSprite(`${MATERIALS[type].name} ×${count}`);
      label.position.set(x, y + (MATERIAL_ORDER.indexOf(type) % 2 ? 2.15 : 1.45), z);
      this.group.add(label);
      const len = MATERIALS[type].length;
      this.physics.addStaticBox(x, y + 0.3, z, 0.9, 0.3, len / 2 + 0.1);
      piles.push({ type, x, y, z, halfLen: len / 2, pile, label, count });
    }
    // Connector crate (tool belt refills itself from here — decorative + label)
    const cx = -g - 10.4;
    const cy = terrainHeight(level, cx, z);
    const crate = createCrate();
    crate.position.set(cx, cy, z);
    this.group.add(crate);
    const clabel = makeLabelSprite(`Connectors ×${level.budget.connector}`);
    clabel.position.set(cx, cy + 1.45, z);
    this.group.add(clabel);
    this.physics.addStaticBox(cx, cy + 0.3, z, 0.45, 0.3, 0.35);
    piles.push({ type: 'connector', x: cx, y: cy, z, halfLen: 0.4, pile: { meshes: [] }, label: clabel, count: level.budget.connector });
    return piles;
  }

  updatePileVisual(pile, count, name) {
    pile.count = count;
    if (pile.pile.boards) pile.pile.boards.count = Math.max(0, Math.min(count, pile.pile.max));
    const old = pile.label;
    const label = makeLabelSprite(`${name} ×${count}`, count === 0 ? { bg: '#f3d6d0', fg: '#9b3b2b' } : undefined);
    label.position.copy(old.position);
    this.group.add(label);
    this.group.remove(old);
    old.material.map.dispose();
    old.material.dispose();
    pile.label = label;
  }

  // ---------------------------------------------------------------- bounds

  buildWorldBounds(level) {
    const g = level.gap / 2;
    const X = g + WORLD.PLAY_X_MARGIN;
    const Z = WORLD.PLAY_Z_HALF;
    this.physics.addStaticBox(-X - 0.5, 5, 0, 0.5, 20, Z + 1);
    this.physics.addStaticBox(X + 0.5, 5, 0, 0.5, 20, Z + 1);
    this.physics.addStaticBox(0, 5, -Z - 0.5, X + 1, 20, 0.5);
    this.physics.addStaticBox(0, 5, Z + 0.5, X + 1, 20, 0.5);
  }

  update(dt) {
    this.time += dt;
    if (this.waterUniforms) this.waterUniforms.uTime.value = this.time;
    for (const fn of this.animated) fn(dt, this.time);
  }

  dispose() {
    if (!this.group) return;
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.map && m.map !== undefined && o.isSprite) m.map.dispose();
          if (o.isSprite || m.isShaderMaterial) m.dispose();
        }
      }
    });
    this.group = null;
  }
}
