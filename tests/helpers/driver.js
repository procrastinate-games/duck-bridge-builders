// In-page test driver: plays the game through the same input paths a player
// uses (walk to a pile, E, aim the cursor, rotate, click, F, T) with
// deterministic fixed-step time. Load with `await import('/tests/helpers/driver.js')`.

const G = () => window.__GAME__;

export const T = {
  tap(code) {
    G().input.pressed.add(code);
  },
  /** Point the mouse at a world position (re-aims while the camera settles). */
  aim(x, y, z = 0, frames = 20) {
    const g = G();
    for (let i = 0; i < frames; i++) {
      const v = new g.camera.position.constructor(x, y, z).project(g.camera);
      g.input.mouse.ndcX = v.x;
      g.input.mouse.ndcY = v.y;
      g.step(1);
    }
  },
  state() {
    return JSON.parse(window.render_game_to_text());
  },
  /** Stand somewhere (teleport = "walk there") and let the camera follow. */
  goto(x, z, frames = 40) {
    G().beaver.teleport(x, z);
    G().step(frames);
  },
  pickUp(type) {
    const g = G();
    const pile = g.levelBuilder.piles.find((p) => p.type === type);
    T.goto(pile.x, pile.z + 1.6, 6);
    T.tap('KeyE');
    g.step(30);
    return g.beaver.carried;
  },
  /** Full physical cycle for one piece. Returns the placement candidate info. */
  build(type, standX, standZ, aimX, aimY, angleDeg) {
    const g = G();
    if (!T.pickUp(type)) return { error: 'no pickup', hint: g.build.hint };
    T.goto(standX, standZ);
    g.build.angle = (angleDeg * Math.PI) / 180;
    T.aim(aimX, aimY);
    const c = g.build.candidate;
    const info = { valid: c.valid, reason: c.reason, A: c.A.kind, B: c.B.kind, len: +c.len.toFixed(2) };
    g.input.clicked = true;
    g.step(50);
    if (g.beaver.carried) {
      T.tap('KeyG');
      g.step(5);
    }
    info.members = g.solver.members.size;
    return info;
  },
  hammerAt(x, y, standX, standZ) {
    const g = G();
    T.goto(standX, standZ);
    T.aim(x, y);
    const n = g.build.hoverNode;
    T.tap('KeyF');
    g.step(45);
    return n ? { node: n.id, reinforced: n.reinforced } : { error: 'no node under cursor' };
  },
  /** Aim at a placed piece (nearest member to a point) and press E to detach and carry it. */
  takeMemberNear(x, y) {
    const g = G();
    let best = null;
    let bestD = Infinity;
    for (const m of g.solver.members.values()) {
      const a = g.solver.nodes.get(m.a);
      const b = g.solver.nodes.get(m.b);
      const d = Math.hypot((a.x + b.x) / 2 - x, (a.y + b.y) / 2 - y);
      if (d < bestD) {
        bestD = d;
        best = { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      }
    }
    if (!best) return null;
    T.goto(best.mx - 1.2, 1.4);
    T.aim(best.mx, best.my);
    T.tap('KeyE');
    g.step(30);
    return g.beaver.carried;
  },
  /** Place a reference design (tests/helpers/solutions.js) via the game's placement rules. */
  buildDesign(design) {
    const g = G();
    const pt = (p) => (p.g !== undefined ? [p.g, g.debug.ground(p.g) + 0.05] : p);
    const results = [];
    const todo = [...(design.reinforce || [])];
    // like a player: bolt each listed joint as soon as it exists
    const bolt = () => {
      for (let i = todo.length - 1; i >= 0; i--) {
        if (g.debug.reinforceAt(todo[i][0], todo[i][1])) todo.splice(i, 1);
      }
    };
    for (const piece of design.pieces) {
      const a = pt(piece.a);
      const b = pt(piece.b);
      // aim at where the joint is now (the structure may have settled a little)
      const near = (p) => {
        if (piece.a.g !== undefined && p === a) return p;
        const n = g.solver.findNodeNear(p[0], p[1], 0.6);
        return n ? [n.x, n.y] : p;
      };
      const a2 = near(a);
      const b2 = piece.b.g !== undefined ? b : near(b);
      const ang = (Math.atan2(b2[1] - a2[1], b2[0] - a2[0]) * 180) / Math.PI;
      const len = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]);
      const r = g.debug.place(piece.type, a2[0], a2[1], ang, len);
      results.push(r.ok ? 'ok' : `${piece.type} [${a2}]→[${b2}]: ${r.reason}`);
      g.step(3);
      bolt();
    }
    bolt();
    if (todo.length) results.push(`unreinforced: ${JSON.stringify(todo)}`);
    g.step(120);
    return results.filter((r) => r !== 'ok');
  },
  /** Press T and run the inspection to the results screen. */
  runTest(maxSeconds = 170) {
    const g = G();
    T.tap('KeyT');
    g.step(2);
    const timeline = [];
    let last = '';
    for (let i = 0; i < 60 * maxSeconds; i += 4) {
      g.step(4);
      const st = window.__GAME_STATE__.phase;
      const key = `${st}/${g.inspection.phase}/${window.__GAME_STATE__.ducksRescued}/${g.inspection.hippo ? g.inspection.hippo.state : '-'}`;
      if (key !== last) {
        timeline.push(`${(i / 60).toFixed(1)}s ${key} stress=${g.solver.maxStress().toFixed(2)}`);
        last = key;
      }
      if (st === 'results') break;
    }
    return timeline;
  },
  start(index = 0, mode = 'relaxed') {
    const g = G();
    g.debug.start(index, mode);
    g.debug.skipIntro();
    g.step(10);
  },
};

window.T = T;
export default T;
