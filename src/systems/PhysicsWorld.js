// Thin Rapier wrapper: world lifecycle, collision groups, common queries.

import RAPIER from '@dimforge/rapier3d-compat';
import { GAME, GROUPS } from '../core/Constants.js';

export function groups(memberships, filter) {
  const m = memberships.reduce((acc, g) => acc | (1 << g), 0);
  const f = filter.reduce((acc, g) => acc | (1 << g), 0);
  return ((m & 0xffff) << 16) | (f & 0xffff);
}

const ALL = Object.values(GROUPS);

export const G = {
  terrain: groups([GROUPS.TERRAIN], ALL),
  deck: groups([GROUPS.DECK], [GROUPS.BEAVER, GROUPS.DEBRIS, GROUPS.CRITTER]),
  rail: groups([GROUPS.RAIL], [GROUPS.DEBRIS, GROUPS.CRITTER]),
  beaver: groups([GROUPS.BEAVER], [GROUPS.TERRAIN, GROUPS.DECK]),
  debris: groups([GROUPS.DEBRIS], [GROUPS.TERRAIN, GROUPS.DECK, GROUPS.RAIL, GROUPS.DEBRIS, GROUPS.CRITTER]),
  critter: groups([GROUPS.CRITTER], [GROUPS.TERRAIN, GROUPS.DECK, GROUPS.RAIL, GROUPS.DEBRIS]),
  // query filters
  qBeaverMove: groups([GROUPS.BEAVER], [GROUPS.TERRAIN, GROUPS.DECK]),
  qBeaverTerrain: groups([GROUPS.BEAVER], [GROUPS.TERRAIN]),
  qTerrain: groups(ALL, [GROUPS.TERRAIN]),
  qDeck: groups(ALL, [GROUPS.DECK]),
  qCamera: groups(ALL, [GROUPS.TERRAIN]),
};

let ready = null;
export function initRapier() {
  if (!ready) ready = RAPIER.init();
  return ready;
}

export class PhysicsWorld {
  constructor() {
    this.RAPIER = RAPIER;
    this.world = null;
  }

  create() {
    this.dispose();
    this.world = new RAPIER.World({ x: 0, y: -GAME.GRAVITY, z: 0 });
    this.world.timestep = GAME.FIXED_DT;
    return this.world;
  }

  dispose() {
    if (this.world) {
      this.world.free();
      this.world = null;
    }
  }

  step() {
    this.world.step();
  }

  addTrimesh(vertices, indices) {
    // FIX_INTERNAL_EDGES stops bodies catching on the seams between triangles
    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setCollisionGroups(G.terrain)
      .setFriction(0.9);
    return this.world.createCollider(desc);
  }

  addStaticBox(x, y, z, hx, hy, hz, rotY = 0) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation(quatY(rotY)),
    );
    return this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setCollisionGroups(G.terrain).setFriction(0.9),
      body,
    );
  }

  addStaticCylinder(x, y, z, halfH, r) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    return this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(halfH, r).setCollisionGroups(G.terrain).setFriction(0.9),
      body,
    );
  }

  /** Cast a ray; returns {point, collider, toi} or null. */
  raycast(origin, dir, maxToi, filterGroups, excludeCollider) {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRay(ray, maxToi, true, undefined, filterGroups, excludeCollider);
    if (!hit) return null;
    const p = ray.pointAt(hit.timeOfImpact);
    return { point: p, collider: hit.collider, toi: hit.timeOfImpact };
  }
}

export function quatZ(angle) {
  const h = angle / 2;
  return { x: 0, y: 0, z: Math.sin(h), w: Math.cos(h) };
}

export function quatY(angle) {
  const h = angle / 2;
  return { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
}
