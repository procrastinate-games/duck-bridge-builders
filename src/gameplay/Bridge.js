// Renders the solver's structure as 3D wood, mirrors every intact member with a
// kinematic Rapier collider (so the beaver can walk on it), and shows joints,
// connectors, stress tint, damage and failure markers.

import * as THREE from 'three';
import { COLORS, MATERIALS } from '../core/Constants.js';
import { createPieceMesh, mat } from '../level/models.js';
import { G, quatZ } from '../systems/PhysicsWorld.js';

const C_OK = new THREE.Color(COLORS.STRESS_OK);
const C_MID = new THREE.Color(COLORS.STRESS_MID);
const C_HIGH = new THREE.Color(COLORS.STRESS_HIGH);

function stressColor(s, out) {
  if (s < 0.5) return out.copy(C_OK).lerp(C_MID, s / 0.5);
  return out.copy(C_MID).lerp(C_HIGH, Math.min(1, (s - 0.5) / 0.5));
}

const boltGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.05, 8);
boltGeo.rotateX(Math.PI / 2);
const plateGeo = new THREE.BoxGeometry(0.42, 0.42, 0.04);
const ringGeo = new THREE.TorusGeometry(0.22, 0.04, 6, 20);
const glowGeo = new THREE.SphereGeometry(0.13, 12, 8);

export class Bridge {
  constructor(scene, physics, solver) {
    this.scene = scene;
    this.physics = physics;
    this.solver = solver;
    this.group = new THREE.Group();
    this.group.name = 'bridge';
    scene.add(this.group);
    this.members = new Map(); // id → visual record
    this.nodes = new Map();
    this.colliderToMember = new Map();
    this.ghosts = [];
    this.showJointHints = false;
    this.stressMode = 'always';
    this.time = 0;
    this.tmpColor = new THREE.Color();
    this.highlightMember = null;
    this.highlightNode = null;
    this.windSway = 0;
  }

  // ---------------------------------------------------------------- topology

  syncTopology() {
    for (const [id, rec] of this.members) {
      if (!this.solver.members.has(id)) this.removeMemberVisual(id, rec);
    }
    for (const m of this.solver.members.values()) {
      if (!this.members.has(m.id)) this.addMemberVisual(m);
    }
    for (const [id, rec] of this.nodes) {
      if (!this.solver.nodes.has(id)) {
        this.group.remove(rec.group);
        this.nodes.delete(id);
      }
    }
    for (const n of this.solver.nodes.values()) {
      if (!this.nodes.has(n.id)) this.addNodeVisual(n);
    }
  }

  addMemberVisual(m, spawnFrom = null) {
    const mesh = createPieceMesh(m.type, m.restLen);
    this.group.add(mesh);
    const world = this.physics.world;
    const body = world.createRigidBody(this.physics.RAPIER.RigidBodyDesc.kinematicPositionBased());
    const colliders = [];
    const mt = MATERIALS[m.type];
    if (mt.kind === 'deck') {
      // Rounded and slightly longer than the plank, so neighbouring planks
      // overlap at the joint with no lip for the beaver to catch on.
      const r = 0.05;
      const c = world.createCollider(
        this.physics.RAPIER.ColliderDesc.roundCuboid(m.restLen / 2 + 0.08 - r, mt.thick / 2 - r, mt.width / 2 - r, r)
          .setCollisionGroups(G.deck)
          .setFriction(1.0),
        body,
      );
      colliders.push(c);
    } else {
      for (const side of [-1, 1]) {
        const c = world.createCollider(
          this.physics.RAPIER.ColliderDesc.cuboid(m.restLen / 2, mt.thick / 2, mt.width / 2)
            .setTranslation(0, 0, side * 1.05)
            .setCollisionGroups(G.rail),
          body,
        );
        colliders.push(c);
      }
    }
    for (const c of colliders) this.colliderToMember.set(c.handle, m.id);
    const rec = { mesh, body, colliders, spawn: spawnFrom ? { t: 0, ...spawnFrom } : null, cracks: null };
    this.members.set(m.id, rec);
    this.placeMemberNow(m, rec);
    return rec;
  }

  removeMemberVisual(id, rec) {
    this.group.remove(rec.mesh);
    rec.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    for (const c of rec.colliders) this.colliderToMember.delete(c.handle);
    if (this.physics.world) this.physics.world.removeRigidBody(rec.body);
    this.members.delete(id);
  }

  addNodeVisual(n) {
    const g = new THREE.Group();
    const rec = { group: g, bolts: [], plates: [], rings: [], glow: null, anchor: null, fail: null };
    if (n.fixed) {
      if (n.kind === 'stake') {
        for (const side of [-1, 1]) {
          const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.08, 1.4, 7), mat(COLORS.ANCHOR));
          stake.position.set(0, -0.45, side * 1.2);
          stake.castShadow = true;
          const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.08, 8), mat(COLORS.METAL, { metalness: 0.6, roughness: 0.4 }));
          cap.position.set(0, 0.27, side * 1.2);
          g.add(stake, cap);
        }
      } else {
        const slab = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 2.5), mat(0xa3a3ad, { flatShading: true }));
        slab.position.y = -0.1;
        slab.castShadow = true;
        slab.receiveShadow = true;
        g.add(slab);
      }
    }
    for (const side of [-1, 1]) {
      const bolt = new THREE.Mesh(boltGeo, mat(0x4a4a52, { metalness: 0.5, roughness: 0.4 }));
      bolt.position.z = side * 1.16;
      g.add(bolt);
      rec.bolts.push(bolt);
      const plate = new THREE.Mesh(plateGeo, mat(COLORS.METAL, { metalness: 0.75, roughness: 0.3 }));
      plate.position.z = side * 1.17;
      plate.visible = false;
      g.add(plate);
      rec.plates.push(plate);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff9d2a, transparent: true, opacity: 0.9 }));
      ring.position.z = side * 1.22;
      ring.visible = false;
      g.add(ring);
      rec.rings.push(ring);
    }
    const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ color: COLORS.NODE, transparent: true, opacity: 0.85, depthTest: false }));
    glow.renderOrder = 10;
    glow.visible = false;
    g.add(glow);
    rec.glow = glow;
    const fail = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 6, 24), new THREE.MeshBasicMaterial({ color: COLORS.STRESS_HIGH, transparent: true, opacity: 0.85, depthTest: false }));
    fail.renderOrder = 11;
    fail.visible = false;
    g.add(fail);
    rec.fail = fail;
    this.group.add(g);
    this.nodes.set(n.id, rec);
  }

  // ---------------------------------------------------------------- per frame

  placeMemberNow(m, rec) {
    const a = this.solver.nodes.get(m.a);
    const b = this.solver.nodes.get(m.b);
    if (!a || !b) return;
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    rec.body.setNextKinematicTranslation({ x: cx, y: cy, z: 0 });
    rec.body.setNextKinematicRotation(quatZ(ang));
    rec.body.setTranslation({ x: cx, y: cy, z: 0 }, true);
    rec.body.setRotation(quatZ(ang), true);
    rec.mesh.position.set(cx, cy, 0);
    rec.mesh.rotation.set(0, 0, ang);
  }

  /** Called every fixed step: move kinematic colliders to the solved pose. */
  syncPhysics() {
    for (const [id, rec] of this.members) {
      const m = this.solver.members.get(id);
      if (!m) continue;
      const a = this.solver.nodes.get(m.a);
      const b = this.solver.nodes.get(m.b);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      rec.body.setNextKinematicTranslation({ x: cx, y: cy, z: 0 });
      rec.body.setNextKinematicRotation(quatZ(Math.atan2(b.y - a.y, b.x - a.x)));
    }
  }

  /** Called every render frame: visuals, tints, markers. */
  update(dt, { testing = false, carrying = false } = {}) {
    this.time += dt;
    const showStress = this.stressMode === 'always' || testing;
    const sway = this.windSway;
    for (const [id, rec] of this.members) {
      const m = this.solver.members.get(id);
      if (!m) continue;
      const a = this.solver.nodes.get(m.a);
      const b = this.solver.nodes.get(m.b);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (rec.spawn) {
        rec.spawn.t = Math.min(1, rec.spawn.t + dt / 0.28);
        const k = 1 - Math.pow(1 - rec.spawn.t, 3);
        rec.mesh.position.set(
          rec.spawn.x + (cx - rec.spawn.x) * k,
          rec.spawn.y + (cy - rec.spawn.y) * k + Math.sin(k * Math.PI) * 0.6,
          rec.spawn.z * (1 - k),
        );
        rec.mesh.rotation.set(0, (rec.spawn.yaw || 0) * (1 - k), ang * k + (rec.spawn.ang || 0) * (1 - k));
        if (rec.spawn.t >= 1) rec.spawn = null;
      } else {
        rec.mesh.position.set(cx, cy, 0);
        rec.mesh.rotation.set(sway * Math.sin(this.time * 1.7 + cx * 0.2) * 0.04, 0, ang);
      }
      rec.mesh.scale.x = len / m.restLen;
      // stress / damage tint
      const material = rec.mesh.userData.material;
      const s = showStress ? m.stress : 0;
      const highlight = this.highlightMember === id;
      if (highlight) {
        material.emissive.setHex(0x3b5cff);
        material.emissiveIntensity = 0.35 + Math.sin(this.time * 8) * 0.1;
      } else if (s > 0.25) {
        stressColor(s, material.emissive);
        material.emissiveIntensity = Math.min(0.7, (s - 0.25) * 1.2);
      } else {
        material.emissive.setHex(0x000000);
        material.emissiveIntensity = 0;
      }
      const dmg = m.damage;
      if (dmg > 0.05) material.color.setHex(m.mat.color).lerp(this.tmpColor.setHex(0x6b4a30), Math.min(0.7, dmg * 1.2));
      if (dmg > 0.12 && !rec.cracks) this.addCracks(rec, m);
    }

    for (const [id, rec] of this.nodes) {
      const n = this.solver.nodes.get(id);
      if (!n) continue;
      rec.group.position.set(n.x, n.y, 0);
      let loose = false;
      for (const mid of n.members) {
        const m = this.solver.members.get(mid);
        if (!m) continue;
        const e = m.a === id ? 0 : 1;
        if (!m.ends[e].rigid) loose = true;
      }
      const hasMembers = n.members.size > 0;
      for (const b of rec.bolts) b.visible = hasMembers && !n.reinforced;
      for (const p of rec.plates) {
        p.visible = n.reinforced && hasMembers;
        p.rotation.z = n.th;
      }
      for (const r of rec.rings) {
        r.visible = loose;
        r.scale.setScalar(1 + Math.sin(this.time * 6) * 0.12);
      }
      const hl = this.highlightNode === id;
      rec.glow.visible = (carrying && this.showJointHints) || hl;
      rec.glow.material.color.setHex(hl ? 0x7dd3ff : COLORS.NODE);
      rec.glow.scale.setScalar(hl ? 1.6 + Math.sin(this.time * 8) * 0.2 : 1 + Math.sin(this.time * 4 + id) * 0.15);
      rec.fail.visible = n.failedMark > 0 && !testing;
      if (rec.fail.visible) {
        rec.fail.material.opacity = 0.55 + Math.sin(this.time * 5) * 0.3;
        rec.fail.rotation.y = this.time;
      }
    }

    for (const g of this.ghosts) {
      g.mesh.visible = !testing;
      g.mesh.traverse((o) => {
        if (o.material) o.material.opacity = 0.18 + Math.sin(this.time * 3) * 0.08;
      });
    }
  }

  addCracks(rec, m) {
    rec.cracks = new THREE.Group();
    const crackMat = mat(0x3a2414);
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.3 + Math.random() * 0.3, 0.012, 0.03), crackMat);
      c.position.set((Math.random() - 0.5) * m.restLen * 0.7, (m.mat.thick / 2) + 0.004, (Math.random() - 0.5) * (m.mat.kind === 'deck' ? 1.6 : 0.1) + (m.mat.kind === 'deck' ? 0 : 1.05));
      c.rotation.y = (Math.random() - 0.5) * 0.8;
      rec.cracks.add(c);
    }
    rec.mesh.add(rec.cracks);
  }

  // ---------------------------------------------------------------- failure ghosts

  addGhost(type, x1, y1, x2, y2) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 0.2) return;
    const mesh = createPieceMesh(type, len);
    mesh.traverse((o) => {
      if (o.isMesh) {
        o.material = new THREE.MeshBasicMaterial({ color: COLORS.STRESS_HIGH, transparent: true, opacity: 0.25, depthWrite: false });
        o.castShadow = false;
      }
    });
    mesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0);
    mesh.rotation.z = Math.atan2(y2 - y1, x2 - x1);
    this.group.add(mesh);
    this.ghosts.push({ mesh, x1, y1, x2, y2 });
  }

  clearGhosts() {
    for (const g of this.ghosts) {
      this.group.remove(g.mesh);
      g.mesh.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    this.ghosts = [];
  }

  clearGhostsNear(x1, y1, x2, y2) {
    const keep = [];
    for (const g of this.ghosts) {
      const d1 = Math.hypot(g.x1 - x1, g.y1 - y1) + Math.hypot(g.x2 - x2, g.y2 - y2);
      const d2 = Math.hypot(g.x1 - x2, g.y1 - y2) + Math.hypot(g.x2 - x1, g.y2 - y1);
      if (Math.min(d1, d2) < 1.6) {
        this.group.remove(g.mesh);
      } else keep.push(g);
    }
    this.ghosts = keep;
  }

  memberForCollider(handle) {
    return this.colliderToMember.get(handle);
  }

  dispose() {
    for (const [id, rec] of [...this.members]) this.removeMemberVisual(id, rec);
    this.clearGhosts();
    this.scene.remove(this.group);
  }
}
