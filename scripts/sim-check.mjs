// Headless structural checks. Builds every reference design in
// tests/helpers/solutions.js under the game's placement rules (piece lengths,
// budgets, anchor slopes, build order), then runs the full duckling + hippo
// inspection through the real solver, walk logic and wind.
// Usage: node scripts/sim-check.mjs [levelId]   (exit code 1 on any mismatch)

import { StructureSolver } from '../src/systems/StructureSolver.js';
import { LEVELS, profileFn, startAnchors, terrainHeight, profileSlope, windForceFor } from '../src/level/levels.js';
import { findSurface } from '../src/gameplay/WalkSurface.js';
import { DUCKS, HIPPO, GAME, MATERIALS, BUILD } from '../src/core/Constants.js';
import { SOLUTIONS } from '../tests/helpers/solutions.js';
import { bridgeCost } from '../src/gameplay/Scoring.js';

const DT = GAME.FIXED_DT;

function buildDesign(level, design) {
  const s = new StructureSolver(profileFn(level));
  s.windForce = windForceFor(level);
  for (const a of startAnchors(level)) s.addNode(a.x, a.y, { fixed: true, kind: a.kind });
  const inv = { ...level.budget };
  const problems = [];
  const point = (p, isStart) => {
    if (p.g !== undefined) {
      const x = Math.round(p.g / BUILD.GRID) * BUILD.GRID;
      const y = terrainHeight(level, x, 0);
      const near = s.findNodeNear(x, y, BUILD.NODE_MERGE);
      if (near) return near;
      if (profileSlope(level, x) > BUILD.MAX_ANCHOR_SLOPE) problems.push(`ground at x=${x} too steep (${profileSlope(level, x).toFixed(2)})`);
      return s.addNode(x, y, { fixed: true, kind: 'ground' });
    }
    const near = s.findNodeNear(p[0], p[1], 0.3);
    if (near) return near;
    if (isStart) problems.push(`start [${p}] is not an existing joint`);
    return s.addNode(p[0], p[1]);
  };
  for (const piece of design.pieces) {
    const mat = MATERIALS[piece.type];
    if (!(inv[piece.type] > 0)) problems.push(`out of ${piece.type}`);
    inv[piece.type]--;
    const a = point(piece.a, true);
    const b = point(piece.b, false);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > mat.length + 0.05) problems.push(`${piece.type} too long: ${len.toFixed(2)} > ${mat.length}`);
    if (len < mat.minLength) problems.push(`${piece.type} too short`);
    s.addMember(piece.type, a.id, b.id);
  }
  let used = 0;
  for (const [x, y] of design.reinforce || []) {
    const n = s.findNodeNear(x, y, 0.3);
    if (!n) problems.push(`no joint to reinforce at [${x},${y}]`);
    else if (s.reinforceNode(n.id)) used++;
  }
  if (used > level.budget.connector) problems.push(`too many connectors ${used}`);
  return { s, problems, cost: bridgeCost(s, used) };
}

function settle(s, seconds) {
  for (let i = 0; i < seconds / DT; i++) {
    s.clearLoads();
    s.step(DT);
  }
}

function inspect(s, level) {
  const g = level.gap / 2;
  const events = [];
  const ducks = [];
  for (let i = 0; i < DUCKS.COUNT; i++) ducks.push({ x: -g - 1.6 - i * DUCKS.QUEUE_GAP, y: level.bankL, state: 'wait' });
  let rescued = 0;
  let t = 0;
  let failed = null;
  let duckStress = 0;
  const drain = () => {
    for (const ev of s.drainEvents()) events.push(`${ev.type}${ev.reason ? ':' + ev.reason : ''}(${ev.member?.type ?? ev.pieces?.length})`);
  };
  while (t < 140 && !failed && rescued < DUCKS.COUNT) {
    s.clearLoads();
    for (let i = 0; i < ducks.length; i++) {
      const d = ducks[i];
      if (d.state === 'done') continue;
      if (d.state === 'wait') {
        const prev = ducks[i - 1];
        if (i === 0 || prev.state === 'done' || prev.x - d.x >= DUCKS.SPACING) d.state = 'walk';
        else continue;
      }
      const nx = d.x + DUCKS.SPEED * DT;
      const surf = findSurface(s, level, nx, d.y + 0.05, DUCKS.STEP_UP, DUCKS.MAX_DROP);
      if (!surf.supported || (surf.member && Math.abs(surf.slope) > DUCKS.MAX_SLOPE)) {
        failed = { who: `duck ${i}`, x: nx, why: surf.water ? 'gap' : surf.supported ? 'steep' : 'drop' };
        break;
      }
      d.x = nx;
      d.y = surf.y;
      if (surf.member) s.addPointLoad(surf.member.id, surf.t, DUCKS.MASS, 0, 'duck');
      if (d.x > g + 1.6) {
        d.state = 'done';
        rescued++;
      }
    }
    s.step(DT);
    duckStress = Math.max(duckStress, s.maxStress());
    drain();
    t += DT;
  }
  if (failed || rescued < DUCKS.COUNT) return { rescued, hippo: false, failed, duckStress, events };

  settle(s, 1.5);
  let hippoStress = 0;
  const mass = level.hippoMass;
  let hx = -g - HIPPO.LEG_SPREAD - 1;
  let hy = level.bankL;
  let phase = 0;
  t = 0;
  while (t < 120) {
    s.clearLoads();
    hx += HIPPO.SPEED * DT;
    phase += DT / HIPPO.STEP_PERIOD;
    const legs = [hx + HIPPO.LEG_SPREAD, hx - HIPPO.LEG_SPREAD];
    const ys = [];
    for (let k = 0; k < 2; k++) {
      const surf = findSurface(s, level, legs[k], hy + 0.1, HIPPO.STEP_UP, HIPPO.MAX_DROP);
      if (!surf.supported) {
        failed = { who: 'hippo', x: legs[k], why: surf.water ? 'gap' : 'drop' };
        break;
      }
      ys.push(surf.y);
      const stepping = Math.floor(phase * 2) % 2 === k;
      const impact = stepping ? Math.max(0, Math.sin(((phase * 2) % 1) * Math.PI)) * HIPPO.STEP_IMPACT : 0;
      if (surf.member) s.addPointLoad(surf.member.id, surf.t, mass / 2, -(mass / 2) * GAME.GRAVITY * impact, 'hippo');
    }
    if (failed) break;
    hy += ((ys[0] + ys[1]) / 2 - hy) * 0.25;
    s.step(DT);
    hippoStress = Math.max(hippoStress, s.maxStress());
    drain();
    t += DT;
    if (hx - HIPPO.LEG_SPREAD > g + 1) return { rescued, hippo: true, duckStress, hippoStress, events };
  }
  return { rescued, hippo: false, failed, duckStress, hippoStress, events };
}

const only = process.argv[2] ? Number(process.argv[2]) : null;
let mismatches = 0;
for (const level of LEVELS) {
  if (only && level.id !== only) continue;
  console.log(`\n=== Level ${level.id}: ${level.name} (par ${level.parCost}, budget ${JSON.stringify(level.budget)})`);
  for (const design of SOLUTIONS[level.id] || []) {
    const { s, problems, cost } = buildDesign(level, design);
    settle(s, 3);
    const selfStress = s.maxStress();
    const pre = s.drainEvents();
    const r = inspect(s, level);
    const outcome = r.hippo ? 'hippo' : r.rescued >= DUCKS.COUNT ? 'ducks' : 'fail';
    const ok = outcome === design.expect && !problems.length && !pre.length;
    if (!ok) mismatches++;
    console.log(
      `${ok ? '✓' : '✗'} ${design.name.padEnd(34)} cost=${String(cost).padStart(2)} self=${selfStress.toFixed(2)} ` +
        `ducks=${r.rescued}/10 (${r.duckStress.toFixed(2)}) hippo=${r.hippo ? 'PASS' : 'fail'} (${(r.hippoStress ?? 0).toFixed(2)}) ` +
        `→ ${outcome} (expected ${design.expect})` +
        (r.failed ? ` [${r.failed.who}@${r.failed.x.toFixed(1)} ${r.failed.why}]` : '') +
        (pre.length ? ` PRE-TEST BREAKS: ${pre.map((e) => e.type).join(',')}` : '') +
        (problems.length ? `\n    RULES: ${problems.join('; ')}` : '') +
        (r.events.length ? `\n    events: ${r.events.slice(0, 6).join(', ')}` : ''),
    );
  }
}
console.log(mismatches ? `\n${mismatches} design(s) did not behave as expected` : '\nAll designs behave as expected');
process.exit(mismatches ? 1 : 0);
