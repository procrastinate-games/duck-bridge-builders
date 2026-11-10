import { test, expect, state, step, boot } from '../fixtures/game-test.js';

test.describe('Duck Bridge Builders — core loop', () => {
  test('boots to the main menu without errors', async ({ gamePage: page }) => {
    const s = await state(page);
    expect(s.phase).toBe('menu');
    expect(await page.evaluate(() => document.getElementById('menu').classList.contains('show'))).toBe(true);
    expect(page.errors).toEqual([]);
  });

  test('Play starts level 1 in build mode with the HUD', async ({ gamePage: page }) => {
    await page.evaluate(() => document.getElementById('btn-play').click());
    await step(page, 30);
    const s = await state(page);
    expect(s.phase).toBe('build');
    expect(s.level.id).toBe(1);
    expect(s.inventory.shortPlank).toBe(8);
    expect(await page.evaluate(() => !document.getElementById('hud').classList.contains('hidden'))).toBe(true);
  });

  test('WASD moves the beaver', async ({ gamePage: page }) => {
    await page.evaluate(() => T.start(0));
    const before = (await state(page)).beaver;
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' })));
    await step(page, 60);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' })));
    const after = (await state(page)).beaver;
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(1.5);
  });

  test('the beaver walks across a built deck without getting stuck', async ({ gamePage: page }) => {
    const r = await page.evaluate(() => {
      const g = window.__GAME__;
      const results = [];
      for (const lvl of [1, 2, 5]) {
        T.start(lvl - 1);
        T.buildDesign(window.SOL[lvl].find((d) => d.expect === 'hippo'));
        const gx = g.level.gap / 2;
        g.cameraRig.yaw = 0; // D walks toward +x
        g.beaver.teleport(-gx - 2, 0);
        g.step(20);
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
        const loaded = new Set();
        for (let i = 0; i < 60 * 12 && g.beaver.pos.x < gx + 2; i++) {
          g.step(1);
          if (g.beaver.groundMemberId != null) loaded.add(g.beaver.groundMemberId);
        }
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' }));
        results.push({ lvl, x: g.beaver.pos.x, far: gx + 2, planksStoodOn: loaded.size, swimming: g.beaver.swimming });
      }
      return results;
    });
    for (const x of r) {
      expect(x.x, `level ${x.lvl}`).toBeGreaterThanOrEqual(x.far);
      expect(x.planksStoodOn, `level ${x.lvl}`).toBeGreaterThan(2);
      expect(x.swimming, `level ${x.lvl}`).toBe(false);
    }
  });

  test('nothing breaks while building; an overlong overhang fails at the inspection', async ({ gamePage: page }) => {
    const r = await page.evaluate(() => {
      const g = window.__GAME__;
      const key = (c, d) => window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code: c }));
      T.start(1); // Forest River: 12 m gap
      for (let x = -6; x < 4; x += 2) g.debug.place('shortPlank', x, 1.2, 0, 2); // 10 m overhang, no supports
      g.step(60 * 6); // let it settle
      const tip = () => [...g.solver.nodes.values()].filter((n) => !n.fixed).reduce((a, b) => (b.x > a.x ? b : a));
      const restY = tip().y;
      g.cameraRig.yaw = 0;
      g.beaver.teleport(-8, 0);
      g.step(20);
      key('KeyD', 1);
      let maxX = -99;
      for (let i = 0; i < 60 * 8 && g.beaver.pos.x < 2.5; i++) {
        g.step(1);
        maxX = Math.max(maxX, g.beaver.pos.x);
      }
      key('KeyD', 0);
      key('KeyA', 1);
      for (let i = 0; i < 60 * 8 && g.beaver.pos.x > -8; i++) g.step(1);
      key('KeyA', 0);
      g.step(180);
      const loose = [...g.solver.members.values()].some((m) => m.ends.some((e) => !e.rigid));
      const warning = document.getElementById('feedback').textContent;
      const springBack = Math.abs(tip().y - restY);
      T.tap('KeyT');
      g.step(60 * 2.5); // still in the countdown
      const failedEarly = g.inspection.structEvents.length > 0 && window.__GAME_STATE__.phase === 'countdown';
      return { maxX, loose, springBack, warning, failedEarly };
    });
    expect(r.maxX).toBeGreaterThan(1.5); // walked out near the tip
    expect(r.loose).toBe(false);
    expect(r.springBack).toBeLessThan(0.05);
    expect(r.warning).toContain("can't hold their own weight");
    expect(r.failedEarly).toBe(true);
  });

  test('the beaver can leap out of the water onto the bridge', async ({ gamePage: page }) => {
    const r = await page.evaluate(() => {
      const g = window.__GAME__;
      T.start(0);
      T.buildDesign(window.SOL[1].find((d) => d.expect === 'hippo'));
      g.beaver.teleport(-1.6, 2.2); // swimming beside the deck
      g.beaver.facing = Math.PI; // facing the bridge
      g.step(40);
      const before = { swimming: g.beaver.swimming, hint: g.build.hint };
      T.tap('Space');
      g.step(80);
      return { before, onDeck: g.beaver.onDeck, swimming: g.beaver.swimming };
    });
    expect(r.before.swimming).toBe(true);
    expect(r.before.hint).toContain('jump onto the bridge');
    expect(r.swimming).toBe(false);
    expect(r.onDeck).toBe(true);
  });

  test('walking is smooth: no stalls on grass, even motion on a 120 Hz display', async ({ gamePage: page }) => {
    const r = await page.evaluate(() => {
      const g = window.__GAME__;
      T.start(0);
      g.cameraRig.yaw = 0;
      g.beaver.teleport(-15, 3);
      g.step(20);
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
      g.step(30);
      let stalls = 0;
      let last = g.beaver.pos.x;
      for (let i = 0; i < 120; i++) {
        g.step(1);
        if (Math.abs(g.beaver.pos.x - last) < 0.01) stalls++;
        last = g.beaver.pos.x;
      }
      // 120 Hz frames over 60 Hz physics, with interpolation
      g.beaver.teleport(-15, 3);
      g.step(30);
      const xs = [];
      for (let f = 0; f < 60; f++) {
        g.acc += 1 / 120;
        while (g.acc >= 1 / 60) {
          g.fixedUpdate(1 / 60);
          g.acc -= 1 / 60;
        }
        g.alpha = g.acc * 60;
        g.renderFrame(1 / 120, false);
        xs.push(g.beaver.model.root.position.x);
      }
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' }));
      const d = xs.slice(1).map((x, i) => x - xs[i]);
      return { stalls, spread: Math.max(...d) - Math.min(...d) };
    });
    expect(r.stalls).toBe(0);
    expect(r.spread).toBeLessThan(0.01);
  });

  test('pick up, aim, rotate and place a plank by hand', async ({ gamePage: page }) => {
    const r = await page.evaluate(() => {
      T.start(0);
      const carried = T.pickUp('shortPlank');
      const g = window.__GAME__;
      const a0 = g.build.angle;
      T.tap('KeyR');
      g.step(2);
      const rotated = g.build.angle !== a0;
      T.tap('KeyQ');
      g.step(2);
      // far away: placement is refused with a reason
      T.goto(-14, 3);
      T.aim(-3, 1);
      const far = g.build.candidate.reason;
      T.goto(-3.8, 0.8);
      T.aim(-3, 1);
      const c = g.build.candidate;
      g.input.clicked = true;
      g.step(50);
      return { carried: !!carried, rotated, far, valid: c.valid, startKind: c.A.kind, members: g.solver.members.size, inv: window.__GAME_STATE__.inventory.shortPlank };
    });
    expect(r.carried).toBe(true);
    expect(r.rotated).toBe(true);
    expect(r.far).toContain('Too far');
    expect(r.valid).toBe(true);
    expect(r.startKind).toBe('node');
    expect(r.members).toBe(1);
    expect(r.inv).toBe(7);
  });

  test('build → fail → repair → retest → hippo approved', async ({ gamePage: page }) => {
    const first = await page.evaluate(() => {
      T.start(0);
      T.build('shortPlank', -3.8, 0.8, -3, 1, 0);
      T.build('shortPlank', -1.5, 1.2, -1, 1.05, 0);
      T.build('shortPlank', 0.5, 1.2, 1, 1.05, 0);
      T.runTest();
      return T.state();
    });
    expect(first.lastResult.rescued).toBe(10);
    expect(first.lastResult.hippo).toBe(false);
    expect(first.lastResult.stars).toBe(2);
    expect(first.bridge.members.length).toBe(3); // bridge preserved, not reset

    const second = await page.evaluate(() => {
      document.getElementById('btn-repair').click();
      const g = window.__GAME__;
      g.step(5);
      const phase = window.__GAME_STATE__.phase;
      // like a player: re-nail the bank joints (pieces get lifted back), put any
      // plank that fell into the river back in place, then add supports + bolts
      T.hammerAt(-3, 1, -4, 0.5);
      g.step(30);
      const fallen = [...g.solver.members.values()].find((m) => {
        const a = g.solver.nodes.get(m.a);
        const b = g.solver.nodes.get(m.b);
        return Math.min(a.y, b.y) < 0.6;
      });
      if (fallen) {
        const a = g.solver.nodes.get(fallen.a);
        const b = g.solver.nodes.get(fallen.b);
        T.takeMemberNear((a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      T.hammerAt(3, 1, 4, 0.5);
      g.step(30);
      if (g.beaver.carried) {
        T.goto(-1.5, 1.4);
        g.build.angle = 0;
        T.aim(-1, 1.02);
        g.input.clicked = true;
        g.step(50);
      }
      T.build('post', -1.6, 1.4, -1, -1.0, 90);
      T.build('post', 0.6, 1.4, 1, -1.0, 90);
      T.hammerAt(-1, 1, -1.5, 1.4);
      T.hammerAt(1, 1, 0.5, 1.4);
      T.runTest();
      return { phase, s: T.state() };
    });
    expect(second.phase).toBe('build');
    expect(second.s.bridge.members.length).toBe(5);
    expect(second.s.attempts).toBe(2);
    expect(second.s.lastResult.hippo).toBe(true);
    expect(second.s.lastResult.stars).toBe(3);
    expect(second.s.unlocked).toBe(2);

    // progress survives a reload
    await page.goto('/');
    await boot(page);
    expect((await state(page)).unlocked).toBe(2);
  });

  test('restart clears the bridge and refills the piles', async ({ gamePage: page }) => {
    const r = await page.evaluate(() => {
      T.start(0);
      T.build('shortPlank', -3.8, 0.8, -3, 1, 0);
      const before = window.__GAME__.solver.members.size;
      window.__GAME__.debug.restart();
      window.__GAME__.step(5);
      return { before, after: window.__GAME__.solver.members.size, inv: window.__GAME_STATE__.inventory.shortPlank };
    });
    expect(r.before).toBe(1);
    expect(r.after).toBe(0);
    expect(r.inv).toBe(8);
  });

  test('broken pieces float to the dam and can be recycled once', async ({ gamePage: page }) => {
    const r = await page.evaluate(() => {
      const g = window.__GAME__;
      T.start(0);
      T.buildDesign(window.SOL[1].find((d) => d.name.startsWith('long plank')));
      T.runTest();
      const broken = g.debris.items.filter((d) => d.piece.broken).length;
      document.getElementById('btn-repair').click();
      g.step(60 * 4);
      const before = window.__GAME_STATE__.inventory.longPlank;
      const pile = g.levelBuilder.piles.find((p) => p.type === 'longPlank');
      for (let k = 0; k < 2 && g.debris.items.length; k++) {
        const p = g.debris.items[0].body.translation();
        g.beaver.teleport(p.x + 0.5, p.z + 0.5);
        g.step(20);
        T.tap('KeyE');
        g.step(30);
        T.goto(pile.x, pile.z + 1.6, 10);
        T.tap('KeyE');
        g.step(30);
      }
      return { broken, refunded: window.__GAME_STATE__.inventory.longPlank - before };
    });
    expect(r.broken).toBe(2);
    expect(r.refunded).toBe(1);
  });

  test('Time Challenge starts the inspection when the clock runs out', async ({ gamePage: page }) => {
    const r = await page.evaluate(() => {
      const g = window.__GAME__;
      T.start(0, 'timed');
      const t0 = window.__GAME_STATE__.timer;
      g.step(120);
      const elapsed = t0 - window.__GAME_STATE__.timer;
      window.__GAME_STATE__.timer = 0.2;
      g.step(30);
      return { elapsed, phase: window.__GAME_STATE__.phase };
    });
    expect(r.elapsed).toBeCloseTo(2, 1);
    expect(r.phase).toBe('countdown');
  });

  test('draw calls stay within budget during the parade', async ({ gamePage: page }) => {
    const calls = await page.evaluate(() => {
      const g = window.__GAME__;
      T.start(3);
      T.buildDesign(window.SOL[4].find((d) => d.expect === 'hippo'));
      T.tap('KeyT');
      g.step(60 * 10);
      g.renderer.render(g.scene, g.camera); // tests skip drawing; render one frame to count
      return g.renderer.info.render.calls;
    });
    expect(calls).toBeLessThan(400);
  });
});
