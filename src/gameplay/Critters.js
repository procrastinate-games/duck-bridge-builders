// Ducklings and the hippo inspector. They walk the actual bridge (WalkSurface),
// load it through the solver, and fall into the river (Rapier) when it fails.

import * as THREE from 'three';
import { DUCKS, HIPPO, GAME, COLORS } from '../core/Constants.js';
import { createDuckling, createHippo } from '../level/models.js';
import { findSurface } from './WalkSurface.js';
import { terrainHeight } from '../level/levels.js';
import { G } from '../systems/PhysicsWorld.js';
import { eventBus, Events } from '../core/EventBus.js';

const UP = new THREE.Vector3(0, 1, 0);

class Walker {
  constructor(ctx) {
    this.ctx = ctx; // { scene, physics, solver, level, particles }
    this.state = 'queue';
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.vy = 0;
    this.body = null;
    this.t = 0;
    this.stateT = 0;
    this.swimTarget = null;
    this.yaw = Math.PI / 2;
    this.fallReason = null;
  }

  setState(s) {
    this.state = s;
    this.stateT = 0;
  }

  /** Remember the last physics-step position for render interpolation. */
  savePrev() {
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
  }

  renderXYZ(alpha = 1) {
    if (this.px === undefined) this.savePrev();
    return [this.px + (this.x - this.px) * alpha, this.py + (this.y - this.py) * alpha, this.pz + (this.z - this.pz) * alpha];
  }

  startFall(vx, vy, radius, mass, reason) {
    const R = this.ctx.physics.RAPIER;
    this.fallReason = reason;
    this.body = this.ctx.physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(this.x, this.y + radius, this.z)
        .setLinvel(vx, vy, 0)
        .setAngvel({ x: 0, y: 0, z: -2 })
        .setCcdEnabled(true),
    );
    this.ctx.physics.world.createCollider(
      R.ColliderDesc.ball(radius).setCollisionGroups(G.critter).setMass(mass).setRestitution(0.2).setFriction(0.15),
      this.body,
    );
    this.radius = radius;
    this.setState('fall');
  }

  removeBody() {
    if (this.body && this.ctx.physics.world) this.ctx.physics.world.removeRigidBody(this.body);
    this.body = null;
  }

  /** While falling: watch for water or resting on ground. */
  updateFall(dt, bigSplash) {
    const p = this.body.translation();
    const v = this.body.linvel();
    this.x = p.x;
    this.y = p.y - this.radius;
    this.z = p.z;
    if (p.y < GAME.WATER_Y + this.radius * 0.3) {
      this.removeBody();
      this.y = GAME.WATER_Y - this.radius * 0.6;
      eventBus.emit(Events.SPLASH, { pos: { x: this.x, y: GAME.WATER_Y, z: this.z }, big: bigSplash });
      this.ctx.particles.splash({ x: this.x, y: GAME.WATER_Y, z: this.z }, bigSplash);
      this.setState('swim');
      return 'splash';
    }
    if (this.stateT > 1.2 && Math.hypot(v.x, v.y, v.z) < 0.3) {
      this.removeBody();
      this.setState('dazed');
      return 'landed';
    }
    if (p.y < -30) {
      this.removeBody();
      this.setState('dazed');
    }
    return null;
  }

  dispose() {
    this.removeBody();
    if (this.model) this.ctx.scene.remove(this.model.root);
  }
}

// ------------------------------------------------------------------ duckling

export class Duckling extends Walker {
  constructor(ctx, index) {
    super(ctx);
    this.index = index;
    const tint = new THREE.Color(COLORS.DUCK).offsetHSL((Math.random() - 0.5) * 0.03, 0, (Math.random() - 0.5) * 0.06).getHex();
    this.model = createDuckling(tint);
    this.model.root.scale.setScalar(1.25);
    ctx.scene.add(this.model.root);
    this.quackT = 1 + Math.random() * 4;
    this.phase = Math.random() * 6;
    this.hesitated = false;
    this.lane = (Math.random() - 0.5) * 0.5;
    this.bubble = null;
    this.speedMul = 0.92 + Math.random() * 0.16;
    this.wobbleT = 0;
  }

  place(x, z) {
    this.x = x;
    this.z = z;
    this.y = terrainHeight(this.ctx.level, x, z);
    this.savePrev();
  }

  quack(force = false) {
    eventBus.emit(Events.QUACK, { pitch: 1.1 + (this.index % 4) * 0.08, force });
    this.quackAnim = 0.2;
  }

  /** Fixed-step logic. Returns an event string or null. */
  fixedUpdate(dt, leader) {
    const { solver, level } = this.ctx;
    this.savePrev();
    this.t += dt;
    this.stateT += dt;
    this.quackT -= dt;
    if (this.quackT <= 0) {
      if (this.state === 'walk' || this.state === 'arrived' || this.state === 'queue' || this.state === 'wet') this.quack();
      this.quackT = 2.5 + Math.random() * 5;
    }
    const g = level.gap / 2;
    switch (this.state) {
      case 'queue': {
        const canGo = !leader || leader.state === 'arrived' || leader.state === 'gather' || leader.x - this.x >= DUCKS.SPACING;
        if (this.go && canGo) this.setState('walk');
        return null;
      }
      case 'walk':
      case 'hesitate': {
        const speed = DUCKS.SPEED * this.speedMul;
        if (this.state === 'hesitate') {
          if (this.stateT > DUCKS.HESITATE_TIME) {
            // brave little hop forward…
            const surf = findSurface(solver, level, this.x + 0.4, this.y, DUCKS.STEP_UP, DUCKS.MAX_DROP);
            this.setState('walk');
            if (!surf.supported || (surf.member && Math.abs(surf.slope) > DUCKS.MAX_SLOPE)) {
              this.startFall(speed, 1.5, 0.2, DUCKS.MASS, surf.water || !surf.supported ? 'gap' : 'steep');
              this.quack(true);
              return 'fell';
            }
          } else {
            this.loadCurrent(solver, level);
            return null;
          }
        }
        // keep spacing
        if (leader && leader.state === 'walk' && leader.x - this.x < DUCKS.SPACING * 0.8) {
          this.loadCurrent(solver, level);
          return null;
        }
        const here = findSurface(solver, level, this.x, this.y + 0.05, DUCKS.STEP_UP, DUCKS.MAX_DROP);
        if (!here.supported) {
          // the bridge dropped away under us
          this.startFall(0, 0, 0.2, DUCKS.MASS, 'collapse');
          this.quack(true);
          return 'fell';
        }
        // wobble when the deck moves a lot
        if (here.member) {
          const a = solver.nodes.get(here.member.a);
          const b = solver.nodes.get(here.member.b);
          const motion = Math.abs(a.vy) + Math.abs(b.vy);
          if (motion > 0.7 && this.wobbleT <= 0) this.wobbleT = 0.5;
        }
        this.wobbleT -= dt;
        const look = findSurface(solver, level, this.x + 0.35, this.y, DUCKS.STEP_UP, DUCKS.MAX_DROP);
        const lookBad = !look.supported || (look.member && Math.abs(look.slope) > DUCKS.MAX_SLOPE);
        if (lookBad && !this.hesitated) {
          this.hesitated = true;
          this.setState('hesitate');
          this.quack(true);
          eventBus.emit(Events.WALKER_HESITATE, { who: 'duck', x: this.x });
          this.loadCurrent(solver, level);
          return null;
        }
        const stepSpeed = this.wobbleT > 0 ? speed * 0.3 : speed;
        const nx = this.x + stepSpeed * dt;
        const surf = findSurface(solver, level, nx, this.y + 0.05, DUCKS.STEP_UP, DUCKS.MAX_DROP);
        if (!surf.supported || (surf.member && Math.abs(surf.slope) > DUCKS.MAX_SLOPE)) {
          this.startFall(speed, 1, 0.2, DUCKS.MASS, surf.supported ? 'steep' : 'gap');
          this.quack(true);
          return 'fell';
        }
        this.x = nx;
        this.y += (surf.y - this.y) * Math.min(1, dt * 18);
        this.z += (this.lane - this.z) * Math.min(1, dt * 2);
        if (surf.member) solver.addPointLoad(surf.member.id, surf.t, DUCKS.MASS, 0, 'duck');
        this.yaw = Math.PI / 2;
        if (this.x > g + 1.6) {
          this.setState('arrived');
          this.target = this.ctx.nest
            ? new THREE.Vector3(this.ctx.nest.x + Math.cos(this.index * 0.63) * 1.4, 0, this.ctx.nest.z + Math.sin(this.index * 0.63) * 1.4)
            : new THREE.Vector3(g + 4, 0, 0);
          return 'rescued';
        }
        return null;
      }
      case 'arrived': {
        // waddle to the meadow / nest
        if (this.target) {
          const dx = this.target.x - this.x;
          const dz = this.target.z - this.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.1) {
            const s = Math.min(d, DUCKS.SPEED * dt);
            this.x += (dx / d) * s;
            this.z += (dz / d) * s;
            this.yaw = Math.atan2(dx, dz);
          } else {
            this.target = null;
            this.yaw = -Math.PI / 2 + (Math.random() - 0.5);
          }
          // still on the bridge? keep loading it
          const surf = findSurface(solver, level, this.x, this.y + 0.05, DUCKS.STEP_UP, 2);
          this.y = surf.y > -Infinity ? surf.y : this.y;
          if (surf.member) solver.addPointLoad(surf.member.id, surf.t, DUCKS.MASS, 0, 'duck');
        }
        return null;
      }
      case 'fall':
        return this.updateFall(dt, false);
      case 'swim': {
        // paddle back to the starting bank
        const bankX = -g - 0.3;
        const dir = Math.sign(bankX - this.x) || -1;
        this.x += dir * 0.9 * dt;
        this.z += (this.lane + 2.5 - this.z) * dt * 0.5;
        this.y = GAME.WATER_Y - 0.12 + Math.sin(this.t * 6) * 0.03;
        this.yaw = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        if (Math.random() < 0.05) this.ctx.particles.bubbles({ x: this.x, y: GAME.WATER_Y, z: this.z });
        if ((dir < 0 && this.x <= bankX) || (dir > 0 && this.x >= bankX) || this.stateT > 14) {
          this.hopTo(-g - 1.5 - Math.random() * 1.5, 2.5 + Math.random() * 1.5);
        }
        return null;
      }
      case 'dazed': {
        if (this.stateT > 1.5) this.hopTo(-g - 1.5 - Math.random() * 1.5, 2.5 + Math.random() * 1.5);
        return null;
      }
      case 'hop': {
        const k = Math.min(1, this.stateT / 0.7);
        this.x = this.hop.fx + (this.hop.tx - this.hop.fx) * k;
        this.z = this.hop.fz + (this.hop.tz - this.hop.fz) * k;
        this.y = this.hop.fy + (this.hop.ty - this.hop.fy) * k + Math.sin(k * Math.PI) * (1 + Math.max(0, this.hop.ty - this.hop.fy) * 0.3);
        if (k >= 1) {
          this.setState('wet');
          this.ctx.particles.splash({ x: this.x, y: this.y + 0.1, z: this.z });
        }
        return null;
      }
      default:
        return null;
    }
  }

  loadCurrent(solver, level) {
    const surf = findSurface(solver, level, this.x, this.y + 0.05, DUCKS.STEP_UP, DUCKS.MAX_DROP);
    if (surf.member) solver.addPointLoad(surf.member.id, surf.t, DUCKS.MASS, 0, 'duck');
  }

  hopTo(x, z) {
    this.hop = { fx: this.x, fy: this.y, fz: this.z, tx: x, tz: z, ty: terrainHeight(this.ctx.level, x, z) };
    this.setState('hop');
    this.quack(true);
  }

  animate(dt, time, { dance = false, alpha = 1 } = {}) {
    const M = this.model;
    M.root.position.set(...this.renderXYZ(alpha));
    if (this.state === 'fall' && this.body) {
      const r = this.body.rotation();
      M.root.quaternion.set(r.x, r.y, r.z, r.w);
      M.wingL.rotation.z = Math.sin(time * 40) * 0.9 - 0.5;
      M.wingR.rotation.z = -M.wingL.rotation.z;
      return;
    }
    M.root.rotation.set(0, this.yaw, 0);
    this.phase += dt * (this.state === 'walk' ? 12 : 4);
    const walking = this.state === 'walk' || (this.state === 'arrived' && this.target);
    M.body.rotation.z = walking ? Math.sin(this.phase) * 0.18 : 0;
    M.body.position.y = walking ? Math.abs(Math.sin(this.phase)) * 0.03 : 0;
    M.footL.rotation.x = walking ? Math.sin(this.phase) * 0.6 : 0;
    M.footR.rotation.x = walking ? -Math.sin(this.phase) * 0.6 : 0;
    M.wingL.rotation.z = 0.1;
    M.wingR.rotation.z = -0.1;
    M.head.rotation.set(0, 0, 0);
    if (this.state === 'hesitate') {
      M.head.rotation.x = 0.6; // look down
      M.head.rotation.z = Math.sin(time * 3) * 0.2;
      M.wingL.rotation.z = 0.5 + Math.sin(time * 20) * 0.3;
      M.wingR.rotation.z = -M.wingL.rotation.z;
    }
    if (this.wobbleT > 0 && this.state === 'walk') {
      M.body.rotation.z = Math.sin(time * 30) * 0.35;
      M.wingL.rotation.z = 0.9;
      M.wingR.rotation.z = -0.9;
    }
    if (this.state === 'swim') {
      M.body.rotation.z = Math.sin(time * 4) * 0.1;
      M.footL.rotation.x = Math.sin(time * 14) * 0.8;
      M.footR.rotation.x = -M.footL.rotation.x;
    }
    if (this.state === 'wet' || this.state === 'dazed') {
      // shake off water
      const shake = this.stateT < 1.2 ? Math.sin(time * 40) * 0.25 * (1.2 - this.stateT) : 0;
      M.body.rotation.y = shake;
      M.head.rotation.z = Math.sin(time * 2) * 0.15;
      if (this.stateT < 1 && Math.random() < 0.2) this.ctx.particles.sweat({ x: this.x, y: this.y + 0.4, z: this.z });
    }
    if (dance && (this.state === 'arrived' || this.state === 'wet')) {
      const j = Math.abs(Math.sin(time * 6 + this.index));
      M.root.position.y += j * 0.25;
      M.root.rotation.y = this.yaw + Math.sin(time * 3 + this.index) * 0.8;
      M.wingL.rotation.z = 0.4 + j * 0.8;
      M.wingR.rotation.z = -M.wingL.rotation.z;
    }
    if (this.quackAnim > 0) {
      this.quackAnim -= dt;
      M.beakBottom.position.y = -0.055;
      M.head.scale.setScalar(1.08);
    } else {
      M.beakBottom.position.y = -0.035;
      M.head.scale.setScalar(1);
    }
  }
}

// ------------------------------------------------------------------ hippo

export class Hippo extends Walker {
  constructor(ctx, mass) {
    super(ctx);
    this.mass = mass;
    this.model = createHippo();
    ctx.scene.add(this.model.root);
    this.phase = 0;
    this.hesitations = 0;
    this.stepCount = 0;
    this.pitch = 0;
    this.lastStepSide = -1;
    this.nervous = 0;
  }

  place(x) {
    this.x = x;
    this.z = 0;
    this.y = terrainHeight(this.ctx.level, x, 0);
    this.savePrev();
  }

  legXs() {
    return [this.x + HIPPO.LEG_SPREAD, this.x - HIPPO.LEG_SPREAD];
  }

  fixedUpdate(dt) {
    const { solver, level } = this.ctx;
    this.savePrev();
    this.t += dt;
    this.stateT += dt;
    const g = level.gap / 2;
    switch (this.state) {
      case 'enter': {
        const stopX = -g - HIPPO.LEG_SPREAD - 0.9;
        if (this.x < stopX) {
          return this.walkStep(dt, HIPPO.SPEED * 1.3, false);
        }
        this.setState('inspect');
        eventBus.emit(Events.HIPPO_ARRIVE, { x: this.x });
        return 'inspect';
      }
      case 'inspect':
        this.loadLegs(0);
        if (this.stateT > HIPPO.INSPECT_TIME) {
          this.setState('cautious');
          return 'cautious';
        }
        return null;
      case 'cautious':
        this.loadLegs(0);
        if (this.stateT > 1.0) {
          this.setState('cross');
          return 'crossing';
        }
        return null;
      case 'cross': {
        // hesitate when the bridge is groaning
        const stress = solver.maxStress();
        this.nervous += ((stress > 0.55 ? 1 : 0) - this.nervous) * dt * 2;
        if (stress > HIPPO.HESITATE_STRESS && this.hesitations < HIPPO.MAX_HESITATIONS && this.stateT > 1.2) {
          this.hesitations++;
          this.setState('hesitate');
          eventBus.emit(Events.WALKER_HESITATE, { who: 'hippo', x: this.x });
          return 'hesitate';
        }
        const r = this.walkStep(dt, HIPPO.SPEED, true);
        if (r) return r;
        if (this.x - HIPPO.LEG_SPREAD > g + 1.0) {
          this.setState('arrived');
          return 'crossed';
        }
        return null;
      }
      case 'hesitate': {
        const r = this.loadLegs(0);
        if (r) return r;
        if (this.stateT > 1.4) this.setState('cross');
        return null;
      }
      case 'arrived': {
        const tx = g + 4.2;
        if (this.x < tx) this.walkStep(dt, HIPPO.SPEED, false);
        return null;
      }
      case 'fall':
        return this.updateFall(dt, true);
      case 'swim': {
        const bankX = -g - 0.6;
        const dir = Math.sign(bankX - this.x) || -1;
        this.x += dir * 0.7 * dt;
        this.z += (3.2 - this.z) * dt * 0.4;
        this.y = GAME.WATER_Y - 1.0 + Math.sin(this.t * 2) * 0.06;
        this.yaw = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        if (Math.random() < 0.08) this.ctx.particles.bubbles({ x: this.x + (Math.random() - 0.5), y: GAME.WATER_Y, z: this.z });
        if ((dir < 0 && this.x <= bankX) || (dir > 0 && this.x >= bankX) || this.stateT > 18) {
          this.hop = { fx: this.x, fy: this.y, fz: this.z, tx: -g - 3.5, tz: 4, ty: terrainHeight(level, -g - 3.5, 4) };
          this.setState('hop');
        }
        return null;
      }
      case 'dazed':
        if (this.stateT > 2) {
          this.hop = { fx: this.x, fy: this.y, fz: this.z, tx: -g - 3.5, tz: 4, ty: terrainHeight(level, -g - 3.5, 4) };
          this.setState('hop');
        }
        return null;
      case 'hop': {
        const k = Math.min(1, this.stateT / 1.1);
        this.x = this.hop.fx + (this.hop.tx - this.hop.fx) * k;
        this.z = this.hop.fz + (this.hop.tz - this.hop.fz) * k;
        this.y = this.hop.fy + (this.hop.ty - this.hop.fy) * k + Math.sin(k * Math.PI) * (1.2 + Math.max(0, this.hop.ty - this.hop.fy) * 0.3);
        if (k >= 1) {
          this.setState('wet');
          this.ctx.particles.splash({ x: this.x, y: this.y + 0.3, z: this.z }, false);
          eventBus.emit(Events.HIPPO_STEP);
        }
        return null;
      }
      default:
        return null;
    }
  }

  /** Apply leg loads at the current position. Returns 'fell' if unsupported. */
  loadLegs(impactFrac) {
    const { solver, level } = this.ctx;
    const legs = this.legXs();
    const ys = [];
    for (let k = 0; k < 2; k++) {
      const surf = findSurface(solver, level, legs[k], this.y + 0.1, HIPPO.STEP_UP, HIPPO.MAX_DROP);
      if (!surf.supported) {
        this.startFall(k === 0 ? 2.6 : -1.6, 0.5, 1.0, this.mass, surf.water ? 'gap' : 'collapse');
        return 'fell';
      }
      ys.push(surf.y);
      const stepping = k === this.lastStepSide;
      const extra = stepping ? -(this.mass / 2) * GAME.GRAVITY * impactFrac : 0;
      if (surf.member) solver.addPointLoad(surf.member.id, surf.t, this.mass / 2, extra, 'hippo');
    }
    const targetY = (ys[0] + ys[1]) / 2;
    this.y += (targetY - this.y) * 0.25;
    this.pitch = Math.atan2(ys[0] - ys[1], HIPPO.LEG_SPREAD * 2);
    return null;
  }

  walkStep(dt, speed, onBridge) {
    const before = Math.floor(this.phase * 2);
    this.phase += dt / HIPPO.STEP_PERIOD;
    const after = Math.floor(this.phase * 2);
    const half = (this.phase * 2) % 1;
    this.lastStepSide = after % 2;
    if (after !== before) {
      this.stepCount++;
      eventBus.emit(Events.HIPPO_STEP, { x: this.x });
      this.ctx.particles.dust({ x: this.x + (this.lastStepSide === 0 ? 0.8 : -0.8), y: this.y + 0.05, z: 0.55 * (this.stepCount % 2 ? 1 : -1) }, 6);
    }
    const impact = Math.max(0, Math.sin(half * Math.PI)) * HIPPO.STEP_IMPACT;
    this.x += speed * dt;
    this.yaw = Math.PI / 2;
    return this.loadLegs(onBridge ? impact : 0);
  }

  animate(dt, time, { dance = false, alpha = 1 } = {}) {
    const M = this.model;
    M.root.position.set(...this.renderXYZ(alpha));
    if (this.state === 'fall' && this.body) {
      const r = this.body.rotation();
      M.root.quaternion.set(r.x, r.y, r.z, r.w);
      M.root.rotateY(Math.PI / 2);
      M.root.position.y -= 1.0;
      for (const l of M.legs) l.rotation.x = Math.sin(time * 20) * 0.8;
      M.eyes.forEach((e) => e.group.scale.setScalar(1.4));
      return;
    }
    M.eyes.forEach((e) => e.group.scale.setScalar(1));
    M.root.rotation.set(0, this.yaw, 0);
    M.root.rotateX(-this.pitch);
    const walking = ['enter', 'cross', 'arrived'].includes(this.state) && !(this.state === 'arrived' && this.x >= this.ctx.level.gap / 2 + 4.1);
    const ph = this.phase * Math.PI * 2;
    M.body.position.y = walking ? Math.abs(Math.sin(ph)) * 0.06 : Math.sin(time * 1.5) * 0.02;
    M.body.rotation.z = walking ? Math.sin(ph) * 0.06 : 0;
    M.legs.forEach((l, i) => {
      const side = i % 2 === 0 ? 1 : -1;
      const front = i < 2 ? 1 : -1;
      l.rotation.x = walking ? Math.sin(ph + (side * front > 0 ? 0 : Math.PI)) * 0.35 : 0;
      l.position.y = 0.6;
    });
    M.head.rotation.set(0, 0, 0);
    M.brows.forEach((b) => (b.rotation.z = 0));
    M.mouth.scale.set(1, 1, 1);
    M.tail.rotation.x = Math.sin(time * 6) * 0.3;
    if (this.state === 'inspect') {
      // examine the construction: look down, tilt head, hmm
      const k = this.stateT;
      M.head.rotation.x = 0.35 + Math.sin(k * 1.5) * 0.08;
      M.head.rotation.z = Math.sin(k * 2.2) * 0.2;
      M.head.rotation.y = Math.sin(k * 1.4) * 0.3;
      M.brows[0].rotation.z = 0.25;
      M.brows[1].rotation.z = -0.25;
    } else if (this.state === 'cautious') {
      // raise one front foot
      const k = Math.min(1, this.stateT / 0.5);
      M.legs[0].position.y = 0.6 + Math.sin(k * Math.PI * 0.5) * 0.35;
      M.legs[0].rotation.x = -0.6 * k;
      M.head.rotation.x = 0.4;
    } else if (this.state === 'hesitate') {
      M.head.rotation.x = 0.55;
      M.head.rotation.y = Math.sin(time * 4) * 0.4;
      M.brows[0].rotation.z = -0.35;
      M.brows[1].rotation.z = 0.35;
      M.mouth.scale.set(0.6, 0.6, 1);
      M.legs[1].position.y = 0.6 + Math.max(0, Math.sin(time * 5)) * 0.2;
      if (Math.random() < 0.08) this.ctx.particles.sweat({ x: this.x + 0.6, y: this.y + 2.3, z: 0.4 });
    } else if (this.nervous > 0.5 && this.state === 'cross') {
      M.brows[0].rotation.z = -0.2;
      M.brows[1].rotation.z = 0.2;
      if (Math.random() < 0.03) this.ctx.particles.sweat({ x: this.x + 0.6, y: this.y + 2.3, z: 0.4 });
    }
    if (this.state === 'swim') {
      M.body.rotation.z = Math.sin(time * 2) * 0.06;
      M.head.rotation.x = -0.25;
      M.legs.forEach((l, i) => (l.rotation.x = Math.sin(time * 6 + i) * 0.7));
    }
    if (this.state === 'wet' || this.state === 'dazed') {
      M.head.rotation.z = Math.sin(time * 2) * 0.12;
      M.mouth.scale.set(1.2, 1.4, 1);
    }
    if (dance && (this.state === 'arrived' || this.state === 'wet')) {
      const j = Math.abs(Math.sin(time * 4));
      M.root.position.y += j * 0.35;
      M.head.rotation.z = Math.sin(time * 4) * 0.25;
      M.legs[0].position.y = 0.6 + j * 0.3;
      M.legs[1].position.y = 0.6 + (1 - j) * 0.3;
      M.mouth.scale.set(1.3, 1.6, 1);
    }
  }
}
