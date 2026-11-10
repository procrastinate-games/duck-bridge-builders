import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? process.argv[2];
if (!repo || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(repo)) throw new Error('Invalid repository name');
const expected = JSON.parse(readFileSync('dist/game.json', 'utf8'));
const origin = `https://pg-${repo}.register-c02.workers.dev/`;
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    const [home, manifest] = await Promise.all([fetch(origin, { signal: AbortSignal.timeout(20000), cache: 'no-store' }), fetch(new URL(`game.json?release=${process.env.GITHUB_SHA ?? Date.now()}`, origin), { signal: AbortSignal.timeout(20000), cache: 'no-store' })]);
    if (home.status !== 200 || manifest.status !== 200) throw new Error(`HTTP ${home.status}/${manifest.status}`);
    if (!isDeepStrictEqual(await manifest.json(), expected)) throw new Error('Live game.json differs from the tested artifact');
    console.log(`Verified ${origin} and game.json`);
    process.exit(0);
  } catch (error) {
    if (attempt === 11) throw error;
    console.log(`Waiting for deployment: ${error.message}`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
