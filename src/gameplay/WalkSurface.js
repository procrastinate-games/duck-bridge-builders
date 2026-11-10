// Where can a walker stand at a given x on the bridge plane?
// Pure logic shared by ducklings, the hippo, the beaver's load, and sim-check.

import { GAME } from '../core/Constants.js';
import { terrainHeight } from '../level/levels.js';

/**
 * @returns {{supported:boolean, y:number, member:object|null, t:number, slope:number, water:boolean}}
 */
export function findSurface(solver, level, x, yRef, stepUp, maxDrop) {
  let bestY = -Infinity;
  let bestMember = null;
  let bestT = 0;
  let bestSlope = 0;
  for (const m of solver.members.values()) {
    if (m.mat.kind !== 'deck') continue;
    const a = solver.nodes.get(m.a);
    const b = solver.nodes.get(m.b);
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    if (x < x0 - 0.05 || x > x1 + 0.05 || x1 - x0 < 0.05) continue;
    const t = (x - a.x) / (b.x - a.x);
    const tc = Math.min(1, Math.max(0, t));
    const slope = (b.y - a.y) / (b.x - a.x);
    const yTop = a.y + (b.y - a.y) * tc + (m.mat.thick / 2) * Math.sqrt(1 + slope * slope);
    if (yTop > yRef + stepUp) continue;
    if (yTop > bestY) {
      bestY = yTop;
      bestMember = m;
      bestT = tc;
      bestSlope = slope;
    }
  }
  const gy = terrainHeight(level, x, 0);
  let water = false;
  if (gy <= yRef + stepUp && gy > bestY) {
    bestY = gy;
    bestMember = null;
    bestT = 0;
    const e = 0.1;
    bestSlope = (terrainHeight(level, x + e, 0) - terrainHeight(level, x - e, 0)) / (2 * e);
    if (gy < GAME.WATER_Y + 0.05) water = true;
  }
  const supported = bestY > -Infinity && bestY >= yRef - maxDrop && !water;
  return { supported, y: bestY, member: bestMember, t: bestT, slope: bestSlope, water };
}
