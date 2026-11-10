# Games to Procrastinate To

- Build a static browser game: client code only, no backend or external services.
- Repository name = game slug. Publishing URL: `https://pg-<slug>.register-c02.workers.dev/`.
- Support iframe embedding, relative asset URLs, keyboard and touch controls, widths from 360 px and landscape. Never navigate the parent window.
- Store new saves in localStorage under `pg:<slug>:`. Preserve all existing save keys and formats when maintaining a game; never reset or migrate player data without explicit instructions.
- No trackers, advertising, or unlicensed third-party assets.
- Keep `npm test` and `npm run build` passing. Existing game-specific checks must also pass.
- When playable, fill every field in `public/game.json` with English catalog text, set slug to the repository name, add `public/cover.webp` (960×600), and set status to `published`. `draft` skips deployment; `hidden` deploys without a catalog card.
- Do not change `.github/workflows/`, `wrangler.jsonc`, or the Worker name while making a game. Never add tokens or secrets to code.
- Push to `main` to publish. Check GitHub Actions for the URL and outcome; the portal refreshes automatically after deployment.
- Done means: a fresh start works, the player can win or lose and restart, controls are explained, and the browser console has no unhandled errors.
- Commit author and committer: `kifrip <25287470+kifrip@users.noreply.github.com>`.

- Read `docs/platform-project-notes.md` when present for game-specific architecture and checks.
