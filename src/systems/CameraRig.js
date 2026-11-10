// Third-person orbit camera with smoothing, terrain collision avoidance,
// cinematic overrides (inspection), and screen shake.

import * as THREE from 'three';
import { CAMERA } from '../core/Constants.js';
import { gameState } from '../core/GameState.js';
import { G } from './PhysicsWorld.js';

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3(0, 1, 0);
    this.smoothTarget = new THREE.Vector3(0, 1, 0);
    this.yaw = CAMERA.YAW;
    this.pitch = CAMERA.PITCH;
    this.distance = CAMERA.DISTANCE;
    this.smoothDistance = CAMERA.DISTANCE;
    this.extraDistance = 0;
    this.cinematic = null; // { target: Vector3, distance, yaw, pitch, lerp }
    this.shakeAmp = 0;
    this.shakeTime = 0;
    this.physics = null;
    this.tmp = new THREE.Vector3();
    this.userOrbitTimer = 0;
  }

  reset(target, { yaw = CAMERA.YAW, pitch = CAMERA.PITCH, distance = CAMERA.DISTANCE } = {}) {
    this.target.copy(target);
    this.smoothTarget.copy(target);
    this.yaw = yaw;
    this.pitch = pitch;
    this.distance = distance;
    this.smoothDistance = distance;
    this.cinematic = null;
  }

  orbit(dx, dy) {
    const s = CAMERA.SENSITIVITY * gameState.settings.sensitivity;
    this.yaw -= dx * s;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * s, CAMERA.MIN_PITCH, CAMERA.MAX_PITCH);
    if (dx || dy) this.userOrbitTimer = 2.5;
  }

  zoom(steps) {
    this.distance = THREE.MathUtils.clamp(this.distance * (1 + steps * 0.1), CAMERA.MIN_DISTANCE, CAMERA.MAX_DISTANCE);
  }

  shake(amount) {
    this.shakeAmp = Math.min(1.2, Math.max(this.shakeAmp, amount));
  }

  setCinematic(c) {
    this.cinematic = c;
  }

  /** Horizontal forward direction of the camera (for camera-relative movement). */
  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  update(dt) {
    let target = this.target;
    let distance = this.distance + this.extraDistance;
    let yaw = this.yaw;
    let pitch = this.pitch;
    let lerp = CAMERA.FOLLOW_LERP;
    if (this.cinematic) {
      const c = this.cinematic;
      target = c.target;
      distance = c.distance;
      if (this.userOrbitTimer <= 0) {
        if (c.yaw !== undefined) this.yaw += (c.yaw - this.yaw) * Math.min(1, dt * (c.lerp || 1.5));
        if (c.pitch !== undefined) this.pitch += (c.pitch - this.pitch) * Math.min(1, dt * (c.lerp || 1.5));
      }
      yaw = this.yaw;
      pitch = this.pitch;
      lerp = c.lerp || 2;
    }
    this.userOrbitTimer -= dt;
    const k = 1 - Math.exp(-lerp * dt);
    this.smoothTarget.lerp(target, k);
    this.smoothDistance += (distance - this.smoothDistance) * (1 - Math.exp(-3 * dt));

    const cp = Math.cos(pitch);
    const offset = this.tmp.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
    let d = this.smoothDistance;
    // Collision avoidance against terrain
    if (this.physics && this.physics.world) {
      const hit = this.physics.raycast(
        { x: this.smoothTarget.x, y: this.smoothTarget.y, z: this.smoothTarget.z },
        { x: offset.x, y: offset.y, z: offset.z },
        d,
        G.qCamera,
      );
      if (hit) d = Math.max(1.5, hit.toi - 0.4);
    }
    this.camera.position.copy(this.smoothTarget).addScaledVector(offset, d);
    this.camera.lookAt(this.smoothTarget);

    if (this.shakeAmp > 0.001) {
      this.shakeTime += dt;
      const a = this.shakeAmp * 0.25;
      this.camera.position.x += Math.sin(this.shakeTime * 47) * a;
      this.camera.position.y += Math.sin(this.shakeTime * 59 + 1) * a;
      this.camera.position.z += Math.sin(this.shakeTime * 41 + 2) * a * 0.5;
      this.shakeAmp *= Math.exp(-5 * dt);
    }
  }
}
