// 2D XPBD frame solver for the bridge (see docs/architectural-decisions/0002).
// Nodes: position + rotation. Members: axial distance constraint + one rigid
// angle constraint per end (a nailed/bolted joint). Forces come straight from
// the XPBD multipliers (F = λ / h²), so every break has a measurable cause.
// Pure JS — no rendering — so it can be tuned headlessly (scripts/sim-check.mjs).

import { MATERIALS, JOINTS, SOLVER, GAME } from '../core/Constants.js';

const G = GAME.GRAVITY;

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export class StructureSolver {
  /**
   * @param {(x:number)=>number} groundFn ground height along the bridge plane
   * @param {number} waterY water surface height
   */
  constructor(groundFn, waterY = GAME.WATER_Y) {
    this.ground = groundFn;
    this.waterY = waterY;
    this.nodes = new Map();
    this.members = new Map();
    this.loads = [];
    this.events = [];
    this.nextNodeId = 1;
    this.nextMemberId = 1;
    this.windForce = null; // (member, time) => {fx, fy} per metre
    this.time = 0;
    this.breakingEnabled = true;
    this.topologyDirty = true;
  }

  // ---------------------------------------------------------------- topology

  addNode(x, y, { fixed = false, kind = 'free', reinforced = false } = {}) {
    const id = this.nextNodeId++;
    const node = {
      id, x, y, px: x, py: y, vx: 0, vy: 0,
      th: 0, pth: 0, w: 0,
      fixed, kind, reinforced,
      members: new Set(),
      baseMass: 0, inertia: SOLVER.MIN_INERTIA,
      loadMass: 0, fx: 0, fy: 0,
      invMass: 0, invInertia: 0,
      failedMark: 0,
    };
    this.nodes.set(id, node);
    this.topologyDirty = true;
    return node;
  }

  findNodeNear(x, y, radius) {
    let best = null;
    let bestD = radius;
    for (const n of this.nodes.values()) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  addMember(type, aId, bId, { damage = 0, restLength = null } = {}) {
    const a = this.nodes.get(aId);
    const b = this.nodes.get(bId);
    const mat = MATERIALS[type];
    if (!a || !b || !mat || a === b) return null;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = restLength ?? Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const id = this.nextMemberId++;
    const member = {
      id, type, mat, a: aId, b: bId,
      restLen: len,
      // per-end joint: rigid flag + rest angle offset relative to node rotation
      ends: [
        { rigid: true, phi: wrapAngle(ang - a.th), moment: 0, sMoment: 0, over: 0 },
        { rigid: true, phi: wrapAngle(ang - b.th), moment: 0, sMoment: 0, over: 0 },
      ],
      mass: mat.mass * (len / mat.length),
      axial: 0, sAxial: 0, overAxial: 0, overBend: 0,
      bendMoment: 0, bendT: 0.5, bendSrc: null,
      stress: 0, peakStress: 0,
      damage,
      accAxial: 0, accM0: 0, accM1: 0,
    };
    this.members.set(id, member);
    a.members.add(id);
    b.members.add(id);
    this.topologyDirty = true;
    return member;
  }

  removeMember(id, { keepEmptyNodes = false } = {}) {
    const m = this.members.get(id);
    if (!m) return null;
    this.members.delete(id);
    for (const nid of [m.a, m.b]) {
      const n = this.nodes.get(nid);
      if (!n) continue;
      n.members.delete(id);
      if (!keepEmptyNodes && n.members.size === 0 && !n.fixed) this.nodes.delete(nid);
    }
    this.topologyDirty = true;
    return m;
  }

  /**
   * Re-nail loosened joints at a node. Small sags spring back to the built
   * angle; a piece left dangling is lifted back into its built position first.
   */
  hammerNode(nodeId) {
    const n = this.nodes.get(nodeId);
    if (!n) return 0;
    let fixedCount = this.reattachDetached(n);
    for (const mid of n.members) {
      const m = this.members.get(mid);
      const e = m.a === nodeId ? 0 : 1;
      const end = m.ends[e];
      if (end.rigid) continue;
      const err = wrapAngle(this.memberAngle(m) - n.th - end.phi);
      const otherId = e === 0 ? m.b : m.a;
      const other = this.nodes.get(otherId);
      if (Math.abs(err) > 0.2) {
        if (other && !other.fixed && other.members.size === 1) {
          // dangling piece: lift it back to where it was built
          const dir = n.th + end.phi + (e === 0 ? 0 : Math.PI);
          other.x = other.px = n.x + Math.cos(dir) * m.restLen;
          other.y = other.py = n.y + Math.sin(dir) * m.restLen;
          other.vx = other.vy = other.w = 0;
          const oe = m.ends[1 - e];
          other.th = other.pth = wrapAngle(this.memberAngle(m) - oe.phi);
          // its far end may now sit on a joint (usually the one it tore away from)
          let home = oe.detachedFrom != null ? this.nodes.get(oe.detachedFrom) : null;
          if (!home || Math.hypot(home.x - other.x, home.y - other.y) > 0.6) {
            home = null;
            let best = 0.45;
            for (const k of this.nodes.values()) {
              if (k === other || k === n) continue;
              const d = Math.hypot(k.x - other.x, k.y - other.y);
              if (d < best) {
                best = d;
                home = k;
              }
            }
          }
          if (home) this.mergeInto(other, home, m, 1 - e);
        } else {
          end.phi = wrapAngle(this.memberAngle(m) - n.th);
        }
      }
      end.rigid = true;
      end.over = 0;
      end.sMoment = 0;
      fixedCount++;
    }
    if (fixedCount) {
      n.failedMark = 0;
      this.topologyDirty = true;
    }
    return fixedCount;
  }

  /** Pieces whose nails pulled out of this joint get pulled back and re-nailed. */
  reattachDetached(n) {
    let count = 0;
    for (const m of this.members.values()) {
      for (let e = 0; e < 2; e++) {
        const end = m.ends[e];
        if (end.detachedFrom == null) continue;
        // its joint is n, or its joint was destroyed and n now sits where it was
        const homeGone = !this.nodes.has(end.detachedFrom);
        const nearHome = end.detachedPos && Math.hypot(end.detachedPos.x - n.x, end.detachedPos.y - n.y) < 0.5;
        if (end.detachedFrom !== n.id && !(homeGone && nearHome)) continue;
        const freeId = e === 0 ? m.a : m.b;
        const free = this.nodes.get(freeId);
        if (!free || freeId === n.id || free.fixed || free.members.size !== 1) {
          end.detachedFrom = null;
          continue;
        }
        // only if the piece still fits between n and its other end
        const other = this.nodes.get(e === 0 ? m.b : m.a);
        if (Math.abs(Math.hypot(other.x - n.x, other.y - n.y) - m.restLen) > 0.3) continue;
        this.mergeInto(free, n, m, e);
        count++;
      }
    }
    if (count) this.topologyDirty = true;
    return count;
  }

  /** Move member end `e` from single-member node `free` onto joint `target`. */
  mergeInto(free, target, m, e) {
    this.nodes.delete(free.id);
    if (e === 0) m.a = target.id;
    else m.b = target.id;
    target.members.add(m.id);
    const end = m.ends[e];
    end.rigid = true;
    end.detachedFrom = null;
    end.over = 0;
    end.sMoment = 0;
    end.phi = wrapAngle(this.memberAngle(m) - target.th);
    m.sAxial = 0;
    target.failedMark = 0;
    this.topologyDirty = true;
  }

  reinforceNode(nodeId) {
    const n = this.nodes.get(nodeId);
    if (!n || n.reinforced) return false;
    n.reinforced = true;
    this.hammerNode(nodeId);
    this.topologyDirty = true;
    return true;
  }

  memberAngle(m) {
    const a = this.nodes.get(m.a);
    const b = this.nodes.get(m.b);
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  memberLength(m) {
    const a = this.nodes.get(m.a);
    const b = this.nodes.get(m.b);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  // ---------------------------------------------------------------- loads

  clearLoads() {
    this.loads.length = 0;
  }

  /** A walker standing on member at parameter t (0 = a end, 1 = b end). */
  addPointLoad(memberId, t, mass, extraForceY = 0, src = 'load') {
    const m = this.members.get(memberId);
    if (!m) return;
    this.loads.push({ m, t: Math.min(1, Math.max(0, t)), mass, extra: extraForceY, src });
  }

  // ---------------------------------------------------------------- capacities

  strengthFactor(m) {
    return 1 - SOLVER.DAMAGE_STRENGTH_LOSS * m.damage;
  }

  jointSpec(node) {
    return node.reinforced ? JOINTS.connector : JOINTS.nail;
  }

  pullCap(node) {
    return this.jointSpec(node).pullOut * (node.fixed ? JOINTS.anchorBonus : 1);
  }

  momentCap(node) {
    return this.jointSpec(node).momentCap * (node.fixed ? JOINTS.anchorBonus : 1);
  }

  compressionCap(m) {
    const L = Math.max(0.3, m.restLen);
    const euler = (Math.PI * Math.PI * m.mat.EI) / (L * L);
    return Math.min(m.mat.axialStrength, euler) * this.strengthFactor(m);
  }

  tensionCap(m) {
    return m.mat.axialStrength * this.strengthFactor(m);
  }

  bendCap(m) {
    return (m.mat.bendStrength || Infinity) * this.strengthFactor(m);
  }

  // ---------------------------------------------------------------- simulation

  rebuildMass() {
    for (const n of this.nodes.values()) {
      n.baseMass = 0;
      n.inertia = 0;
    }
    for (const m of this.members.values()) {
      const a = this.nodes.get(m.a);
      const b = this.nodes.get(m.b);
      const half = m.mass * 0.5;
      a.baseMass += half;
      b.baseMass += half;
      const I = (m.mass * m.restLen * m.restLen) / 24;
      a.inertia += I;
      b.inertia += I;
    }
    for (const n of this.nodes.values()) {
      if (n.reinforced) n.baseMass += 1;
      n.baseMass = Math.max(n.baseMass, 0.5);
      n.inertia = Math.max(n.inertia, SOLVER.MIN_INERTIA);
    }
    this.topologyDirty = false;
  }

  step(dt) {
    if (this.topologyDirty) this.rebuildMass();
    this.time += dt;
    const N = SOLVER.SUBSTEPS;
    const h = dt / N;
    const h2 = h * h;

    // External loads → node masses and forces
    for (const n of this.nodes.values()) {
      n.loadMass = 0;
      n.fx = 0;
      n.fy = 0;
    }
    for (const m of this.members.values()) {
      m.bendMoment = 0;
      m.accAxial = 0;
      m.accM0 = 0;
      m.accM1 = 0;
    }
    for (const L of this.loads) {
      const a = this.nodes.get(L.m.a);
      const b = this.nodes.get(L.m.b);
      if (!a || !b) continue;
      a.loadMass += L.mass * (1 - L.t);
      b.loadMass += L.mass * L.t;
      a.fy += L.extra * (1 - L.t);
      b.fy += L.extra * L.t;
      // Simply-supported bending moment at the load point: M = F·a·b/L
      const F = L.mass * G + Math.max(0, -L.extra);
      const Mb = F * L.t * (1 - L.t) * L.m.restLen;
      if (Mb > L.m.bendMoment) {
        L.m.bendT = L.t;
        L.m.bendSrc = L.src;
      }
      L.m.bendMoment += Mb;
    }
    if (this.windForce) {
      for (const m of this.members.values()) {
        const f = this.windForce(m, this.time);
        if (!f) continue;
        const a = this.nodes.get(m.a);
        const b = this.nodes.get(m.b);
        const area = m.restLen * (m.mat.kind === 'deck' ? 1 : 0.35);
        a.fx += f.fx * area * 0.5;
        b.fx += f.fx * area * 0.5;
        a.fy += f.fy * area * 0.5;
        b.fy += f.fy * area * 0.5;
      }
    }
    for (const n of this.nodes.values()) {
      const mass = n.baseMass + n.loadMass;
      n.invMass = n.fixed ? 0 : 1 / mass;
      n.invInertia = n.fixed ? 0 : 1 / n.inertia;
    }

    const members = [...this.members.values()];
    const nodes = [...this.nodes.values()];
    const linDamp = Math.max(0, 1 - SOLVER.LINEAR_DAMPING * h);
    const angDamp = Math.max(0, 1 - SOLVER.ANGULAR_DAMPING * h);
    const waterDamp = Math.max(0, 1 - SOLVER.WATER_DRAG * h);

    for (let s = 0; s < N; s++) {
      // Integrate
      for (const n of nodes) {
        if (n.fixed) continue;
        const mass = n.baseMass + n.loadMass;
        n.vx += h * (n.fx / mass);
        n.vy += h * (n.fy / mass - G);
        if (n.y < this.waterY) {
          const depth = Math.min(1, (this.waterY - n.y) / 0.3);
          n.vy += h * G * SOLVER.BUOYANCY * depth * (n.baseMass / mass);
          n.vx *= waterDamp;
          n.vy *= waterDamp;
        }
        n.vx *= linDamp;
        n.vy *= linDamp;
        n.w *= angDamp;
        n.px = n.x;
        n.py = n.y;
        n.pth = n.th;
        n.x += h * n.vx;
        n.y += h * n.vy;
        n.th += h * n.w;
      }

      // Axial distance constraints
      for (const m of members) {
        const a = this.nodes.get(m.a);
        const b = this.nodes.get(m.b);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1e-6;
        const C = len - m.restLen;
        const k = m.mat.EA / m.restLen;
        const alpha = 1 / (k * h2);
        const wsum = a.invMass + b.invMass;
        if (wsum === 0) continue;
        const dl = -C / (wsum + alpha);
        const nx = dx / len;
        const ny = dy / len;
        a.x -= a.invMass * nx * dl;
        a.y -= a.invMass * ny * dl;
        b.x += b.invMass * nx * dl;
        b.y += b.invMass * ny * dl;
        m.accAxial += -dl / h2; // tension positive
      }

      // Rigid joint angle constraints (one per member end)
      for (const m of members) {
        for (let e = 0; e < 2; e++) {
          const end = m.ends[e];
          if (!end.rigid) continue;
          const a = this.nodes.get(m.a);
          const b = this.nodes.get(m.b);
          const n = e === 0 ? a : b;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const l2 = dx * dx + dy * dy || 1e-6;
          const C = wrapAngle(Math.atan2(dy, dx) - n.th - end.phi);
          // ∂θm/∂pb = (-dy, dx)/l², ∂θm/∂pa = (dy, -dx)/l², ∂C/∂θn = -1
          const gbx = -dy / l2;
          const gby = dx / l2;
          const gn2 = 1 / l2;
          const w = (a.invMass + b.invMass) * gn2 + n.invInertia;
          if (w === 0) continue;
          const node = n;
          const k = this.jointSpec(node).stiffness;
          const alpha = 1 / (k * h2);
          const dl = -C / (w + alpha);
          a.x -= a.invMass * gbx * dl;
          a.y -= a.invMass * gby * dl;
          b.x += b.invMass * gbx * dl;
          b.y += b.invMass * gby * dl;
          node.th -= node.invInertia * dl;
          const M = Math.abs(dl / h2);
          if (e === 0) m.accM0 += M;
          else m.accM1 += M;
        }
      }

      // Ground contact
      for (const n of nodes) {
        if (n.fixed) continue;
        const gy = this.ground(n.x) + SOLVER.NODE_RADIUS;
        if (n.y < gy) {
          n.y = gy;
          n.x = n.px + (n.x - n.px) * (1 - SOLVER.GROUND_FRICTION);
        }
      }

      // Velocities
      for (const n of nodes) {
        if (n.fixed) continue;
        n.vx = (n.x - n.px) / h;
        n.vy = (n.y - n.py) / h;
        n.w = (n.th - n.pth) / h;
      }
    }

    // Average forces over substeps and smooth for break checks
    const k = SOLVER.SMOOTHING;
    for (const m of members) {
      m.axial = m.accAxial / N;
      m.sAxial += (m.axial - m.sAxial) * k;
      m.ends[0].moment = m.accM0 / N;
      m.ends[1].moment = m.accM1 / N;
      m.ends[0].sMoment += (m.ends[0].moment - m.ends[0].sMoment) * k;
      m.ends[1].sMoment += (m.ends[1].moment - m.ends[1].sMoment) * k;
    }

    this.evaluate(dt);
  }

  /** Compute stress ratios, accumulate damage, and break what is overloaded. */
  evaluate(dt) {
    let breaks = 0;
    for (const m of [...this.members.values()]) {
      if (!this.members.has(m.id)) continue;
      const a = this.nodes.get(m.a);
      const b = this.nodes.get(m.b);
      const T = m.sAxial;
      const rT = T > 0 ? T / this.tensionCap(m) : -T / this.compressionCap(m);
      const pullA = this.pullCap(a);
      const pullB = this.pullCap(b);
      const rPull = T > 0 ? T / Math.min(pullA, pullB) : 0;
      const rM0 = m.ends[0].rigid ? m.ends[0].sMoment / this.momentCap(a) : 0;
      const rM1 = m.ends[1].rigid ? m.ends[1].sMoment / this.momentCap(b) : 0;
      const rB = m.mat.kind === 'deck' ? m.bendMoment / this.bendCap(m) : 0;
      m.stress = Math.max(rT, rPull, rM0 * 0.85, rM1 * 0.85, rB);
      m.peakStress = Math.max(m.peakStress, m.stress);
      m.ratios = { rT, rPull, rM0, rM1, rB };

      // Fatigue: sustained overload weakens the piece permanently
      const memberRatio = Math.max(rT, rB);
      if (this.breakingEnabled && memberRatio > SOLVER.DAMAGE_THRESHOLD) {
        m.damage = Math.min(SOLVER.DAMAGE_MAX, m.damage + (memberRatio - SOLVER.DAMAGE_THRESHOLD) * SOLVER.DAMAGE_RATE * dt);
      }

      if (!this.breakingEnabled || breaks >= SOLVER.MAX_BREAKS_PER_FRAME) continue;

      // Bending snap (deck planks under walkers)
      m.overBend = rB >= 1 ? m.overBend + 1 : 0;
      if (m.overBend >= SOLVER.OVERLOAD_FRAMES) {
        this.snapMember(m, 'bend', m.bendT);
        breaks++;
        continue;
      }
      // Axial failure (tension tear or compression buckle)
      m.overAxial = rT >= 1 ? m.overAxial + 1 : 0;
      if (m.overAxial >= SOLVER.OVERLOAD_FRAMES) {
        this.snapMember(m, T > 0 ? 'tension' : 'compression', 0.5);
        breaks++;
        continue;
      }
      // Nails pull out of the weaker joint
      if (rPull >= 1) {
        m.overPull = (m.overPull || 0) + 1;
        if (m.overPull >= SOLVER.OVERLOAD_FRAMES) {
          const e = pullA <= pullB ? 0 : 1;
          this.detachEnd(m, e);
          breaks++;
          continue;
        }
      } else {
        m.overPull = 0;
      }
      // Joints twist loose (become hinges)
      for (let e = 0; e < 2; e++) {
        const r = e === 0 ? rM0 : rM1;
        const end = m.ends[e];
        end.over = r >= 1 ? end.over + 1 : 0;
        if (end.rigid && end.over >= SOLVER.OVERLOAD_FRAMES) {
          end.rigid = false;
          end.over = 0;
          const node = e === 0 ? a : b;
          node.failedMark = 1;
          this.events.push({ type: 'loosen', member: m, end: e, node, x: node.x, y: node.y });
        }
      }
    }
    if (this.topologyDirty) this.pruneDisconnected();
  }

  snapMember(m, reason, t) {
    const a = this.nodes.get(m.a);
    const b = this.nodes.get(m.b);
    const tt = Math.min(0.85, Math.max(0.15, t));
    const sx = a.x + (b.x - a.x) * tt;
    const sy = a.y + (b.y - a.y) * tt;
    const piece = (x1, y1, x2, y2, v1, v2, frac) => ({
      x1, y1, x2, y2,
      vx: (v1.vx + v2.vx) / 2,
      vy: (v1.vy + v2.vy) / 2,
      length: m.restLen * frac,
    });
    const mid = { vx: (a.vx + b.vx) / 2, vy: (a.vy + b.vy) / 2 };
    const pieces = [
      piece(a.x, a.y, sx, sy, a, mid, tt),
      piece(sx, sy, b.x, b.y, mid, b, 1 - tt),
    ];
    this.removeMember(m.id);
    if (this.nodes.has(a.id)) a.failedMark = 1;
    if (this.nodes.has(b.id)) b.failedMark = 1;
    this.events.push({
      type: 'snap', member: m, reason, t: tt, x: sx, y: sy, pieces,
      src: m.bendSrc, ax: a.x, ay: a.y, bx: b.x, by: b.y,
    });
  }

  detachEnd(m, e) {
    const oldId = e === 0 ? m.a : m.b;
    const old = this.nodes.get(oldId);
    const fresh = this.addNode(old.x, old.y);
    fresh.vx = old.vx;
    fresh.vy = old.vy;
    fresh.th = old.th;
    old.members.delete(m.id);
    if (e === 0) m.a = fresh.id;
    else m.b = fresh.id;
    fresh.members.add(m.id);
    m.ends[e].rigid = true;
    m.ends[e].detachedFrom = old.id;
    m.ends[e].detachedPos = { x: old.x, y: old.y };
    old.failedMark = 1;
    this.events.push({ type: 'detach', member: m, end: e, node: old, x: old.x, y: old.y });
    if (old.members.size === 0 && !old.fixed) this.nodes.delete(old.id);
    this.topologyDirty = true;
  }

  /** Members no longer connected to any fixed anchor fall as free debris. */
  pruneDisconnected() {
    const reached = new Set();
    const queue = [];
    for (const n of this.nodes.values()) {
      if (n.fixed) {
        reached.add(n.id);
        queue.push(n.id);
      }
    }
    while (queue.length) {
      const nid = queue.pop();
      const n = this.nodes.get(nid);
      if (!n) continue;
      for (const mid of n.members) {
        const m = this.members.get(mid);
        if (!m) continue;
        const other = m.a === nid ? m.b : m.a;
        if (!reached.has(other)) {
          reached.add(other);
          queue.push(other);
        }
      }
    }
    const loose = [];
    for (const m of this.members.values()) {
      if (!reached.has(m.a)) loose.push(m);
    }
    if (!loose.length) return;
    const pieces = loose.map((m) => {
      const a = this.nodes.get(m.a);
      const b = this.nodes.get(m.b);
      return {
        member: m, x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        vx: (a.vx + b.vx) / 2, vy: (a.vy + b.vy) / 2, length: m.restLen,
      };
    });
    for (const m of loose) this.removeMember(m.id);
    this.events.push({ type: 'cluster', pieces });
  }

  drainEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  // ---------------------------------------------------------------- queries

  /** Max stress over all members (for HUD "bridge condition"). */
  maxStress() {
    let s = 0;
    for (const m of this.members.values()) s = Math.max(s, m.stress);
    return s;
  }

  /** Total kinetic energy proxy — used to tell if the structure has settled. */
  motion() {
    let v = 0;
    for (const n of this.nodes.values()) v = Math.max(v, Math.abs(n.vx) + Math.abs(n.vy));
    return v;
  }

  clear() {
    this.nodes.clear();
    this.members.clear();
    this.loads.length = 0;
    this.events.length = 0;
    this.topologyDirty = true;
  }
}
