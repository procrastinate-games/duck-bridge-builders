// Procedural low-poly models: characters, materials and props.
// Everything faces +Z in local space.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS, MATERIALS } from '../core/Constants.js';

/**
 * Merge a group's static child meshes into one vertex-coloured mesh (one draw
 * call). Children listed in `keep` stay separate (they animate on their own).
 */
export function mergeStatic(group, keep = []) {
  const geos = [];
  const toRemove = [];
  group.updateMatrix();
  for (const child of [...group.children]) {
    if (!child.isMesh || keep.includes(child) || child.children.length) continue;
    const g = child.geometry.clone().toNonIndexed();
    child.updateMatrix();
    g.applyMatrix4(child.matrix);
    const col = child.material.color;
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    geos.push(g);
    toRemove.push(child);
  }
  if (geos.length < 2) return group;
  for (const c of toRemove) group.remove(c);
  const merged = new THREE.Mesh(mergeGeometries(geos), vertexColorMat());
  merged.castShadow = true;
  group.add(merged);
  return group;
}

let vcMat = null;
function vertexColorMat() {
  if (!vcMat) vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72 });
  return vcMat;
}

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = `${color}-${JSON.stringify(opts)}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...opts }));
  }
  return matCache.get(key);
}

const geoCache = new Map();
function sphereGeo(seg = 16) {
  const k = `s${seg}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.SphereGeometry(1, seg, Math.max(8, seg * 0.75)));
  return geoCache.get(k);
}
function capsuleGeo(r, len) {
  const k = `c${r}-${len}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.CapsuleGeometry(r, len, 4, 10));
  return geoCache.get(k);
}

function blob(color, sx, sy, sz, x = 0, y = 0, z = 0, seg = 16, opts) {
  const m = new THREE.Mesh(sphereGeo(seg), mat(color, opts));
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function eye(r, x, y, z, lookZ = 1) {
  const g = new THREE.Group();
  const white = blob(0xffffff, r, r, r * 0.8, 0, 0, 0, 12, { roughness: 0.3 });
  const pupil = blob(0x1d1410, r * 0.62, r * 0.66, r * 0.4, 0, -r * 0.05, r * 0.55 * lookZ, 12, { roughness: 0.2 });
  const shine = blob(0xffffff, r * 0.2, r * 0.2, r * 0.15, r * 0.22, r * 0.25, r * 0.8 * lookZ, 8, { emissive: 0xffffff, emissiveIntensity: 0.6 });
  g.add(white, pupil, shine);
  g.position.set(x, y, z);
  white.castShadow = false;
  return { group: g, pupil };
}

function pivot(x, y, z, child, cx = 0, cy = 0, cz = 0) {
  const p = new THREE.Group();
  p.position.set(x, y, z);
  child.position.set(cx, cy, cz);
  p.add(child);
  return p;
}

// ------------------------------------------------------------------ beaver

export function createBeaver() {
  const root = new THREE.Group();
  const body = new THREE.Group(); // bobs/leans
  root.add(body);

  const torso = blob(COLORS.BEAVER_FUR, 0.42, 0.48, 0.38, 0, 0.6, 0);
  const belly = blob(COLORS.BEAVER_BELLY, 0.3, 0.36, 0.2, 0, 0.56, 0.22);
  body.add(torso, belly);

  // Safety vest: a band hugging the egg-shaped torso (torso radii 0.42 × 0.48 × 0.38,
  // centre y 0.6), open at the front over the light belly, with a reflective stripe.
  const TORSO_Y = 0.6;
  const band = (yTop, yBottom, sx, sy, sz, color, opts) => {
    const t1 = Math.acos(Math.min(1, (yTop - TORSO_Y) / sy));
    const t2 = Math.acos(Math.max(-1, (yBottom - TORSO_Y) / sy));
    const open = 0.4; // half-width of the front opening (radians)
    const geo = new THREE.SphereGeometry(1, 32, 8, Math.PI / 2 + open, Math.PI * 2 - open * 2, t1, t2 - t1);
    const m = new THREE.Mesh(geo, mat(color, opts));
    m.scale.set(sx, sy, sz);
    m.position.y = TORSO_Y;
    m.castShadow = true;
    return m;
  };
  const vest = band(0.92, 0.42, 0.445, 0.5, 0.405, COLORS.VEST);
  const stripe = band(0.69, 0.62, 0.452, 0.507, 0.412, COLORS.VEST_STRIPE, { emissive: 0x554400, emissiveIntensity: 0.3 });
  const stripe2 = band(0.52, 0.47, 0.45, 0.505, 0.41, COLORS.VEST_STRIPE, { emissive: 0x554400, emissiveIntensity: 0.3 });
  body.add(vest, stripe, stripe2);

  // Tool belt (oval, sitting on the vest's lower edge) + buckle + hammer tucked in
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.04, 6, 32), mat(0x5a3b1e));
  belt.rotation.x = Math.PI / 2;
  belt.scale.set(1, 0.92, 1); // local y → world z after the rotation
  belt.position.y = 0.42;
  body.add(belt);
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.03), mat(0xd9c25a, { metalness: 0.6, roughness: 0.3 }));
  buckle.position.set(0, 0.42, 0.405);
  body.add(buckle);
  const beltHammer = makeHammer();
  beltHammer.position.set(0.43, 0.44, 0.04);
  beltHammer.rotation.z = -0.2; // head up, tilted out a little
  body.add(beltHammer);
  const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.13, 0.08), mat(0x7a5230));
  pouch.position.set(-0.36, 0.38, 0.2);
  pouch.rotation.y = -0.75;
  body.add(pouch);

  // Head
  const head = new THREE.Group();
  head.position.set(0, 1.06, 0.03);
  body.add(head);
  head.add(blob(COLORS.BEAVER_FUR, 0.33, 0.3, 0.3, 0, 0, 0));
  head.add(blob(COLORS.BEAVER_BELLY, 0.17, 0.12, 0.12, -0.09, -0.08, 0.22));
  head.add(blob(COLORS.BEAVER_BELLY, 0.17, 0.12, 0.12, 0.09, -0.08, 0.22));
  head.add(blob(0x2b1a12, 0.065, 0.05, 0.05, 0, 0.0, 0.3, 12, { roughness: 0.3 }));
  const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.03), mat(0xfffbef, { roughness: 0.3 }));
  teeth.position.set(0, -0.15, 0.27);
  head.add(teeth);
  const toothGap = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.09, 0.032), mat(0xb8a98f));
  toothGap.position.set(0, -0.15, 0.272);
  head.add(toothGap);
  const eL = eye(0.085, -0.13, 0.08, 0.22);
  const eR = eye(0.085, 0.13, 0.08, 0.22);
  head.add(eL.group, eR.group);
  // little round ears on the sides of the head, just under the helmet brim
  const earL = blob(0x6e4420, 0.045, 0.06, 0.06, -0.31, 0.0, -0.06);
  const earR = blob(0x6e4420, 0.045, 0.06, 0.06, 0.31, 0.0, -0.06);
  head.add(earL, earR);
  // Helmet
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.33, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(COLORS.HELMET, { roughness: 0.35 }));
  helmet.position.y = 0.14;
  helmet.castShadow = true;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.03, 20), mat(COLORS.HELMET, { roughness: 0.35 }));
  brim.position.set(0, 0.15, 0.04);
  brim.rotation.x = -0.08; // tipped back a little so the eyes show
  // centre ridge: a half-ring that hugs the dome from front to back
  const ridge = new THREE.Mesh(new THREE.TorusGeometry(0.335, 0.026, 6, 24, Math.PI), mat(0xffdd55, { roughness: 0.35 }));
  ridge.rotation.y = Math.PI / 2;
  ridge.position.set(0, 0.14, 0);
  head.add(helmet, brim, ridge);

  // Arms (pivot at shoulder)
  const armGeo = capsuleGeo(0.08, 0.3);
  const mkArm = (side) => {
    const arm = new THREE.Mesh(armGeo, mat(COLORS.BEAVER_FUR));
    arm.castShadow = true;
    const hand = blob(0x6e4420, 0.08, 0.075, 0.08, 0, -0.26, 0);
    arm.add(hand);
    // shoulder sits just outside the vest so the arm reads as an arm
    return pivot(side * 0.45, 0.84, 0.03, arm, 0, -0.17, 0);
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);
  body.add(armL, armR);
  const heldHammer = makeHammer();
  heldHammer.position.set(0, -0.3, 0.06);
  heldHammer.rotation.x = Math.PI / 2;
  heldHammer.visible = false;
  armR.children[0].add(heldHammer);

  // Legs (pivot at hip)
  const legGeo = capsuleGeo(0.09, 0.14);
  const mkLeg = (side) => {
    const leg = new THREE.Mesh(legGeo, mat(COLORS.BEAVER_FUR));
    leg.castShadow = true;
    const foot = blob(0x4a2e18, 0.1, 0.05, 0.15, 0, -0.14, 0.05);
    leg.add(foot);
    return pivot(side * 0.17, 0.26, 0, leg, 0, -0.1, 0);
  };
  const legL = mkLeg(-1);
  const legR = mkLeg(1);
  root.add(legL, legR);

  // Big flat tail
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.32, -0.3);
  const tail = blob(COLORS.BEAVER_TAIL, 0.26, 0.06, 0.42, 0, 0, -0.38);
  tailPivot.add(tail);
  // cross-hatch dimples
  for (let i = 0; i < 6; i++) {
    tailPivot.add(blob(0x452a16, 0.035, 0.02, 0.035, (i % 2 ? 0.08 : -0.08), 0.045, -0.16 - i * 0.09, 6));
  }
  root.add(tailPivot);

  // Carry anchor (on the shoulder)
  const carryAnchor = new THREE.Group();
  carryAnchor.position.set(0, 1.05, 0.05);
  body.add(carryAnchor);

  mergeStatic(head);
  mergeStatic(body, [beltHammer]);
  mergeStatic(tailPivot);
  return {
    root, body, head, armL, armR, legL, legR, tailPivot, carryAnchor,
    heldHammer, beltHammer, eyes: [eL, eR],
  };
}

export function makeHammer() {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.3, 6), mat(0xa0703c));
  handle.position.y = -0.1;
  const headM = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.06, 0.06), mat(0x8d969e, { metalness: 0.7, roughness: 0.35 }));
  headM.position.y = 0.05;
  g.add(handle, headM);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

// ------------------------------------------------------------------ duckling

export function createDuckling(tint = COLORS.DUCK) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.add(blob(tint, 0.17, 0.15, 0.2, 0, 0.19, 0));
  body.add(blob(0xfff5b8, 0.11, 0.09, 0.11, 0, 0.15, 0.09));
  const tailTuft = blob(tint, 0.06, 0.05, 0.08, 0, 0.26, -0.19);
  tailTuft.rotation.x = -0.6;
  body.add(tailTuft);
  const head = new THREE.Group();
  head.position.set(0, 0.38, 0.08);
  body.add(head);
  head.add(blob(tint, 0.13, 0.125, 0.13, 0, 0, 0));
  const tuft = blob(tint, 0.03, 0.06, 0.03, 0, 0.13, -0.01, 8);
  tuft.rotation.z = 0.4;
  head.add(tuft);
  const beakTop = blob(COLORS.DUCK_BEAK, 0.07, 0.025, 0.075, 0, -0.01, 0.13, 10, { roughness: 0.4 });
  const beakBottom = blob(0xf08a1f, 0.06, 0.02, 0.065, 0, -0.035, 0.12, 10, { roughness: 0.4 });
  head.add(beakTop, beakBottom);
  head.add(blob(0x1a1a1a, 0.025, 0.03, 0.02, -0.065, 0.03, 0.105, 8, { roughness: 0.2 }));
  head.add(blob(0x1a1a1a, 0.025, 0.03, 0.02, 0.065, 0.03, 0.105, 8, { roughness: 0.2 }));
  head.add(blob(0xffffff, 0.008, 0.008, 0.006, -0.058, 0.042, 0.122, 6, { emissive: 0xffffff }));
  head.add(blob(0xffffff, 0.008, 0.008, 0.006, 0.072, 0.042, 0.122, 6, { emissive: 0xffffff }));
  head.add(blob(0xff9fb0, 0.025, 0.012, 0.01, -0.08, -0.025, 0.09, 6));
  head.add(blob(0xff9fb0, 0.025, 0.012, 0.01, 0.08, -0.025, 0.09, 6));
  const wingL = pivot(-0.15, 0.24, 0, blob(tint, 0.03, 0.08, 0.11));
  const wingR = pivot(0.15, 0.24, 0, blob(tint, 0.03, 0.08, 0.11));
  body.add(wingL, wingR);
  const mkFoot = (side) => pivot(side * 0.07, 0.05, 0.02, blob(COLORS.DUCK_BEAK, 0.045, 0.015, 0.07, 0, -0.03, 0.03, 8));
  const footL = mkFoot(-1);
  const footR = mkFoot(1);
  root.add(footL, footR);
  mergeStatic(head, [beakBottom]);
  mergeStatic(body, [head, wingL, wingR]);
  return { root, body, head, beakBottom, wingL, wingR, footL, footR };
}

// ------------------------------------------------------------------ hippo

export function createHippo() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.add(blob(COLORS.HIPPO, 1.0, 0.86, 1.42, 0, 1.06, 0, 24));
  body.add(blob(COLORS.HIPPO_BELLY, 0.82, 0.5, 1.15, 0, 0.78, 0.05, 20));
  const tail = blob(COLORS.HIPPO, 0.08, 0.14, 0.08, 0, 1.12, -1.42, 8);
  body.add(tail);

  const head = new THREE.Group();
  head.position.set(0, 1.48, 1.25);
  body.add(head);
  head.add(blob(COLORS.HIPPO, 0.62, 0.55, 0.62, 0, 0.05, 0.1, 20));
  const snout = blob(0xc8b3e0, 0.62, 0.42, 0.5, 0, -0.18, 0.58, 20);
  head.add(snout);
  head.add(blob(0x7c6596, 0.07, 0.05, 0.04, -0.18, -0.05, 1.03, 8));
  head.add(blob(0x7c6596, 0.07, 0.05, 0.04, 0.18, -0.05, 1.03, 8));
  head.add(blob(0xff9fc2, 0.12, 0.05, 0.05, -0.42, -0.2, 0.6, 8));
  head.add(blob(0xff9fc2, 0.12, 0.05, 0.05, 0.42, -0.2, 0.6, 8));
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 6, 16, Math.PI), mat(0x5c4775));
  mouth.position.set(0, -0.32, 0.98);
  mouth.rotation.set(0.2, 0, Math.PI);
  head.add(mouth);
  const eL = eye(0.13, -0.27, 0.4, 0.38);
  const eR = eye(0.13, 0.27, 0.4, 0.38);
  head.add(eL.group, eR.group);
  const browL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.04), mat(0x6d5a86));
  browL.position.set(-0.27, 0.58, 0.45);
  const browR = browL.clone();
  browR.position.x = 0.27;
  head.add(browL, browR);
  const earL = blob(COLORS.HIPPO, 0.1, 0.13, 0.06, -0.42, 0.52, -0.1, 10);
  const earR = blob(COLORS.HIPPO, 0.1, 0.13, 0.06, 0.42, 0.52, -0.1, 10);
  head.add(earL, earR);
  // Inspector hat + rosette
  const hat = new THREE.Group();
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.32, 18), mat(0x2f6b4f));
  crown.position.y = 0.16;
  const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.04, 20), mat(0x2f6b4f));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.305, 0.305, 0.07, 18), mat(0xffd23f));
  band.position.y = 0.06;
  hat.add(crown, hatBrim, band);
  hat.position.set(0, 0.58, 0.02);
  hat.rotation.z = 0.12;
  hat.traverse((o) => (o.castShadow = true));
  head.add(hat);
  const bow = new THREE.Group();
  bow.add(blob(0xff5f7e, 0.12, 0.09, 0.05, -0.1, 0, 0, 8));
  bow.add(blob(0xff5f7e, 0.12, 0.09, 0.05, 0.1, 0, 0, 8));
  bow.add(blob(0xff8fa6, 0.05, 0.05, 0.05, 0, 0, 0.02, 8));
  bow.position.set(0, -0.48, 0.55);
  head.add(bow);

  const legGeo = new THREE.CylinderGeometry(0.3, 0.33, 0.62, 12);
  const mkLeg = (x, z) => {
    const leg = new THREE.Mesh(legGeo, mat(COLORS.HIPPO));
    leg.castShadow = true;
    const toe = blob(0xd9cce8, 0.33, 0.08, 0.34, 0, -0.29, 0.04, 10);
    leg.add(toe);
    return pivot(x, 0.6, z, leg, 0, -0.3, 0);
  };
  const legs = [mkLeg(-0.55, 0.78), mkLeg(0.55, 0.78), mkLeg(-0.55, -0.78), mkLeg(0.55, -0.78)];
  for (const l of legs) root.add(l);
  mergeStatic(head, [browL, browR, mouth]);
  mergeStatic(body, [tail]);
  return { root, body, head, legs, tail, eyes: [eL, eR], brows: [browL, browR], mouth };
}

// ------------------------------------------------------------------ wood

let woodTex = null;
export function woodTexture() {
  if (woodTex) return woodTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#e8c08a';
  g.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 26; i++) {
    const y = Math.random() * 64;
    g.strokeStyle = `rgba(120,70,30,${0.12 + Math.random() * 0.18})`;
    g.lineWidth = 1 + Math.random() * 2;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 2.5);
    g.stroke();
  }
  for (let i = 0; i < 3; i++) {
    const x = 30 + Math.random() * 200;
    const y = 10 + Math.random() * 44;
    g.fillStyle = 'rgba(110,60,25,0.35)';
    g.beginPath();
    g.ellipse(x, y, 6, 3, 0, 0, Math.PI * 2);
    g.fill();
  }
  woodTex = new THREE.CanvasTexture(c);
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
  woodTex.colorSpace = THREE.SRGBColorSpace;
  return woodTex;
}

let deckTex = null;
export function deckTexture() {
  if (deckTex) return deckTex;
  const src = woodTexture().image;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  g.fillStyle = 'rgba(80,45,15,0.55)';
  for (let i = 0; i < 4; i++) g.fillRect(i * 64, 0, 3, 64);
  deckTex = new THREE.CanvasTexture(c);
  deckTex.wrapS = deckTex.wrapT = THREE.RepeatWrapping;
  deckTex.colorSpace = THREE.SRGBColorSpace;
  return deckTex;
}

const woodMats = new Map();
export function woodMaterial(color) {
  if (!woodMats.has(color)) {
    woodMats.set(color, new THREE.MeshStandardMaterial({ color, map: woodTexture(), roughness: 0.82 }));
  }
  return woodMats.get(color);
}

/**
 * Visual mesh for a structural piece of `length` lying along local +X,
 * centred at the origin. Planks are wide decks; beams/posts are twin rails.
 */
export function createPieceMesh(type, length, { broken = false } = {}) {
  const m = MATERIALS[type];
  const g = new THREE.Group();
  const color = broken ? 0x9c7a55 : m.color;
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.82 });
  material.map = (m.kind === 'deck' ? deckTexture() : woodTexture()).clone();
  material.map.needsUpdate = true;
  material.map.repeat.set(Math.max(0.5, length / 2), 1);
  const parts = [];
  const box = (w, h, d, x = 0, y = 0, z = 0) => {
    const b = new THREE.BoxGeometry(w, h, d);
    b.translate(x, y, z);
    parts.push(b);
  };
  if (m.kind === 'deck') {
    box(length, m.thick, m.width);
    for (const side of [-1, 1]) box(length, 0.06, 0.08, 0, m.thick / 2 + 0.03, side * (m.width / 2 - 0.04));
  } else {
    for (const side of [-1, 1]) box(length, m.thick, m.width, 0, 0, side * 1.05);
    if (m.kind === 'post') box(0.12, 0.12, 2.1);
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
  if (broken) {
    const spl = [];
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.ConeGeometry(0.04, 0.25, 4);
      sp.rotateZ(-Math.PI / 2 + (Math.random() - 0.5) * 0.5);
      sp.translate(length / 2 + 0.08, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * (m.kind === 'deck' ? 1.8 : 0.1) + (m.kind === 'deck' ? 0 : 1.05));
      spl.push(sp);
    }
    g.add(new THREE.Mesh(mergeGeometries(spl), mat(0xcaa070)));
  }
  g.userData.material = material;
  return g;
}

// ------------------------------------------------------------------ props

export function createPile(type, count) {
  const m = MATERIALS[type];
  const g = new THREE.Group();
  const len = m.length;
  const isDeck = m.kind === 'deck';
  const pieceW = isDeck ? 0.5 : m.width;
  const pieceH = isDeck ? 0.1 : m.thick;
  const max = Math.max(1, count);
  const boards = new THREE.InstancedMesh(new THREE.BoxGeometry(len, pieceH, pieceW), woodMaterial(m.color), max);
  const perRow = 3;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < max; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.06);
    m4.compose(new THREE.Vector3((row % 2) * 0.1, pieceH / 2 + row * pieceH + 0.12, (col - 1) * (pieceW + 0.05)), q, new THREE.Vector3(1, 1, 1));
    boards.setMatrixAt(i, m4);
  }
  boards.count = count;
  boards.castShadow = true;
  boards.receiveShadow = true;
  g.add(boards);
  const pallet = new THREE.Mesh(new THREE.BoxGeometry(len + 0.2, 0.12, 1.8), mat(0x7a5a3a));
  pallet.position.y = 0.06;
  pallet.receiveShadow = true;
  g.add(pallet);
  return { group: g, boards, max, meshes: [] };
}

export function createCrate() {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.7), woodMaterial(0xb07a45));
  box.position.y = 0.3;
  box.castShadow = true;
  g.add(box);
  for (let i = 0; i < 6; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.14), mat(COLORS.METAL, { metalness: 0.7, roughness: 0.35 }));
    p.position.set(-0.25 + (i % 3) * 0.25, 0.62 + Math.floor(i / 3) * 0.04, -0.12 + Math.floor(i / 3) * 0.2);
    p.rotation.y = Math.random();
    g.add(p);
  }
  return g;
}

export function makeLabelSprite(text, { bg = '#fff7e0', fg = '#5a3410', size = 64 } = {}) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `bold ${size}px "Fredoka", "Baloo 2", system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + size;
  c.width = w;
  c.height = size * 1.6;
  ctx.font = `bold ${size}px "Fredoka", "Baloo 2", system-ui, sans-serif`;
  ctx.fillStyle = bg;
  const r = size * 0.5;
  ctx.beginPath();
  ctx.roundRect(4, 4, w - 8, c.height - 8, r);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = fg;
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  const h = 0.36;
  sprite.scale.set((h * w) / c.height, h, 1);
  sprite.userData.canvas = c;
  return sprite;
}
