import { test, expect } from '../fixtures/game-test.js';

// Every reference design (tests/helpers/solutions.js) is placed through the
// game's own snapping/validation and inspected by the real duckling + hippo run.
for (let level = 1; level <= 5; level++) {
  test(`level ${level}: reference designs behave as expected`, async ({ gamePage: page }) => {
    const results = await page.evaluate((lvl) => {
      return window.SOL[lvl].map((d) => {
        T.start(lvl - 1);
        const problems = T.buildDesign(d);
        T.runTest();
        const r = T.state().lastResult;
        const outcome = r.hippo ? 'hippo' : r.rescued >= 10 ? 'ducks' : 'fail';
        return { name: d.name, expect: d.expect, outcome, problems };
      });
    }, level);
    for (const r of results) {
      expect(r.problems, r.name).toEqual([]);
      expect(r.outcome, r.name).toBe(r.expect);
    }
  });
}
