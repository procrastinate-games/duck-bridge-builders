// The bridge test: countdown → duckling parade → hippo inspector → result.
// Nothing here touches the structure except through walker loads.

import * as THREE from 'three';
import { DUCKS, INSPECTION, HIPPO } from '../core/Constants.js';
import { gameState } from '../core/GameState.js';
import { eventBus, Events } from '../core/EventBus.js';
import { Duckling, Hippo } from './Critters.js';
import { terrainHeight } from '../level/levels.js';

export class Inspection {
  constructor(ctx) {
    this.ctx = ctx; // { scene, physics, solver, level, particles, cameraRig, nest }
    this.ducks = [];
    this.hippo = null;
    this.phase = 'idle';
    this.t = 0;
    this.result = null;
    this.firstFailure = null;
    this.structEvents = [];
    this.camTarget = new THREE.Vector3();
  }

  get active() {
    return this.phase !== 'idle' && this.phase !== 'done';
  }

  start() {
    this.clear();
    const { level } = this.ctx;
    const g = level.gap / 2;
    for (let i = 0; i < DUCKS.COUNT; i++) {
      const d = new Duckling(this.ctx, i);
      d.place(-g - 1.6 - i * DUCKS.QUEUE_GAP, d.lane);
      d.yaw = Math.PI / 2;
      this.ducks.push(d);
    }
    this.phase = 'countdown';
    this.t = 0;
    this.count = INSPECTION.COUNTDOWN;
    this.result = null;
    this.firstFailure = null;
    this.structEvents = [];
    this.maxStress = 0;
    this.rescued = 0;
    gameState.ducksRescued = 0;
    gameState.hippoResult = null;
    this.setCam(0, level, 'overview');
    eventBus.emit(Events.TEST_COUNTDOWN, this.count);
    eventBus.emit(Events.TEST_PHASE, 'countdown');
  }

  clear() {
    for (const d of this.ducks) d.dispose();
    this.ducks = [];
    if (this.hippo) this.hippo.dispose();
    this.hippo = null;
    this.phase = 'idle';
  }

  /** Remember structural failures that happen during the test (for the report). */
  noteStructural(ev) {
    if (!this.active) return;
    this.structEvents.push({ ...ev, phase: this.phase, t: this.t });
  }

  setCam(dt, level, mode, focusX = 0) {
    const g = level.gap / 2;
    const deckY = Math.max(level.bankL, level.bankR);
    const rig = this.ctx.cameraRig;
    if (mode === 'overview') {
      this.camTarget.set(0, deckY - 0.5, 0);
      rig.setCinematic({ target: this.camTarget, distance: level.gap * 1.05 + 9, yaw: 0.18, pitch: 0.28, lerp: 1.6 });
    } else if (mode === 'ducks') {
      this.camTarget.set(THREE.MathUtils.clamp(focusX * 0.55, -g, g), deckY - 0.2, 0);
      rig.setCinematic({ target: this.camTarget, distance: level.gap * 0.75 + 8, yaw: 0.28, pitch: 0.22, lerp: 1.2 });
    } else if (mode === 'hippoIntro') {
      this.camTarget.set(focusX + 2, deckY + 1.0, 0);
      rig.setCinematic({ target: this.camTarget, distance: 15, yaw: 0.55, pitch: 0.2, lerp: 1.0 });
    } else if (mode === 'hippo') {
      this.camTarget.set(THREE.MathUtils.clamp(focusX, -g - 2, g + 2), deckY, 0);
      rig.setCinematic({ target: this.camTarget, distance: level.gap * 0.6 + 11, yaw: 0.3, pitch: 0.24, lerp: 1.4 });
    } else if (mode === 'celebrate') {
      this.camTarget.set(g + 3, deckY + 0.8, 0);
      rig.setCinematic({ target: this.camTarget, distance: 12, yaw: 0.35, pitch: 0.25, lerp: 1.2 });
    }
  }

  fixedUpdate(dt) {
    if (!this.active) return;
    const { level, solver } = this.ctx;
    this.t += dt;
    this.maxStress = Math.max(this.maxStress, solver.maxStress());

    // fallen critters lying on the deck still weigh on it
    for (const w of [...this.ducks, this.hippo]) {
      if (!w || !w.body) continue;
      const p = w.body.translation();
      const hit = this.ctx.physics.raycast({ x: p.x, y: p.y, z: p.z }, { x: 0, y: -1, z: 0 }, w.radius + 0.25, this.ctx.deckFilter);
      if (!hit) continue;
      const mid = this.ctx.bridge.memberForCollider(hit.collider.handle);
      const m = mid != null && solver.members.get(mid);
      if (!m) continue;
      const a = solver.nodes.get(m.a);
      const b = solver.nodes.get(m.b);
      const t = Math.abs(b.x - a.x) > 0.05 ? (p.x - a.x) / (b.x - a.x) : 0.5;
      solver.addPointLoad(m.id, t, w === this.hippo ? this.hippo.mass : DUCKS.MASS, 0, w === this.hippo ? 'hippo' : 'duck');
    }

    // walkers
    let leader = null;
    for (const d of this.ducks) {
      const ev = d.fixedUpdate(dt, leader);
      leader = d;
      if (ev === 'rescued') {
        this.rescued++;
        gameState.ducksRescued = this.rescued;
        d.quack(true);
        eventBus.emit(Events.DUCK_RESCUED, this.rescued);
      } else if (ev === 'fell') {
        this.onFall('duck', d);
      }
    }
    if (this.hippo) {
      const ev = this.hippo.fixedUpdate(dt);
      if (ev === 'fell') this.onFall('hippo', this.hippo);
      else if (ev === 'crossed') this.onHippoCrossed();
      else if (ev === 'inspect') eventBus.emit(Events.TEST_PHASE, 'hippoInspect');
      else if (ev === 'crossing') eventBus.emit(Events.TEST_PHASE, 'hippoCross');
    }

    switch (this.phase) {
      case 'countdown': {
        const remaining = INSPECTION.COUNTDOWN - this.t;
        const c = Math.ceil(remaining);
        if (c !== this.count && c >= 0) {
          this.count = c;
          eventBus.emit(Events.TEST_COUNTDOWN, c);
        }
        if (remaining <= 0) {
          this.phase = 'ducks';
          this.t = 0;
          for (const d of this.ducks) d.go = true;
          eventBus.emit(Events.TEST_PHASE, 'ducks');
        }
        break;
      }
      case 'ducks': {
        const walking = this.ducks.filter((d) => d.state === 'walk' || d.state === 'hesitate');
        const focus = walking.length ? walking.reduce((s, d) => s + d.x, 0) / walking.length : 0;
        this.setCam(dt, level, 'ducks', focus);
        if (this.rescued >= DUCKS.COUNT) {
          this.phase = 'ducksDone';
          this.t = 0;
          eventBus.emit(Events.TEST_PHASE, 'ducksDone');
        } else if (this.t > 140) {
          this.finish(false, { kind: 'timeout' });
        }
        break;
      }
      case 'ducksDone':
        if (this.t > INSPECTION.DUCKS_DONE_PAUSE) this.startHippo();
        break;
      case 'hippo': {
        const h = this.hippo;
        const intro = h.state === 'enter' || h.state === 'inspect';
        this.setCam(dt, level, intro ? 'hippoIntro' : 'hippo', h.x);
        if (this.t > 150) this.finish(false, { kind: 'timeout' });
        break;
      }
      case 'failing':
        if (this.t > INSPECTION.FAIL_LINGER) this.finish(false, this.firstFailure);
        break;
      case 'celebrating':
        if (this.t > INSPECTION.SUCCESS_LINGER) this.finish(true, null);
        break;
      default:
        break;
    }
  }

  startHippo() {
    const { level } = this.ctx;
    const g = level.gap / 2;
    this.hippo = new Hippo(this.ctx, level.hippoMass);
    this.hippo.place(-g - 15);
    this.hippo.setState('enter');
    this.phase = 'hippo';
    this.t = 0;
    gameState.hippoResult = 'walking';
    eventBus.emit(Events.TEST_PHASE, 'hippo');
  }

  onFall(who, walker) {
    if (!this.firstFailure) {
      // match the walker's fall to the structural event that caused it (if any)
      const recent = [...this.structEvents].reverse().find((e) => e.t <= this.t + 0.01) || null;
      this.firstFailure = {
        kind: 'fall', who, x: walker.x, reason: walker.fallReason,
        structural: this.structEvents.length ? this.structEvents[0] : null,
        recent,
      };
    }
    if (who === 'hippo') {
      gameState.hippoResult = 'fell';
      this.ctx.cameraRig.shake(1.0);
    } else {
      this.ctx.cameraRig.shake(0.25);
    }
    if (this.phase !== 'failing') {
      this.phase = 'failing';
      this.t = 0;
      // the rest of the parade freezes in fright
      for (const d of this.ducks) if (d.state === 'queue') d.go = false;
      eventBus.emit(Events.WALKER_FELL, { who });
      eventBus.emit(Events.TEST_PHASE, 'failing');
    }
  }

  onHippoCrossed() {
    gameState.hippoResult = 'crossed';
    this.phase = 'celebrating';
    this.t = 0;
    this.setCam(0, this.ctx.level, 'celebrate');
    eventBus.emit(Events.TEST_PHASE, 'celebrating');
    eventBus.emit(Events.CELEBRATE, { big: true });
  }

  finish(success, failure) {
    this.phase = 'done';
    this.result = {
      success,
      rescued: this.rescued,
      hippo: gameState.hippoResult === 'crossed',
      hippoTried: !!this.hippo,
      maxStress: this.maxStress,
      failure,
      structEvents: this.structEvents,
    };
    eventBus.emit(Events.TEST_FINISHED, this.result);
  }

  animate(dt, time, alpha = 1) {
    const dance = this.phase === 'celebrating' || this.phase === 'done' && this.result?.success;
    for (const d of this.ducks) d.animate(dt, time, { dance: dance || (this.phase === 'ducksDone'), alpha });
    if (this.hippo) this.hippo.animate(dt, time, { dance: dance && this.hippo.state === 'arrived', alpha });
  }

  /** Where the ducks wait — used to keep the beaver out of the way. */
  queueX() {
    const g = this.ctx.level.gap / 2;
    return -g - 1.6;
  }

  snapshot() {
    return {
      phase: this.phase,
      rescued: this.rescued || 0,
      ducks: this.ducks.map((d) => ({ s: d.state, x: +d.x.toFixed(2), y: +d.y.toFixed(2) })),
      hippo: this.hippo ? { s: this.hippo.state, x: +this.hippo.x.toFixed(2), y: +this.hippo.y.toFixed(2) } : null,
    };
  }
}

export { HIPPO, terrainHeight };
