// Construction interactions: take from piles, carry, aim with the cursor on the
// bridge plane, rotate, snap to joints/ground, place (trim to fit + hammer),
// remove/reposition pieces, re-nail loose joints, add connectors, drop, recycle.

import * as THREE from 'three';
import { BUILD, COLORS, MATERIALS, CONNECTOR, GAME } from '../core/Constants.js';
import { gameState } from '../core/GameState.js';
import { eventBus, Events } from '../core/EventBus.js';
import { terrainHeight, profileSlope } from '../level/levels.js';
import { createPieceMesh } from '../level/models.js';

const DEFAULT_ANGLE = { shortPlank: 0, longPlank: 0, beam: Math.PI / 4, post: Math.PI / 2 };

function distPointSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1e-6;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return { d: Math.hypot(px - (ax + dx * t), py - (ay + dy * t)), t };
}

function wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class BuildController {
  constructor({ scene, camera, solver, bridge, beaver, debris, levelBuilder, level, particles, cameraRig }) {
    Object.assign(this, { scene, camera, solver, bridge, beaver, debris, levelBuilder, level, particles, cameraRig });
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.cursor = new THREE.Vector3();
    this.angle = 0;
    this.trim = 0; // metres chewed off a free-ended piece
    this.ignoreReach = false;
    this.candidate = null;
    this.hoverNode = null;
    this.hoverMember = null;
    this.hint = '';
    this.preview = null;
    this.previewKey = '';
    this.previewMat = new THREE.MeshBasicMaterial({ color: COLORS.PREVIEW_OK, transparent: true, opacity: 0.45, depthWrite: false });
    const markerGeo = new THREE.TorusGeometry(0.3, 0.05, 8, 24);
    this.markerA = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
    this.markerB = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
    this.markerA.renderOrder = this.markerB.renderOrder = 12;
    this.reachRing = new THREE.Mesh(
      new THREE.RingGeometry(BUILD.REACH - 0.05, BUILD.REACH, 64),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.reachRing.visible = false;
    scene.add(this.markerA, this.markerB, this.reachRing);
    this.markerA.visible = this.markerB.visible = false;
    this.stats = { placed: 0, removed: 0, hammered: 0, reinforced: 0 };
  }

  dispose() {
    this.clearPreview();
    this.scene.remove(this.markerA, this.markerB, this.reachRing);
  }

  // ---------------------------------------------------------------- aiming

  updateCursor(ndcX, ndcY) {
    this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
    const dir = this.raycaster.ray.direction;
    const hit = this.raycaster.ray.intersectPlane(this.plane, this.cursor);
    if (!hit || Math.abs(dir.z) < 0.12) {
      // Edge-on view: aim in front of the beaver instead
      const f = this.beaver.forward();
      this.cursor.set(this.beaver.pos.x + Math.sign(f.x || 1) * 2.2, this.beaver.feetY + 0.6, 0);
      this.cursorFallback = true;
    } else {
      this.cursorFallback = false;
    }
    return this.cursor;
  }

  groundPointAt(x) {
    const gx = Math.round(x / BUILD.GRID) * BUILD.GRID;
    return { x: gx, y: terrainHeight(this.level, gx, 0) };
  }

  anchorableGround(x) {
    return profileSlope(this.level, x) <= BUILD.MAX_ANCHOR_SLOPE;
  }

  /** Snap the start point A near the cursor. */
  snapStart(p) {
    let best = null;
    let bestD = BUILD.SNAP_NODE_RADIUS;
    for (const n of this.solver.nodes.values()) {
      if (n.members.size === 0 && !n.fixed) continue;
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'node', node: n, x: n.x, y: n.y };
      }
    }
    if (best) return best;
    const g = this.groundPointAt(p.x);
    if (Math.abs(p.y - g.y) < BUILD.SNAP_GROUND_RADIUS) {
      const near = this.solver.findNodeNear(g.x, g.y, BUILD.NODE_MERGE);
      if (near) return { kind: 'node', node: near, x: near.x, y: near.y };
      if (!this.anchorableGround(g.x)) return { kind: 'badground', x: g.x, y: g.y };
      if (g.y < GAME.WATER_Y - 6) return { kind: 'badground', x: g.x, y: g.y };
      return { kind: 'ground', x: g.x, y: g.y };
    }
    return { kind: 'free', x: p.x, y: p.y };
  }

  /** Compute the full placement candidate for the carried piece. */
  computeCandidate() {
    const item = this.beaver.carried;
    const mt = MATERIALS[item.type];
    const maxLen = item.length;
    const minLen = mt.minLength;
    this.trim = Math.min(Math.max(0, this.trim), maxLen - minLen);
    const freeLen = maxLen - this.trim;
    const A = this.snapStart(this.cursor);
    const dirx = Math.cos(this.angle);
    const diry = Math.sin(this.angle);
    let B = { kind: 'free', x: A.x + dirx * freeLen, y: A.y + diry * freeLen };
    let trimmed = false;
    let reason = null;

    // Auto-aim to an existing joint within a small cone
    let bestScore = Infinity;
    for (const n of this.solver.nodes.values()) {
      if (A.node && n.id === A.node.id) continue;
      if (n.members.size === 0 && !n.fixed) continue;
      const dx = n.x - A.x;
      const dy = n.y - A.y;
      const d = Math.hypot(dx, dy);
      if (d < minLen || d > maxLen + 0.05) continue;
      const da = Math.abs(wrap(Math.atan2(dy, dx) - this.angle));
      const endD = Math.hypot(n.x - B.x, n.y - B.y);
      if (da > BUILD.END_SNAP_ANGLE && endD > BUILD.END_SNAP_RADIUS) continue;
      const score = da * 3 + Math.abs(maxLen - d) * 0.15;
      if (score < bestScore) {
        bestScore = score;
        B = { kind: 'node', node: n, x: n.x, y: n.y };
      }
    }

    // Ground along the way: anchor where the piece meets the ground (trimmed)
    if (B.kind === 'free') {
      const steps = 40;
      const startT = A.kind === 'ground' || (A.node && A.node.fixed) ? 0.12 / freeLen : 0;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        if (t < startT) continue;
        const x = A.x + dirx * freeLen * t;
        const y = A.y + diry * freeLen * t;
        const gy = terrainHeight(this.level, x, 0);
        if (y < gy - 0.02) {
          // binary refine
          let lo = (i - 1) / steps;
          let hi = t;
          for (let k = 0; k < 10; k++) {
            const mid = (lo + hi) / 2;
            const mx = A.x + dirx * freeLen * mid;
            const my = A.y + diry * freeLen * mid;
            if (my < terrainHeight(this.level, mx, 0)) hi = mid;
            else lo = mid;
          }
          const hx = A.x + dirx * freeLen * hi;
          const hy = terrainHeight(this.level, hx, 0);
          const d = Math.hypot(hx - A.x, hy - A.y);
          if (d < minLen) {
            reason = 'Blocked by the ground — rotate it (Q/R)';
          } else if (!this.anchorableGround(hx) || hy < GAME.WATER_Y - 6) {
            reason = 'The ground there is too steep to anchor';
          } else {
            const near = this.solver.findNodeNear(hx, hy, BUILD.NODE_MERGE);
            B = near ? { kind: 'node', node: near, x: near.x, y: near.y } : { kind: 'ground', x: hx, y: hy };
          }
          break;
        }
      }
    }

    const len = Math.hypot(B.x - A.x, B.y - A.y);
    if (len < maxLen - 0.05) trimmed = true;

    // Validity
    if (!reason) {
      if (A.kind === 'free') reason = 'Start at a joint (glowing dot) or on the ground';
      else if (A.kind === 'badground') reason = 'Too steep to anchor here';
      else if (len < minLen) reason = 'Too short';
    }
    if (!reason) {
      // still blocked by ground somewhere in between?
      for (let i = 1; i < 12; i++) {
        const t = i / 12;
        const x = A.x + (B.x - A.x) * t;
        const y = A.y + (B.y - A.y) * t;
        if (y < terrainHeight(this.level, x, 0) - 0.25) {
          reason = 'Blocked by the ground';
          break;
        }
      }
    }
    if (!reason && A.kind === 'node' && B.kind === 'node') {
      for (const mid of A.node.members) {
        const m = this.solver.members.get(mid);
        if ((m.a === A.node.id && m.b === B.node.id) || (m.b === A.node.id && m.a === B.node.id)) {
          reason = 'There is already a piece there';
        }
      }
    }
    if (!reason && A.kind === 'node') {
      for (const mid of A.node.members) {
        const m = this.solver.members.get(mid);
        if (m.mat.kind !== mt.kind) continue;
        const other = this.solver.nodes.get(m.a === A.node.id ? m.b : m.a);
        const ang = Math.atan2(other.y - A.y, other.x - A.x);
        if (Math.abs(wrap(ang - Math.atan2(B.y - A.y, B.x - A.x))) < 0.08) reason = 'Overlaps an existing piece';
      }
    }
    // Reach
    const chest = this.beaver.chest();
    const near = distPointSeg(chest.x, chest.y, A.x, A.y, B.x, B.y);
    const reach3d = Math.hypot(near.d, chest.z);
    if (!reason && !this.ignoreReach && reach3d > BUILD.REACH) reason = 'Too far — walk closer';
    if (!reason && this.beaver.climb) reason = 'Hold on…';

    return { A, B, len, trimmed, valid: !reason, reason, type: item.type };
  }

  // ---------------------------------------------------------------- preview

  clearPreview() {
    if (this.preview) {
      this.scene.remove(this.preview);
      this.preview.traverse((o) => o.geometry && o.geometry.dispose());
      this.preview = null;
      this.previewKey = '';
    }
    this.markerA.visible = false;
    this.markerB.visible = false;
  }

  showPreview(c) {
    const key = `${c.type}-${c.len.toFixed(2)}`;
    if (key !== this.previewKey) {
      this.clearPreview();
      this.preview = createPieceMesh(c.type, Math.max(0.1, c.len));
      this.preview.traverse((o) => {
        if (o.isMesh) {
          o.material = this.previewMat;
          o.castShadow = false;
        }
      });
      this.preview.renderOrder = 5;
      this.scene.add(this.preview);
      this.previewKey = key;
    }
    this.previewMat.color.setHex(c.valid ? COLORS.PREVIEW_OK : COLORS.PREVIEW_BAD);
    this.preview.position.set((c.A.x + c.B.x) / 2, (c.A.y + c.B.y) / 2, 0);
    this.preview.rotation.set(0, 0, Math.atan2(c.B.y - c.A.y, c.B.x - c.A.x));
    this.markerA.visible = true;
    this.markerB.visible = true;
    this.markerA.position.set(c.A.x, c.A.y, 0);
    this.markerB.position.set(c.B.x, c.B.y, 0);
    const colA = c.A.kind === 'node' ? 0x7dffb0 : c.A.kind === 'ground' ? 0xffe28a : 0xff5c5c;
    const colB = c.B.kind === 'node' ? 0x7dffb0 : c.B.kind === 'ground' ? 0xffe28a : 0xffffff;
    this.markerA.material.color.setHex(colA);
    this.markerB.material.color.setHex(colB);
    this.markerB.material.opacity = c.B.kind === 'free' ? 0.4 : 1;
    const s = 1 + Math.sin(performance.now() * 0.008) * 0.12;
    this.markerA.scale.setScalar(s);
    this.markerB.scale.setScalar(c.B.kind === 'free' ? 0.6 : s);
  }

  // ---------------------------------------------------------------- per step

  /**
   * @param {InputSystem} input
   * @returns {void}
   */
  update(input, dt) {
    const beaver = this.beaver;
    this.updateCursor(input.mouse.ndcX, input.mouse.ndcY);

    // Rotation (Q/R + wheel when carrying)
    if (beaver.carried && !beaver.carried.broken) {
      if (input.hit('KeyR')) this.rotate(-1);
      if (input.hit('KeyQ')) this.rotate(1);
      if (input.hit('KeyZ')) this.trim += BUILD.TRIM_STEP;
      if (input.hit('KeyX')) this.trim -= BUILD.TRIM_STEP;
      const w = input.takeWheel();
      if (w) {
        if (input.down('ShiftLeft') || input.down('ShiftRight')) this.trim += w > 0 ? BUILD.TRIM_STEP : -BUILD.TRIM_STEP;
        else this.rotate(w > 0 ? -1 : 1);
      }
    }

    const pile = this.nearestPile();
    const loose = beaver.carried ? null : this.debris.nearest(beaver.pos, BUILD.PICKUP_RADIUS);
    this.hoverNode = null;
    this.hoverMember = null;
    this.candidate = null;

    if (beaver.carried && !beaver.carried.broken) {
      this.candidate = this.computeCandidate();
      this.showPreview(this.candidate);
      beaver.lookTarget = new THREE.Vector3((this.candidate.A.x + this.candidate.B.x) / 2, (this.candidate.A.y + this.candidate.B.y) / 2, 0);
    } else {
      this.clearPreview();
      beaver.lookTarget = null;
      if (!beaver.carried) this.findHover();
    }
    // joints can be hammered even with a piece on the shoulder
    if (beaver.carried && !beaver.carried.broken) this.findHover({ nodesOnly: true });

    // Context hint
    const c = this.candidate;
    if (beaver.carried) {
      const name = beaver.carried.broken ? `broken ${MATERIALS[beaver.carried.type].name.toLowerCase()}` : MATERIALS[beaver.carried.type].name;
      if (pile && (pile.type === beaver.carried.type || beaver.carried.broken)) this.hint = `<b>E</b> return ${name} to the pile`;
      else if (beaver.carried.broken) this.hint = `Carrying a ${name} — bring it to its pile to recycle · <b>G</b> drop`;
      else if (this.hoverNode) this.hint = `<b>F</b> hammer the loose joint · <b>Click</b> / <b>E</b> place ${name}`;
      else if (c && c.valid) this.hint = `<b>Click</b> / <b>E</b> place ${name} (${c.len.toFixed(1)} m${c.trimmed ? ', trimmed to fit' : ''}) · <b>Q/R</b> rotate · <b>Z/X</b> trim · <b>G</b> drop`;
      else this.hint = `<span class="bad">${c ? c.reason : ''}</span> · <b>Q/R</b> rotate · <b>G</b> drop`;
    } else if (pile) {
      if (pile.type === 'connector') this.hint = `Connectors live in your tool belt (${gameState.inventory.connector} left) — press <b>F</b> on a joint`;
      else {
        const n = gameState.inventory[pile.type];
        this.hint = n > 0 ? `<b>E</b> pick up ${MATERIALS[pile.type].name} (${n} left)` : `<span class="bad">No ${MATERIALS[pile.type].name}s left</span>`;
      }
    } else if (loose) {
      this.hint = `<b>E</b> pick up ${loose.piece.broken ? 'broken ' : ''}${MATERIALS[loose.piece.type].name.toLowerCase()}`;
    } else if (this.hoverNode) {
      const n = this.hoverNode;
      const loosened = this.nodeHasLoose(n);
      if (loosened) this.hint = `<b>F</b> hammer the loose joint back into place`;
      else if (!n.reinforced && gameState.inventory.connector > 0) this.hint = `<b>F</b> reinforce joint with a connector (${gameState.inventory.connector} left)`;
      else if (n.reinforced) this.hint = 'Joint reinforced ✓';
      else this.hint = '<span class="bad">No connectors left</span>';
      if (this.hoverMember) this.hint += ` · <b>E</b> take ${MATERIALS[this.solver.members.get(this.hoverMember).type].name.toLowerCase()}`;
    } else if (this.hoverMember) {
      const m = this.solver.members.get(this.hoverMember);
      this.hint = `<b>E</b> detach ${m.mat.name.toLowerCase()} to move it`;
    } else {
      this.hint = 'Walk to a material pile and press <b>E</b>';
    }

    if (beaver.jumpTarget) this.hint = `<b>Space</b> jump onto the bridge · ${this.hint}`;
    else if (beaver.swimming) this.hint = `Swimming — <b>Space</b> near the bridge or a bank to climb out · ${this.hint}`;

    this.bridge.highlightMember = this.hoverMember;
    this.bridge.highlightNode = this.hoverNode ? this.hoverNode.id : null;
    this.bridge.showJointHints = !!beaver.carried && !beaver.carried.broken;
    this.reachRing.visible = !!beaver.carried && !beaver.carried.broken;
    if (this.reachRing.visible) {
      const ch = beaver.chest();
      this.reachRing.position.set(ch.x, ch.y, 0);
    }

    // Actions
    if (beaver.busy) return;
    const click = input.takeClick();
    if (input.hit('KeyE')) this.interact(pile, loose);
    else if (click && beaver.carried) this.tryPlace();
    if (input.hit('KeyF')) this.hammer();
    if (input.hit('KeyG')) this.drop();
  }

  rotate(dir) {
    this.angle = wrap(this.angle + dir * BUILD.ROTATE_STEP);
  }

  nodeHasLoose(n) {
    for (const mid of n.members) {
      const m = this.solver.members.get(mid);
      if (m && !m.ends[m.a === n.id ? 0 : 1].rigid) return true;
    }
    for (const m of this.solver.members.values()) {
      if (m.ends[0].detachedFrom === n.id || m.ends[1].detachedFrom === n.id) return true;
    }
    return false;
  }

  findHover({ nodesOnly = false } = {}) {
    const p = this.cursor;
    const chest = this.beaver.chest();
    let bestN = null;
    let bestND = 0.6;
    for (const n of this.solver.nodes.values()) {
      if (n.members.size === 0) continue;
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < bestND && Math.hypot(n.x - chest.x, n.y - chest.y, chest.z) <= BUILD.REACH) {
        bestND = d;
        bestN = n;
      }
    }
    this.hoverNode = bestN;
    if (nodesOnly) {
      // while carrying, only offer F when the joint actually needs it
      if (bestN && !this.nodeHasLoose(bestN)) this.hoverNode = null;
      return;
    }
    let bestM = null;
    let bestMD = 0.45;
    for (const m of this.solver.members.values()) {
      const a = this.solver.nodes.get(m.a);
      const b = this.solver.nodes.get(m.b);
      const { d, t } = distPointSeg(p.x, p.y, a.x, a.y, b.x, b.y);
      if (t < 0.12 || t > 0.88) continue;
      const near = distPointSeg(chest.x, chest.y, a.x, a.y, b.x, b.y);
      if (Math.hypot(near.d, chest.z) > BUILD.REACH) continue;
      if (d < bestMD) {
        bestMD = d;
        bestM = m.id;
      }
    }
    this.hoverMember = bestM;
  }

  nearestPile() {
    const b = this.beaver.pos;
    let best = null;
    let bestD = BUILD.PILE_RADIUS;
    for (const p of this.levelBuilder.piles) {
      // piles lie along z
      const dz = Math.max(0, Math.abs(b.z - p.z) - p.halfLen);
      const d = Math.hypot(b.x - p.x, dz);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- actions

  interact(pile, loose) {
    const beaver = this.beaver;
    if (beaver.carried) {
      if (pile && (pile.type === beaver.carried.type || beaver.carried.broken)) return this.returnToPile(pile);
      if (beaver.carried.broken) return this.deny('Broken pieces can only be recycled at a pile');
      return this.tryPlace();
    }
    if (pile && pile.type !== 'connector') return this.takeFromPile(pile);
    if (loose) return this.pickUpDebris(loose);
    if (this.hoverMember != null) return this.detachMember(this.hoverMember);
    if (pile && pile.type === 'connector') return this.deny('Aim at a joint and press F to use a connector');
    this.deny('Nothing to pick up here');
  }

  takeFromPile(pile) {
    const n = gameState.inventory[pile.type];
    if (n <= 0) return this.deny(`No ${MATERIALS[pile.type].name}s left — recycle debris or reuse pieces`);
    gameState.inventory[pile.type] = n - 1;
    this.levelBuilder.updatePileVisual(pile, n - 1, MATERIALS[pile.type].name);
    this.carry({ type: pile.type, length: MATERIALS[pile.type].length, broken: false, damage: 0, parentId: null });
    this.angle = DEFAULT_ANGLE[pile.type];
    eventBus.emit(Events.INVENTORY_CHANGED);
  }

  carry(item) {
    this.trim = 0;
    this.beaver.setCarried(item);
    gameState.carried = item;
    this.beaver.playAction('pickup', 0.35, true);
    eventBus.emit(Events.ITEM_PICKED, item);
  }

  returnToPile(pile) {
    const item = this.beaver.carried;
    let refunded = false;
    if (!item.broken) {
      refunded = true;
    } else if (item.parentId != null && !this.refundedParents?.has(item.parentId)) {
      (this.refundedParents ||= new Set()).add(item.parentId);
      refunded = true;
    }
    if (refunded) {
      const targetPile = this.levelBuilder.piles.find((p) => p.type === item.type);
      gameState.inventory[item.type]++;
      this.levelBuilder.updatePileVisual(targetPile, gameState.inventory[item.type], MATERIALS[item.type].name);
    }
    this.beaver.setCarried(null);
    gameState.carried = null;
    this.beaver.playAction('place', 0.3, true);
    this.particles.chips(this.beaver.chest(), 6);
    eventBus.emit(Events.ITEM_RECYCLED, { item, refunded });
    eventBus.emit(Events.INVENTORY_CHANGED);
  }

  pickUpDebris(d) {
    const piece = d.piece;
    this.debris.remove(d);
    this.carry({ type: piece.type, length: piece.length, broken: piece.broken, damage: piece.damage || 0, parentId: piece.parentId });
    const t = this.beaver.pos;
    if (d.inWater) this.particles.splash({ x: t.x, y: GAME.WATER_Y, z: t.z });
    this.angle = DEFAULT_ANGLE[piece.type];
  }

  detachMember(id) {
    const m = this.solver.members.get(id);
    if (!m) return;
    this.solver.removeMember(id);
    this.solver.pruneDisconnected();
    this.carry({ type: m.type, length: m.restLen, broken: false, damage: m.damage, parentId: null });
    const a = this.solver.nodes.get(m.a);
    this.angle = Math.atan2(m.mat.kind === 'post' ? 1 : 0, 1);
    if (a) this.angle = DEFAULT_ANGLE[m.type];
    this.stats.removed++;
    eventBus.emit(Events.MEMBER_REMOVED, { member: m });
  }

  drop() {
    const item = this.beaver.carried;
    if (!item) return;
    const f = this.beaver.forward();
    const p = this.beaver.pos;
    this.debris.spawn(
      { ...item },
      { x: p.x + f.x * 0.9, y: this.beaver.feetY + 1.2, z: p.z + f.z * 0.9 },
      0,
      { x: f.x * 1.5, y: 1, z: f.z * 1.5 },
    );
    this.beaver.setCarried(null);
    gameState.carried = null;
    eventBus.emit(Events.ITEM_DROPPED, item);
  }

  deny(msg) {
    this.flash = msg;
    eventBus.emit(Events.PLACE_DENIED, msg);
    this.beaver.playAction('shrug', 0.4, false);
  }

  tryPlace() {
    const c = this.candidate;
    if (!c) return;
    if (!c.valid) return this.deny(c.reason);
    const item = this.beaver.carried;
    const nodeFor = (P) => {
      if (P.kind === 'node') return P.node;
      if (P.kind === 'ground') return this.solver.addNode(P.x, P.y, { fixed: true, kind: 'ground' });
      return this.solver.addNode(P.x, P.y);
    };
    const a = nodeFor(c.A);
    const b = nodeFor(c.B);
    const m = this.solver.addMember(item.type, a.id, b.id, { damage: item.damage || 0 });
    if (!m) return this.deny('Cannot place that here');
    // fly in from the shoulder
    const from = this.beaver.model.carryAnchor.getWorldPosition(new THREE.Vector3());
    this.bridge.syncTopology();
    const rec = this.bridge.members.get(m.id);
    if (rec) rec.spawn = { t: 0, x: from.x, y: from.y, z: from.z, ang: 0, yaw: this.beaver.facing - Math.PI / 2 };
    this.bridge.clearGhostsNear(a.x, a.y, b.x, b.y);
    a.failedMark = 0;
    b.failedMark = 0;
    // face the work
    const mx = (a.x + b.x) / 2;
    this.beaver.facing = Math.atan2(mx - this.beaver.pos.x, -this.beaver.pos.z);
    this.beaver.setCarried(null);
    gameState.carried = null;
    this.stats.placed++;
    eventBus.emit(Events.ITEM_PLACED, { member: m, trimmed: c.trimmed });
    const mid = new THREE.Vector3(mx, (a.y + b.y) / 2, 0);
    if (c.trimmed && item.length - c.len > 0.1) {
      this.beaver.playAction('chomp', 0.45, true);
      this.particles.chips(from, 16);
      eventBus.emit(Events.PIECE_TRIMMED, { amount: item.length - c.len });
      setTimeout(() => this.hammerFx(a, b), 450);
    } else {
      this.hammerFx(a, b);
    }
    this.particles.dust(mid, 6);
  }

  hammerFx(a, b) {
    this.beaver.playAction('hammer', BUILD.HAMMER_TIME, true);
    let i = 0;
    const tick = () => {
      if (i >= 3) return;
      const n = i % 2 === 0 ? a : b;
      eventBus.emit(Events.NODE_HAMMERED, { silent: false });
      this.particles.sparks({ x: n.x, y: n.y, z: 1.1 }, 4);
      i++;
      setTimeout(tick, BUILD.HAMMER_TIME * 330);
    };
    tick();
  }

  hammer() {
    const n = this.hoverNode;
    if (!n) return this.deny('Aim at a joint to hammer it');
    const fixed = this.solver.hammerNode(n.id);
    this.beaver.facing = Math.atan2(n.x - this.beaver.pos.x, -this.beaver.pos.z);
    if (fixed > 0) {
      this.beaver.playAction('hammer', BUILD.HAMMER_TIME, true);
      this.stats.hammered++;
      eventBus.emit(Events.NODE_HAMMERED, { node: n });
      this.particles.sparks({ x: n.x, y: n.y, z: 1.1 }, 8);
      return;
    }
    if (this.beaver.carried) return this.deny('Put the piece down to bolt on a connector');
    if (n.reinforced) return this.deny('Already reinforced');
    if (gameState.inventory.connector <= 0) return this.deny('No connectors left');
    gameState.inventory.connector--;
    const crate = this.levelBuilder.piles.find((p) => p.type === 'connector');
    if (crate) this.levelBuilder.updatePileVisual(crate, gameState.inventory.connector, 'Connectors');
    this.solver.reinforceNode(n.id);
    n.failedMark = 0;
    this.beaver.playAction('hammer', BUILD.HAMMER_TIME, true);
    this.stats.reinforced++;
    eventBus.emit(Events.NODE_REINFORCED, { node: n });
    eventBus.emit(Events.INVENTORY_CHANGED);
    this.particles.sparks({ x: n.x, y: n.y, z: 1.15 }, 14);
  }

  /**
   * Programmatic placement for tests: runs the same snapping + validation as a
   * player's click (reach is skipped — the physical path is tested separately).
   */
  debugPlace(type, ax, ay, angleDeg, freeLen = null) {
    const length = MATERIALS[type].length;
    this.beaver.setCarried({ type, length, broken: false, damage: 0, parentId: null });
    this.cursor.set(ax, ay, 0);
    this.angle = (angleDeg * Math.PI) / 180;
    this.trim = freeLen != null ? Math.max(0, length - freeLen) : 0;
    this.ignoreReach = true;
    this.candidate = this.computeCandidate();
    this.ignoreReach = false;
    const { valid, reason } = this.candidate;
    if (valid) this.tryPlace();
    this.beaver.setCarried(null);
    gameState.carried = null;
    return { ok: valid, reason };
  }
}

export { CONNECTOR };
