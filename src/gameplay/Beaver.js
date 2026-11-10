// The player: a beaver builder. Rapier kinematic character controller for
// movement (walks on terrain and on the bridge deck), swimming, scrambling up
// banks, carrying, and procedural animation.

import * as THREE from 'three';
import { BEAVER, GAME, MATERIALS } from '../core/Constants.js';
import { createBeaver, woodMaterial } from '../level/models.js';
import { G } from '../systems/PhysicsWorld.js';
import { terrainHeight } from '../level/levels.js';
import { eventBus, Events } from '../core/EventBus.js';

const CENTER_TO_FEET = BEAVER.HALF_HEIGHT + BEAVER.RADIUS;

export class Beaver {
  constructor(scene, physics, particles) {
    this.scene = scene;
    this.physics = physics;
    this.particles = particles;
    this.model = createBeaver();
    this.model.root.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    scene.add(this.model.root);
    this.pos = new THREE.Vector3();
    // render interpolation between fixed physics steps (smooth on 120 Hz screens)
    this.prevPos = new THREE.Vector3();
    this.prevFacing = 0;
    this.renderPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.facing = 0; // yaw, 0 = +z
    this.grounded = false;
    this.swimming = false;
    this.climb = null;
    this.action = null; // { name, t, dur }
    this.carryMesh = null;
    this.carried = null;
    this.animPhase = 0;
    this.blinkT = 2;
    this.speed = 0;
    this.stepAcc = 0;
    this.lookTarget = null;
    this.mood = null; // 'celebrate' | 'dismay' (looping idle override)
    this.onDeck = false;
    this.groundMemberId = null;
    this.deckAt = null; // (x, z, feetY) => { y, memberId } | null — set by Game
    this.deckAbove = null; // (x, z) => { y } | null — highest deck surface at x — set by Game
    this.jumpTarget = null;
    this.level = null;
  }

  spawn(level, x, z) {
    this.level = level;
    const y = terrainHeight(level, x, z) + CENTER_TO_FEET + 0.05;
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.climb = null;
    this.action = null;
    this.mood = null;
    const R = this.physics.RAPIER;
    const world = this.physics.world;
    this.body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z));
    this.collider = world.createCollider(
      R.ColliderDesc.capsule(BEAVER.HALF_HEIGHT, BEAVER.RADIUS).setCollisionGroups(G.beaver),
      this.body,
    );
    this.kcc = world.createCharacterController(0.03);
    this.kcc.enableAutostep(0.38, 0.15, false);
    this.kcc.enableSnapToGround(0.4);
    this.kcc.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.kcc.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.kcc.setApplyImpulsesToDynamicBodies(false);
    this.facing = Math.PI / 2;
    this.prevPos.copy(this.pos);
    this.prevFacing = this.facing;
    this.interpolate(1);
    this.syncModel();
  }

  teleport(x, z, facing = null) {
    const y = terrainHeight(this.level, x, z) + CENTER_TO_FEET + 0.05;
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.climb = null;
    this.body.setTranslation({ x, y, z }, true);
    this.body.setNextKinematicTranslation({ x, y, z });
    if (facing !== null) this.facing = facing;
    this.prevPos.copy(this.pos);
    this.prevFacing = this.facing;
  }

  get feetY() {
    return this.pos.y - CENTER_TO_FEET;
  }

  chest(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.feetY + 0.9, this.pos.z);
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.facing), 0, Math.cos(this.facing));
  }

  get busy() {
    return !!this.action && this.action.lock;
  }

  // ---------------------------------------------------------------- control

  /**
   * @param {{x:number,y:number}} axis input (x right, y forward)
   * @param {THREE.Vector3} camFwd horizontal camera forward
   */
  fixedUpdate(dt, axis, { run = false, jump = false, enabled = true }, camFwd) {
    this.prevPos.copy(this.pos);
    this.prevFacing = this.facing;
    if (this.action) {
      this.action.t += dt;
      if (this.action.t >= this.action.dur) this.action = null;
    }
    if (this.climb) {
      this.updateClimb(dt);
      return;
    }
    const level = this.level;
    const depth = GAME.WATER_Y - terrainHeight(level, this.pos.x, this.pos.z);
    const wasSwimming = this.swimming;
    this.swimming = depth > 0.55 && this.feetY < GAME.WATER_Y - 0.3;
    if (this.swimming && !wasSwimming && this.vy < -2) {
      eventBus.emit(Events.SPLASH, { pos: { x: this.pos.x, y: GAME.WATER_Y, z: this.pos.z }, big: false });
    }

    // Leap out of the water onto the bridge deck (or scramble up a bank)
    this.jumpTarget = this.swimming && !this.busy ? this.findDeckJump() : null;
    if (this.swimming && jump && enabled && !this.busy) {
      if (this.jumpTarget) {
        this.startLeap(this.jumpTarget);
        return;
      }
      const f = this.forward();
      if (this.tryClimb(f.x, f.z)) {
        eventBus.emit(Events.JUMP);
        return;
      }
    }

    const right = { x: -camFwd.z, z: camFwd.x };
    let dx = 0;
    let dz = 0;
    if (enabled && !this.busy) {
      dx = right.x * axis.x + camFwd.x * axis.y;
      dz = right.z * axis.x + camFwd.z * axis.y;
    }
    const len = Math.hypot(dx, dz);
    let speed = run ? BEAVER.RUN_SPEED : BEAVER.WALK_SPEED;
    if (this.carried) speed *= BEAVER.CARRY_FACTOR[this.carried.broken ? 'broken' : this.carried.type] || 0.8;
    if (this.swimming) speed = BEAVER.SWIM_SPEED * (this.carried ? 0.85 : 1);
    const tx = len > 0.01 ? (dx / len) * speed * Math.min(1, len) : 0;
    const tz = len > 0.01 ? (dz / len) * speed * Math.min(1, len) : 0;
    const k = 1 - Math.exp(-BEAVER.ACCEL * dt);
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;
    if (len > 0.01) {
      const want = Math.atan2(dx, dz);
      let diff = want - this.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.facing += diff * Math.min(1, BEAVER.TURN_RATE * dt);
    }

    if (this.swimming) {
      const targetY = GAME.WATER_Y + 0.08;
      this.vy = (targetY - this.pos.y) * 5;
    } else {
      if (this.grounded && jump && enabled && !this.busy) {
        this.vy = BEAVER.JUMP_SPEED;
        this.grounded = false;
        eventBus.emit(Events.JUMP);
      }
      this.vy -= BEAVER.GRAVITY * dt;
      if (this.grounded && this.vy < 0) this.vy = -1;
    }

    // 1) Rapier controller: walls, terrain and props only. Plank colliders are
    //    kinematic and move every step, which makes the controller jam on their
    //    edges, so deck support is handled analytically below.
    const feetBefore = this.feetY;
    const wasOnDeck = this.onDeck;
    // No downward push while standing: a tiny downward component that touches
    // the ground makes the controller cancel the whole move for that step (a
    // visible hitch). Snap-to-ground keeps the beaver on slopes instead.
    const standing = (wasOnDeck || this.grounded) && this.vy <= 0 && !this.swimming;
    const desired = { x: this.vel.x * dt, y: standing ? 0 : this.vy * dt, z: this.vel.z * dt };
    if (wasOnDeck) this.kcc.disableSnapToGround();
    this.kcc.computeColliderMovement(this.collider, desired, undefined, G.qBeaverTerrain);
    if (wasOnDeck) this.kcc.enableSnapToGround(0.4);
    const mv = this.kcc.computedMovement();
    this.grounded = this.kcc.computedGrounded();
    // bumped head
    if (desired.y > 0 && mv.y < desired.y * 0.5) this.vy = Math.min(this.vy, 0);
    this.pos.x += mv.x;
    this.pos.y += mv.y;
    this.pos.z += mv.z;

    // 2) Bridge deck: stand on the exact plank surface (same one the ducklings use)
    this.onDeck = false;
    this.groundMemberId = null;
    if (!this.swimming && this.deckAt && this.vy <= 0.01) {
      const deck = this.deckAt(this.pos.x, this.pos.z, Math.max(feetBefore, this.feetY));
      if (deck) {
        const reach = wasOnDeck ? 0.45 : 0.04; // follow the deck down slopes/sag once on it
        if (this.feetY <= deck.y + reach && feetBefore >= deck.y - BEAVER.STEP_UP) {
          this.pos.y = deck.y + CENTER_TO_FEET;
          this.vy = 0;
          this.grounded = true;
          this.onDeck = true;
          this.groundMemberId = deck.memberId;
        }
      }
    }
    if (this.grounded && !this.onDeck && this.vy < -1) this.vy = -1;

    // safety: never sink through the terrain
    const floor = terrainHeight(level, this.pos.x, this.pos.z) + CENTER_TO_FEET - 0.05;
    if (this.pos.y < floor) {
      this.pos.y = floor;
      this.vy = Math.max(this.vy, 0);
    }
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    this.speed = Math.hypot(mv.x, mv.z) / dt;

    // Scramble up a bank when swimming into it
    if (this.swimming && len > 0.1 && Math.hypot(mv.x, mv.z) < Math.hypot(desired.x, desired.z) * 0.35) {
      this.tryClimb(dx / len, dz / len);
    }

    // Footsteps
    if (this.grounded && this.speed > 0.5) {
      this.stepAcc += this.speed * dt;
      if (this.stepAcc > (run ? 0.75 : 0.55)) {
        this.stepAcc = 0;
        eventBus.emit(Events.FOOTSTEP, { wood: this.onDeck, vol: run ? 1.2 : 0.8 });
        if (run && !this.onDeck) this.particles.dust({ x: this.pos.x, y: this.feetY + 0.05, z: this.pos.z }, 3);
      }
    }
    if (this.swimming && this.speed > 0.4 && Math.random() < 0.15) {
      this.particles.bubbles({ x: this.pos.x - Math.sin(this.facing) * 0.4, y: GAME.WATER_Y, z: this.pos.z - Math.cos(this.facing) * 0.4 });
    }
  }

  /** Nearest spot on the bridge deck the beaver can leap to from the water. */
  findDeckJump() {
    if (!this.deckAbove) return null;
    // right under the planks there's no room to leap — swim out to the side or the end
    if (this.deckAbove(this.pos.x, this.pos.z)) return null;
    const f = this.forward();
    let best = null;
    for (const d of [0, 0.5, 1.0, 1.5, 2.0]) {
      const x = this.pos.x + f.x * d;
      const z = Math.max(-0.75, Math.min(0.75, this.pos.z + f.z * d));
      if (Math.hypot(x - this.pos.x, z - this.pos.z) > BEAVER.LEAP_REACH) continue;
      const deck = this.deckAbove(x, z);
      if (!deck) continue;
      const rise = deck.y - this.feetY;
      if (rise < 0.2 || rise > BEAVER.LEAP_HEIGHT) continue;
      best = { x, z, y: deck.y };
      break;
    }
    return best;
  }

  startLeap(t) {
    const to = new THREE.Vector3(t.x, t.y + CENTER_TO_FEET + 0.02, t.z);
    const height = to.y - this.pos.y;
    this.climb = { t: 0, dur: 0.5 + Math.max(0, height) * 0.08, from: this.pos.clone(), to, height, leap: true };
    this.facing = Math.atan2(to.x - this.pos.x, to.z - this.pos.z) || this.facing;
    this.swimming = false;
    this.vel.set(0, 0, 0);
    this.particles.splash({ x: this.pos.x, y: GAME.WATER_Y, z: this.pos.z });
    eventBus.emit(Events.SPLASH, { pos: { x: this.pos.x, y: GAME.WATER_Y, z: this.pos.z }, big: false });
    eventBus.emit(Events.JUMP);
  }

  tryClimb(dirX, dirZ) {
    const level = this.level;
    for (let d = 0.6; d <= 3.0; d += 0.2) {
      const x = this.pos.x + dirX * d;
      const z = this.pos.z + dirZ * d;
      const h = terrainHeight(level, x, z);
      if (h < GAME.WATER_Y + 0.15) continue;
      const h2 = terrainHeight(level, x + dirX * 0.4, z + dirZ * 0.4);
      if (Math.abs(h2 - h) > 0.4) continue;
      const lx = x + dirX * 0.4;
      const lz = z + dirZ * 0.4;
      const ly = terrainHeight(level, lx, lz) + CENTER_TO_FEET + 0.05;
      const height = ly - this.pos.y;
      this.climb = {
        t: 0,
        dur: BEAVER.CLIMB_TIME + Math.max(0, height) * 0.12,
        from: this.pos.clone(),
        to: new THREE.Vector3(lx, ly, lz),
        height,
      };
      this.swimming = false;
      this.particles.splash({ x: this.pos.x, y: GAME.WATER_Y, z: this.pos.z });
      return true;
    }
    return false;
  }

  updateClimb(dt) {
    const c = this.climb;
    c.t += dt / c.dur;
    const k = Math.min(1, c.t);
    const e = k * k * (3 - 2 * k);
    this.pos.lerpVectors(c.from, c.to, e);
    this.pos.y += Math.sin(k * Math.PI) * (0.6 + Math.max(0, c.height) * 0.15);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    this.vel.set(0, 0, 0);
    this.vy = 0;
    if (k >= 1) {
      // the deck may have flexed a little during the leap: land exactly on it
      if (c.leap && this.deckAbove) {
        const deck = this.deckAbove(this.pos.x, this.pos.z);
        if (deck) this.pos.y = deck.y + CENTER_TO_FEET + 0.01;
      }
      this.climb = null;
      this.particles.dust({ x: this.pos.x, y: this.feetY, z: this.pos.z }, 6);
    }
  }

  /** Deck contact is resolved in fixedUpdate (groundMemberId); kept for API compatibility. */
  detectGround() {}

  // ---------------------------------------------------------------- carrying & actions

  setCarried(item) {
    this.carried = item;
    if (this.carryMesh) {
      this.model.carryAnchor.remove(this.carryMesh);
      this.carryMesh.geometry?.dispose();
      this.carryMesh = null;
    }
    if (!item) return;
    const mt = MATERIALS[item.type];
    const w = mt.kind === 'deck' ? 0.5 : mt.width;
    const h = mt.kind === 'deck' ? 0.09 : mt.thick;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(item.length, h, w), woodMaterial(item.broken ? 0x9c7a55 : mt.color));
    mesh.castShadow = true;
    mesh.position.set(0, 0.12, -0.05);
    mesh.rotation.z = 0.12;
    this.carryMesh = mesh;
    this.model.carryAnchor.add(mesh);
  }

  playAction(name, dur, lock = true) {
    this.action = { name, t: 0, dur, lock };
  }

  setMood(m) {
    this.mood = m;
  }

  // ---------------------------------------------------------------- animation

  /** Blend between the last two physics steps; alpha = fraction of a step since the last one. */
  interpolate(alpha) {
    this.renderPos.lerpVectors(this.prevPos, this.pos, alpha);
    let d = this.facing - this.prevFacing;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.renderFacing = this.prevFacing + d * alpha;
    return this.renderPos;
  }

  syncModel() {
    const r = this.model.root;
    r.position.set(this.renderPos.x, this.renderPos.y - CENTER_TO_FEET, this.renderPos.z);
    r.rotation.y = this.renderFacing ?? this.facing;
  }

  animate(dt, time) {
    this.syncModel();
    const M = this.model;
    const moving = this.speed > 0.3;
    const runFactor = Math.min(1, this.speed / BEAVER.RUN_SPEED);
    this.animPhase += dt * (moving ? 5 + this.speed * 2.2 : 0);
    const ph = this.animPhase;
    const swing = moving ? 0.55 + runFactor * 0.35 : 0;

    // defaults
    M.body.position.set(0, 0, 0);
    M.body.rotation.set(0, 0, 0);
    M.head.rotation.set(0, 0, 0);
    M.heldHammer.visible = false;
    M.beltHammer.visible = true;
    let armLx = 0;
    let armRx = 0;
    let armLz = 0.15;
    let armRz = -0.15;
    let legL = Math.sin(ph) * swing;
    let legR = -Math.sin(ph) * swing;
    let tail = Math.sin(time * 2) * 0.12;
    let tailYaw = Math.sin(time * 1.3) * 0.15;

    if (moving) {
      M.body.position.y = Math.abs(Math.sin(ph)) * 0.06;
      M.body.rotation.x = 0.08 + runFactor * 0.12;
      M.body.rotation.z = Math.sin(ph) * 0.05;
      armLx = -Math.sin(ph) * swing * 0.8;
      armRx = Math.sin(ph) * swing * 0.8;
      tail = Math.sin(ph * 2) * 0.12;
      tailYaw = Math.sin(ph) * 0.3;
    } else {
      M.body.position.y = Math.sin(time * 2.2) * 0.012;
      M.body.rotation.x = Math.sin(time * 2.2) * 0.015;
    }

    if (this.carried) {
      armLx = -2.75;
      armRx = -2.75;
      armLz = 0.35;
      armRz = -0.35;
      M.body.rotation.x += 0.08;
      if (this.carryMesh) this.carryMesh.rotation.z = 0.12 + Math.sin(ph) * (moving ? 0.05 : 0.01);
    }

    if (this.swimming) {
      M.body.rotation.x = 0.55;
      M.body.position.y = Math.sin(time * 3) * 0.04 - 0.1;
      tail = Math.sin(time * 9) * 0.5;
      tailYaw = 0;
      legL = Math.sin(time * 9) * 0.8;
      legR = -legL;
      if (!this.carried) {
        armLx = -1.2 + Math.sin(time * 9) * 0.6;
        armRx = -1.2 - Math.sin(time * 9) * 0.6;
      }
    } else if (!this.grounded && !this.climb) {
      legL = -0.6;
      legR = 0.3;
      if (!this.carried) {
        armLx = -2.2;
        armRx = -2.2;
        armLz = 0.6;
        armRz = -0.6;
      }
    }

    if (this.climb && this.climb.leap) {
      const k = Math.min(1, this.climb.t);
      M.body.rotation.x = -0.6 + k * 0.6;
      armLx = -2.9;
      armRx = -2.9;
      armLz = 0.5;
      armRz = -0.5;
      legL = 0.5;
      legR = 0.5;
      tail = -0.6 + Math.sin(k * Math.PI) * 0.9;
    } else if (this.climb) {
      const k = this.climb.t;
      M.body.rotation.x = -0.4 + k * 0.4;
      armLx = -2.8 + Math.sin(k * 20) * 0.6;
      armRx = -2.8 - Math.sin(k * 20) * 0.6;
      legL = Math.sin(k * 20) * 0.9;
      legR = -legL;
    }

    // mood loops (celebrate / dismay) when idle
    if (this.mood === 'celebrate' && !this.action) {
      const j = Math.abs(Math.sin(time * 5));
      M.body.position.y = j * 0.25;
      armLx = -2.9;
      armRx = -2.9;
      armLz = 0.5 + Math.sin(time * 10) * 0.25;
      armRz = -0.5 - Math.sin(time * 10) * 0.25;
      tail = Math.sin(time * 10) * 0.4;
      M.root.position.y += j * 0.25;
      M.head.rotation.z = Math.sin(time * 5) * 0.15;
    } else if (this.mood === 'dismay' && !this.action) {
      armLx = -2.6;
      armRx = -2.6;
      armLz = 0.9;
      armRz = -0.9;
      M.head.rotation.y = Math.sin(time * 6) * 0.35;
      M.body.rotation.x = 0.1;
    }

    // one-shot actions
    if (this.action) {
      const a = this.action;
      const k = Math.min(1, a.t / a.dur);
      if (a.name === 'hammer') {
        M.heldHammer.visible = true;
        M.beltHammer.visible = false;
        const strikes = 3;
        const s = Math.sin(k * Math.PI * strikes);
        armRx = -1.2 - Math.max(0, s) * 1.6;
        armRz = -0.2;
        armLx = -0.9;
        M.body.rotation.x = 0.25;
        M.head.rotation.x = 0.3;
      } else if (a.name === 'place') {
        const e = Math.sin(k * Math.PI);
        armLx = -1.6 - e * 0.4;
        armRx = -1.6 - e * 0.4;
        armLz = 0.2;
        armRz = -0.2;
        M.body.rotation.x = 0.2 + e * 0.25;
      } else if (a.name === 'pickup') {
        const e = Math.sin(k * Math.PI);
        M.body.position.y = -e * 0.18;
        M.body.rotation.x = e * 0.5;
        armLx = -0.6 - e * 0.8;
        armRx = -0.6 - e * 0.8;
      } else if (a.name === 'chomp') {
        M.head.rotation.x = 0.35 + Math.sin(k * Math.PI * 8) * 0.18;
        armLx = -1.3;
        armRx = -1.3;
      } else if (a.name === 'shrug') {
        armLz = 0.9;
        armRz = -0.9;
        armLx = -0.6;
        armRx = -0.6;
        M.head.rotation.z = Math.sin(k * Math.PI) * 0.3;
      }
    }

    M.armL.rotation.set(armLx, 0, armLz);
    M.armR.rotation.set(armRx, 0, armRz);
    M.legL.rotation.x = legL;
    M.legR.rotation.x = legR;
    M.tailPivot.rotation.set(tail - 0.1, tailYaw, 0);

    // look at target (e.g. placement preview)
    if (this.lookTarget && !this.mood) {
      const dx = this.lookTarget.x - this.pos.x;
      const dz = this.lookTarget.z - this.pos.z;
      const dy = this.lookTarget.y - (this.feetY + 1.06);
      let yaw = Math.atan2(dx, dz) - this.facing;
      while (yaw > Math.PI) yaw -= Math.PI * 2;
      while (yaw < -Math.PI) yaw += Math.PI * 2;
      M.head.rotation.y = THREE.MathUtils.clamp(yaw, -0.9, 0.9);
      M.head.rotation.x = THREE.MathUtils.clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.5, 0.6);
    }

    // blink
    this.blinkT -= dt;
    const blink = this.blinkT < 0.12 ? 0.15 : 1;
    if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 3;
    for (const e of M.eyes) e.group.scale.y = blink;
  }

  dispose() {
    this.scene.remove(this.model.root);
    if (this.physics.world && this.body) this.physics.world.removeRigidBody(this.body);
    if (this.physics.world && this.kcc) this.physics.world.removeCharacterController(this.kcc);
  }
}
