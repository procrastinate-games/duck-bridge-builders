// Free rigid pieces (Rapier dynamic bodies): broken halves, detached members,
// dropped materials. They float, drift downstream to the beaver dam, and can be
// picked up again.

import * as THREE from 'three';
import { GAME, MATERIALS, WORLD } from '../core/Constants.js';
import { createPieceMesh } from '../level/models.js';
import { G, quatZ } from '../systems/PhysicsWorld.js';
import { eventBus, Events } from '../core/EventBus.js';

let NEXT_ID = 1;

export class DebrisSystem {
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    this.items = [];
    this.group = new THREE.Group();
    this.group.name = 'debris';
    scene.add(this.group);
  }

  /**
   * @param {object} piece {type, length, broken, damage, parentId}
   * @param {{x,y,z}} pos centre
   * @param {number} angle rotation about Z
   */
  spawn(piece, pos, angle = 0, vel = { x: 0, y: 0, z: 0 }, spin = null) {
    const R = this.physics.RAPIER;
    const mt = MATERIALS[piece.type];
    const len = Math.max(0.3, piece.length);
    const body = this.physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation(quatZ(angle))
        .setLinvel(vel.x, vel.y, vel.z)
        .setAngvel(spin || { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 1, z: (Math.random() - 0.5) * 3 })
        .setLinearDamping(0.15)
        .setAngularDamping(0.4)
        .setCcdEnabled(true),
    );
    const mass = mt.mass * (len / mt.length);
    const hz = mt.kind === 'deck' ? mt.width / 2 : 1.12;
    const hy = mt.kind === 'deck' ? mt.thick / 2 : mt.thick / 2;
    this.physics.world.createCollider(
      R.ColliderDesc.cuboid(len / 2, Math.max(0.05, hy), hz)
        .setCollisionGroups(G.debris)
        .setMass(mass)
        .setFriction(0.7)
        .setRestitution(0.15),
      body,
    );
    const mesh = createPieceMesh(piece.type, len, { broken: piece.broken });
    this.group.add(mesh);
    const item = {
      id: NEXT_ID++, body, mesh, mass,
      piece: { ...piece, length: len },
      inWater: false, splashed: false, age: 0,
    };
    this.items.push(item);
    return item;
  }

  /** Spawn pieces from a solver 'snap' or 'cluster' event. */
  spawnFromSegment(type, x1, y1, x2, y2, vx, vy, extra = {}) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ang = Math.atan2(y2 - y1, x2 - x1);
    return this.spawn(
      { type, length: len, broken: !!extra.broken, damage: extra.damage || 0, parentId: extra.parentId ?? null },
      { x: (x1 + x2) / 2, y: (y1 + y2) / 2, z: 0 },
      ang,
      { x: vx, y: vy, z: (Math.random() - 0.5) * 0.6 },
    );
  }

  nearest(pos, radius) {
    let best = null;
    let bestD = radius;
    for (const it of this.items) {
      const t = it.body.translation();
      const d = Math.hypot(t.x - pos.x, (t.y - pos.y) * 0.6, t.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }
    return best;
  }

  remove(item) {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    this.group.remove(item.mesh);
    item.mesh.traverse((o) => o.geometry && o.geometry.dispose());
    if (this.physics.world) this.physics.world.removeRigidBody(item.body);
  }

  /** Physics forces — once per fixed step, before world.step(). */
  fixedUpdate(dt) {
    const W = GAME.WATER_Y;
    for (const it of [...this.items]) {
      const b = it.body;
      const p = b.translation();
      it.age += dt;
      if (p.y < -40 || Math.abs(p.z) > WORLD.Z_HALF + 5) {
        this.remove(it);
        continue;
      }
      const sub = Math.min(1, Math.max(0, (W + 0.12 - p.y) / 0.35));
      if (sub > 0) {
        if (!it.splashed) {
          it.splashed = true;
          const v = b.linvel();
          if (Math.abs(v.y) > 1.5) eventBus.emit(Events.SPLASH, { pos: { x: p.x, y: W, z: p.z }, big: it.mass > 20 && Math.abs(v.y) > 4 });
        }
        it.inWater = true;
        const v = b.linvel();
        const m = it.mass;
        b.applyImpulse({
          x: -v.x * m * 1.2 * sub * dt,
          y: (m * GAME.GRAVITY * 1.75 * sub - v.y * m * 2.2 * sub) * dt,
          z: (m * (-WORLD.CURRENT - v.z) * 0.9 * sub) * dt,
        }, true);
        const w = b.angvel();
        b.setAngvel({ x: w.x * (1 - 2 * dt), y: w.y * (1 - 2 * dt), z: w.z * (1 - 2 * dt) }, true);
      } else {
        it.inWater = false;
      }
    }
  }

  /** Visual sync — every render frame. */
  update() {
    for (const it of this.items) {
      const t = it.body.translation();
      const r = it.body.rotation();
      it.mesh.position.set(t.x, t.y, t.z);
      it.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  clear() {
    for (const it of [...this.items]) this.remove(it);
  }

  dispose() {
    this.clear();
    this.scene.remove(this.group);
  }
}
