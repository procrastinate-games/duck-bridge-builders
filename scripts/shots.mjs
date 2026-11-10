// Capture full-size screenshots of key moments for visual review.
// Usage: node scripts/shots.mjs [baseURL]   (dev server must be running)
import { chromium } from './cdp.mjs';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:5180/';
const out = 'output/shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript({ content: 'window.__MANUAL_CLOCK__ = true;' });
await page.goto(base);
await page.waitForFunction(() => window.__GAME__ && window.__GAME__.ready, null, { timeout: 30000 });
await page.evaluate(async () => {
  await import('/tests/helpers/driver.js');
});
const shot = async (name) => {
  await page.evaluate(() => window.__GAME__.step(1));
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('saved', name);
};

await page.evaluate(() => window.__GAME__.step(30));
await shot('01-menu');

const scenario = process.env.SCENARIO || 'loop';
if (scenario === 'loop') {
  await page.evaluate(() => {
    T.start(0);
    T.build('shortPlank', -3.8, 0.8, -3, 1, 0);
  });
  await shot('02-first-plank');
  await page.evaluate(() => {
    T.pickUp('shortPlank');
    T.goto(-1.6, 0.4);
    window.__GAME__.build.angle = 0;
    T.aim(-1, 1.05);
  });
  await shot('03-carry-preview');
  await page.evaluate(() => {
    window.__GAME__.input.clicked = true;
    window.__GAME__.step(60);
    T.build('shortPlank', 0.5, 1.2, 1, 1.05, 0);
    T.goto(-4.5, 1.5);
  });
  await shot('04-deck-done');
  await page.evaluate(() => {
    T.tap('KeyT');
    window.__GAME__.step(60 * 9);
  });
  await shot('05-duck-parade');
  await page.evaluate(() => {
    const g = window.__GAME__;
    for (let i = 0; i < 60 * 40 && !(g.inspection.hippo && g.inspection.hippo.state === 'inspect'); i++) g.step(1);
    g.step(30);
  });
  await shot('06-hippo-inspect');
  await page.evaluate(() => {
    const g = window.__GAME__;
    for (let i = 0; i < 60 * 30 && !(g.inspection.hippo && g.inspection.hippo.state === 'fall'); i++) g.step(1);
    g.step(20);
  });
  await shot('07-hippo-fall');
  await page.evaluate(() => {
    const g = window.__GAME__;
    for (let i = 0; i < 60 * 10 && window.__GAME_STATE__.phase !== 'results'; i++) g.step(1);
    g.step(40);
  });
  await shot('08-results-fail');
  await page.evaluate(() => {
    document.getElementById('btn-repair').click();
    const g = window.__GAME__;
    g.step(30);
    T.hammerAt(-3, 1, -4, 0.5);
    T.build('post', -1.6, 1.4, -1, -1.0, 90);
    T.build('post', 0.6, 1.4, 1, -1.0, 90);
    T.hammerAt(-1, 1, -1.5, 1.4);
    T.hammerAt(1, 1, 0.5, 1.4);
    T.goto(-4.2, 1.8);
    g.step(40);
  });
  await shot('09-repaired');
  await page.evaluate(() => {
    const g = window.__GAME__;
    T.tap('KeyT');
    g.step(2);
    for (let i = 0; i < 60 * 80 && window.__GAME__.inspection.phase !== 'celebrating'; i++) g.step(1);
    g.step(80);
  });
  await shot('10-celebrate');
} else if (scenario === 'levels') {
  await page.evaluate(async () => {
    window.SOL = (await import('/tests/helpers/solutions.js')).SOLUTIONS;
  });
  for (let i = 0; i < 5; i++) {
    await page.evaluate((i) => {
      T.start(i);
      const d = window.SOL[i + 1].find((x) => x.expect === 'hippo');
      T.buildDesign(d);
      const g = window.__GAME__;
      const lvl = g.level;
      T.goto(-lvl.gap / 2 - 3, 2);
      g.cameraRig.yaw = 0.35;
      g.cameraRig.pitch = 0.3;
      g.cameraRig.distance = lvl.gap + 6;
      g.step(120);
    }, i);
    await shot(`level-${i + 1}`);
    await page.evaluate(() => {
      const g = window.__GAME__;
      T.tap('KeyT');
      g.step(2);
      for (let k = 0; k < 60 * 80 && !(g.inspection.hippo && g.inspection.hippo.state === 'cross' && g.inspection.hippo.x > -1); k++) g.step(1);
      g.step(20);
    });
    await shot(`level-${i + 1}-hippo`);
  }
}

console.log('errors:', errors.length ? errors.slice(0, 10) : 'none');
await browser.close();
