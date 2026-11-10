import { test as base, expect } from '../../scripts/browser-test.mjs';

// fresh save once per test (sessionStorage survives reloads within the same tab)
const MANUAL_CLOCK = {
  content: "window.__MANUAL_CLOCK__ = true; try { if (!sessionStorage.getItem('dbb-test')) { localStorage.clear(); sessionStorage.setItem('dbb-test', '1'); } } catch {}",
};

async function boot(page) {
  await page.waitForFunction(() => window.__GAME__ && window.__GAME__.ready && document.querySelector('canvas'), null, { timeout: 30000 });
  await page.evaluate(async () => {
    await import('/tests/helpers/driver.js');
    window.SOL = (await import('/tests/helpers/solutions.js')).SOLUTIONS;
  });
}

export const test = base.extend({
  /** Deterministic game (manual clock, fresh save) with the test driver loaded as window.T. */
  gamePage: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.addInitScript(MANUAL_CLOCK);
    await page.goto('/');
    await boot(page);
    page.errors = errors;
    await use(page);
  },
});

export async function state(page) {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text()));
}

export async function step(page, frames) {
  await page.evaluate((n) => window.__GAME__.step(n), frames);
}

export { expect, boot };
