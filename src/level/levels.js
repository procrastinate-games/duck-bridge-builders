// Level data + the analytic terrain height function shared by visuals,
// Rapier colliders and the structure solver. Pure JS (no three.js).

export const LEVELS = [
  {
    id: 1,
    name: 'Sunny Creek',
    tagline: 'A gentle stream. Learn to build, test and repair.',
    gap: 6,
    bankL: 1.0,
    bankR: 1.0,
    depth: 1.3,
    bankRun: 1.1,
    features: [],
    budget: { shortPlank: 8, longPlank: 4, beam: 6, post: 4, connector: 10 },
    parCost: 9,
    timeLimit: 240,
    repairTime: 120,
    hippoMass: 950,
    wind: 0,
    tutorial: true,
    theme: { grass: 0x86cc5e, tint: 0xffffff, trees: 18, flowers: 160 },
  },
  {
    id: 2,
    name: 'Forest River',
    tagline: 'A wider river. One span is not enough — prop it up.',
    gap: 12,
    bankL: 1.2,
    bankR: 1.2,
    depth: 2.1,
    bankRun: 1.4,
    features: [{ type: 'rock', x: 0.2, top: -0.15, r: 1.5 }],
    budget: { shortPlank: 10, longPlank: 6, beam: 12, post: 4, connector: 14 },
    parCost: 22,
    timeLimit: 320,
    repairTime: 150,
    hippoMass: 950,
    wind: 0,
    theme: { grass: 0x6dbb55, tint: 0xf4fff0, trees: 42, flowers: 110 },
  },
  {
    id: 3,
    name: 'Rocky Gorge',
    tagline: 'Deep cliffs. Brace the deck from the rock ledges.',
    gap: 10,
    bankL: 4.0,
    bankR: 4.0,
    depth: 2.6,
    bankRun: 0.35,
    features: [
      { type: 'ledge', x: -5, dir: 1, y: 1.7, w: 1.3 },
      { type: 'ledge', x: 5, dir: -1, y: 1.7, w: 1.3 },
    ],
    budget: { shortPlank: 6, longPlank: 3, beam: 9, post: 2, connector: 10 },
    parCost: 28,
    timeLimit: 330,
    repairTime: 150,
    hippoMass: 950,
    wind: 0,
    theme: { grass: 0x9cc35a, tint: 0xfff4e6, trees: 14, flowers: 60, rocky: true },
  },
  {
    id: 4,
    name: 'Windy Valley',
    tagline: 'High and breezy. Gusts shake loose anything wobbly.',
    gap: 14,
    bankL: 4.5,
    bankR: 4.5,
    depth: 2.4,
    bankRun: 2.6,
    features: [{ type: 'pillar', x: 0, top: 1.6, r: 0.9 }],
    budget: { shortPlank: 10, longPlank: 6, beam: 20, post: 4, connector: 20 },
    parCost: 56,
    timeLimit: 380,
    repairTime: 170,
    hippoMass: 950,
    wind: 1,
    theme: { grass: 0x8fcf6b, tint: 0xeef6ff, trees: 22, flowers: 90, windy: true },
  },
  {
    id: 5,
    name: 'Hippo Highway',
    tagline: 'The long one. Two islets, a tight budget, a hungry hippo.',
    gap: 18,
    bankL: 1.8,
    bankR: 1.8,
    depth: 2.5,
    bankRun: 1.5,
    features: [
      { type: 'rock', x: -4.6, top: -0.1, r: 1.5 },
      { type: 'rock', x: 4.6, top: -0.1, r: 1.5 },
    ],
    budget: { shortPlank: 11, longPlank: 4, beam: 14, post: 4, connector: 15 },
    parCost: 44,
    timeLimit: 450,
    repairTime: 180,
    hippoMass: 1150,
    wind: 0,
    theme: { grass: 0x7ac75b, tint: 0xfff0e0, trees: 30, flowers: 140, sunset: true },
  },
];

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Cheap deterministic value noise for terrain undulation
function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise2(x, z) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi);
  const b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1);
  const d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Half-width of the gap at depth z (straight near the bridge, meandering away). */
export function gapHalf(level, z = 0) {
  const meander = smoothstep(5, 16, Math.abs(z)) * (Math.sin(z * 0.19 + level.id) * 1.3 + Math.sin(z * 0.07) * 1.6);
  return level.gap / 2 + meander;
}

/**
 * Terrain height at (x, z). At z = 0 this is the exact profile the solver uses.
 */
export function terrainHeight(level, x, z = 0) {
  const g = gapHalf(level, z);
  const ax = Math.abs(x);
  const bankTop = x < 0 ? level.bankL : level.bankR;
  const bedY = -level.depth;
  let y;
  if (ax >= g) {
    // Bank top: flat near the edge, gently rolling further out
    const away = ax - g;
    // keep the building site and the parade route flat
    const flatSite = Math.max(smoothstep(7, 12, Math.abs(z)), smoothstep(12, 20, away));
    const roll = smoothstep(1.5, 8, away) * (noise2(x * 0.18, z * 0.18) - 0.35) * 1.6 * flatSite;
    const rise = smoothstep(10, 30, away) * 3.5;
    y = bankTop + roll + rise;
  } else if (ax >= g - level.bankRun) {
    const t = (g - ax) / level.bankRun;
    y = bankTop + (bedY - bankTop) * smoothstep(0, 1, t);
  } else {
    const inner = g - level.bankRun;
    const c = Math.cos((Math.PI * x) / (2 * inner));
    y = bedY * (0.7 + 0.3 * c);
  }
  // Features only shape the terrain near the bridge line
  const near = 1 - smoothstep(3.5, 7, Math.abs(z));
  for (const f of level.features) {
    if (near <= 0) break;
    const dx = x - f.x;
    if (f.type === 'rock') {
      const d2 = (dx * dx + z * z * 0.6) / (f.r * f.r);
      if (d2 < 1.6) {
        const h = f.top - d2 * 1.4;
        y = Math.max(y, h);
      }
    } else if (f.type === 'pillar') {
      const d = Math.hypot(dx, z * 0.9);
      const h = d < f.r ? f.top : f.top - (d - f.r) * 7;
      y = Math.max(y, h);
    } else if (f.type === 'ledge') {
      // Rock shelf sticking out of the cliff wall into the gap
      const inside = (x - f.x) * f.dir; // 0 at the wall, grows into the gap
      if (inside > -0.5 && inside < f.w && Math.abs(z) < 3.2) {
        const edge = 1 - smoothstep(f.w - 0.25, f.w, inside);
        const zEdge = 1 - smoothstep(2.6, 3.2, Math.abs(z));
        y = Math.max(y, bedY + (f.y - bedY) * Math.min(edge, zEdge));
      }
    }
  }
  return y;
}

/** Ground profile along the bridge plane (z = 0) — the solver's world. */
export function profileFn(level) {
  return (x) => terrainHeight(level, x, 0);
}

/** Slope magnitude |dy/dx| of the profile — anchors need gentle ground. */
export function profileSlope(level, x) {
  const e = 0.08;
  return Math.abs(terrainHeight(level, x + e, 0) - terrainHeight(level, x - e, 0)) / (2 * e);
}

/** Bank-edge anchors every level starts with. */
export function startAnchors(level) {
  const g = level.gap / 2;
  return [
    { x: -g, y: level.bankL, kind: 'stake' },
    { x: g, y: level.bankR, kind: 'stake' },
  ];
}

/** Wind load (N per metre of member) for windy levels; null when calm. */
export function windForceFor(level) {
  if (!level.wind) return null;
  return (m, t) => {
    const gust = 0.55 + 0.45 * Math.sin(t * 0.55) * Math.sin(t * 1.37 + 1.2);
    const W = 85 * level.wind * gust;
    return { fx: W * 0.6, fy: W * Math.sin(t * 2.3 + m.id * 0.7) };
  };
}
