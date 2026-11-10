import { readFileSync, appendFileSync } from 'node:fs';
import { validateManifest } from './schema.mjs';
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? process.argv[2];
if (!repo) throw new Error('Pass a repository name or set GITHUB_REPOSITORY');
const game = validateManifest(JSON.parse(readFileSync('dist/game.json', 'utf8')), repo);
const publish = game.status !== 'draft';
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publish}\n`);
console.log(publish ? `Validated ${repo}: ${game.status}` : 'Draft: checks passed; nothing will be published.');
