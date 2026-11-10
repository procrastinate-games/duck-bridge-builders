// Pooled instanced particles: dust, wood chips, splashes, confetti, sweat, sparks.
// Plus pooled expanding splash rings.

import * as THREE from 'three';

const MAX = 900;

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.6, flatShading: true }), MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.parts = [];
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.color = new THREE.Color();
    // splash rings
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.8, 1, 32);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false;
      m.renderOrder = 3;
      scene.add(m);
      this.rings.push({ mesh: m, t: 1, life: 1, size: 1 });
    }
  }

  emit(opts) {
    const {
      pos, count = 10, color = 0xffffff, colors = null, speed = 2, up = 2, spread = 1,
      size = 0.06, life = 1, gravity = 9, drag = 0.5, spin = 6, shrink = true, float = false,
    } = opts;
    for (let i = 0; i < count; i++) {
      if (this.parts.length >= MAX) this.parts.shift();
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      this.parts.push({
        x: pos.x + (Math.random() - 0.5) * spread * 0.4,
        y: pos.y,
        z: pos.z + (Math.random() - 0.5) * spread * 0.4,
        vx: Math.cos(a) * speed * r,
        vy: up * (0.5 + Math.random()),
        vz: Math.sin(a) * speed * r,
        rx: Math.random() * 6, ry: Math.random() * 6,
        spin: (Math.random() - 0.5) * spin,
        size: size * (0.6 + Math.random() * 0.8),
        life: life * (0.7 + Math.random() * 0.6),
        age: 0,
        color: colors ? colors[Math.floor(Math.random() * colors.length)] : color,
        gravity, drag, shrink, float,
      });
    }
  }

  ring(pos, size = 1, life = 0.9) {
    const r = this.rings.find((x) => x.t >= x.life) || this.rings[0];
    r.t = 0;
    r.life = life;
    r.size = size;
    r.mesh.position.set(pos.x, pos.y + 0.03, pos.z);
    r.mesh.visible = true;
  }

  // presets ---------------------------------------------------------------
  dust(pos, n = 8) {
    this.emit({ pos, count: n, color: 0xd8c3a0, speed: 1.2, up: 0.6, size: 0.08, life: 0.6, gravity: -0.5, drag: 2 });
  }
  chips(pos, n = 14) {
    this.emit({ pos, count: n, colors: [0xe8c08a, 0xcf9a5e, 0xa86b3c], speed: 2.5, up: 2.5, size: 0.05, life: 1.1, gravity: 12 });
  }
  splash(pos, big = false) {
    const n = big ? 70 : 22;
    this.emit({ pos, count: n, colors: [0xffffff, 0xbff4ff, 0x7fdcff], speed: big ? 5 : 2.5, up: big ? 7 : 3.5, size: big ? 0.14 : 0.07, life: big ? 1.4 : 0.9, gravity: 14, spread: big ? 2 : 1 });
    this.ring(pos, big ? 3.5 : 1.2, big ? 1.4 : 0.8);
    if (big) setTimeout(() => this.ring(pos, 5, 1.6), 180);
  }
  confetti(pos, n = 120) {
    this.emit({ pos, count: n, colors: [0xff5f7e, 0xffd23f, 0x6fd36f, 0x6fc3ff, 0xb48cff, 0xff9d2a], speed: 6, up: 8, size: 0.07, life: 3.2, gravity: 4, drag: 1.4, spin: 14, spread: 3, shrink: false });
  }
  sweat(pos) {
    this.emit({ pos, count: 3, color: 0x8fd8ff, speed: 0.8, up: 1.4, size: 0.05, life: 0.7, gravity: 6 });
  }
  sparks(pos, n = 10) {
    this.emit({ pos, count: n, colors: [0xffe28a, 0xffffff], speed: 3, up: 2, size: 0.03, life: 0.4, gravity: 6 });
  }
  hearts(pos) {
    this.emit({ pos, count: 6, colors: [0xff5f7e, 0xff9fb0], speed: 0.6, up: 1.2, size: 0.08, life: 1.4, gravity: -0.6, drag: 1 });
  }
  bubbles(pos) {
    this.emit({ pos, count: 4, color: 0xe8fbff, speed: 0.4, up: 0.8, size: 0.06, life: 0.8, gravity: -0.5 });
  }

  update(dt) {
    let n = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.parts.splice(i, 1);
        continue;
      }
      p.vy -= p.gravity * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vz *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rx += p.spin * dt;
      p.ry += p.spin * 0.7 * dt;
    }
    for (const p of this.parts) {
      const k = p.shrink ? 1 - p.age / p.life : 1;
      const sz = p.size * Math.max(0.05, k);
      this.e.set(p.rx, p.ry, 0);
      this.q.setFromEuler(this.e);
      this.m4.compose(this.v.set(p.x, p.y, p.z), this.q, this.s.set(sz, p.shrink ? sz : sz * 0.25, sz));
      this.mesh.setMatrixAt(n, this.m4);
      this.mesh.setColorAt(n, this.color.set(p.color));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    for (const r of this.rings) {
      if (r.t >= r.life) {
        r.mesh.visible = false;
        continue;
      }
      r.t += dt;
      const k = r.t / r.life;
      const s = r.size * (0.3 + k);
      r.mesh.scale.set(s, 1, s);
      r.mesh.material.opacity = 0.8 * (1 - k);
    }
  }

  clear() {
    this.parts.length = 0;
    for (const r of this.rings) r.t = r.life;
  }
}
