// Stars, score, awards and a friendly explanation of what went wrong.

import { SCORING, DUCKS, MATERIALS } from '../core/Constants.js';

export function bridgeCost(solver, connectorsUsed) {
  let cost = 0;
  for (const m of solver.members.values()) cost += MATERIALS[m.type].cost;
  return cost + connectorsUsed;
}

export function computeScore({ result, level, attempts, cost, buildTime, mode }) {
  const stars = result.hippo ? 3 : result.rescued >= DUCKS.COUNT ? 2 : result.rescued > 0 ? 1 : 0;
  const breakdown = [];
  let score = 0;
  const add = (label, pts) => {
    if (!pts) return;
    breakdown.push({ label, pts });
    score += pts;
  };
  add(`Ducklings rescued ×${result.rescued}`, result.rescued * SCORING.DUCK);
  if (result.rescued >= DUCKS.COUNT) add('Whole parade made it', SCORING.ALL_DUCKS);
  if (result.hippo) add('Hippo approved', SCORING.HIPPO);
  const awards = [];
  if (stars >= 2) {
    const under = Math.max(0, level.parCost - cost);
    add(`Material efficiency (${cost} / par ${level.parCost})`, under * SCORING.MATERIAL_UNDER_PAR);
    if (cost <= level.parCost) awards.push({ id: 'thrifty', name: 'Penny Pincher', desc: `Built at or under par (${cost} ≤ ${level.parCost})` });
  }
  if (result.hippo && attempts === 1) {
    add('First-try success', SCORING.FIRST_TRY);
    awards.push({ id: 'firsttry', name: 'First Try!', desc: 'Passed on the very first inspection' });
  }
  if (result.hippo && result.maxStress < SCORING.ROCK_SOLID_STRESS) {
    add('Rock-solid structure', SCORING.ROCK_SOLID);
    awards.push({ id: 'solid', name: 'Rock Solid', desc: `Peak stress only ${Math.round(result.maxStress * 100)}%` });
  }
  if (mode === 'timed' && stars >= 2) {
    const left = Math.max(0, level.timeLimit - buildTime);
    add(`Time bonus (${Math.round(left)} s to spare)`, Math.round(left * SCORING.TIME_BONUS_PER_SEC));
    if (buildTime < level.timeLimit * 0.5) awards.push({ id: 'speedy', name: 'Speedy Builder', desc: 'Finished in under half the time' });
  }
  if (attempts > 1 && stars >= 1) add(`Retests (${attempts - 1})`, -Math.min(score * 0.4, (attempts - 1) * SCORING.ATTEMPT_PENALTY));
  return { stars, score: Math.max(0, Math.round(score)), breakdown, awards };
}

const WHO = { duck: 'a duckling', hippo: 'the hippo' };

/** Turn the first failure into a headline + tip the player can act on. */
export function explainFailure(result) {
  const f = result.failure;
  const evs = result.structEvents || [];
  // the first real break explains the most; loosening is usually a symptom
  const ev = evs.find((e) => e.type === 'snap' || e.type === 'detach') || evs.find((e) => e.type === 'cluster') || evs[0];
  if (!f) return { title: 'Inspection incomplete', tip: 'Try testing again.' };
  if (f.kind === 'timeout') return { title: 'The parade got stuck', tip: 'Make sure there is a continuous deck of planks from bank to bank.' };
  const who = WHO[f.who] || 'someone';
  if (ev) {
    const name = ev.member ? ev.member.mat.name.toLowerCase() : 'piece';
    const span = ev.member ? ev.member.restLen.toFixed(1) : '?';
    switch (ev.type) {
      case 'snap':
        if (ev.reason === 'bend') {
          return {
            title: `A ${name} snapped under ${WHO[ev.src] || who}`,
            tip: `That deck spanned ${span} m with nothing underneath. Add a post or a diagonal beam below it, or use shorter planks between supports.`,
          };
        }
        if (ev.reason === 'compression') {
          return { title: `A ${name} buckled`, tip: `It was squeezed too hard for its length (${span} m). Shorter members or extra bracing keep it straight.` };
        }
        return { title: `A ${name} tore apart`, tip: 'It was stretched beyond its strength. Spread the load with more supports.' };
      case 'detach':
        return { title: 'Nails pulled out of a joint', tip: 'Joints carrying lots of tension need connectors. Aim at a joint and press F.' };
      case 'loosen':
        return {
          title: 'Joints twisted loose and the deck sagged',
          tip: 'Planks alone bend at the joints. Prop the deck with posts, or brace it with diagonal beams to make triangles. Loose joints can be re-hammered with F.',
        };
      case 'cluster':
        return { title: 'Part of the bridge lost its connection to the banks', tip: 'Every piece needs a path of joints back to an anchor on solid ground.' };
      default:
        break;
    }
  }
  if (f.reason === 'gap') return { title: `${who[0].toUpperCase()}${who.slice(1)} found a gap in the deck`, tip: 'Walkers need a continuous path of planks from one bank to the other. Check the far end is snapped to the stake.' };
  if (f.reason === 'steep') return { title: 'The deck is too steep', tip: 'Little feet need gentle slopes — keep the deck close to level.' };
  return { title: `${who[0].toUpperCase()}${who.slice(1)} fell in`, tip: 'Look for the red markers: they show where the bridge failed.' };
}
