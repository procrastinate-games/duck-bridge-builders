import { chromium } from '@playwright/test';
import { serveBuild } from './serve.mjs';
const server = await serveBuild();
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
  await page.goto(server.url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  const ready = await page.evaluate(() => {
    const canvas = [...document.querySelectorAll('canvas')].some(el => el.width > 0 && el.height > 0 && el.getBoundingClientRect().width > 0);
    const root = document.querySelector('#app, #root, main');
    return canvas || !!root?.innerText.trim();
  });
  if (!ready) throw new Error('No canvas or nonempty game root');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Production browser smoke passed: visible game, no unhandled errors or failed assets.');
} finally { await browser?.close(); await server.close(); }
