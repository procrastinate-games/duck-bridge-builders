> Publishing now uses [the organization GitHub Actions pipeline](docs/platform-publishing.md). This supersedes older deployment notes below.

# Duck Bridge Builders 🦫🪵🐥

A cozy 3D physics bridge-building game. You are a beaver builder: carry planks, beams and posts by hand, nail them into a bridge, then watch ten ducklings — and a very large hippo inspector — try to cross. When it breaks, wade in and repair it.

Built with Three.js + Rapier (WASM physics) + Vite, following the game-creator `make-game` workflow (see `docs/`).

## Play locally
```bash
npm install
npm run dev        # http://localhost:5180
```

## Controls
WASD move · Shift run · Space jump · Right-drag camera · Wheel zoom (rotates the carried piece) · E pick up / place / detach / return · Click place · Q/R rotate 15° · Z/X trim length · F hammer loose joint / add connector · G drop · T test bridge · Esc pause.

## How the physics works
The load-bearing bridge is a 2D XPBD frame solver (`src/systems/StructureSolver.js`): every member's axial force and every joint's moment are measured, and joints loosen, nails pull out, and planks snap/buckle when real capacities are exceeded. Rapier handles rigid debris, the beaver's character controller and falling critters. See `docs/architectural-decisions/0002-structural-simulation.md`.

## Checks
```bash
npm test            # 14 browser tests (headless Chrome; starts the dev server if needed): controls, build→fail→repair→pass, restart, debris recycling, Time Challenge, save, draw-call budget, and every level's reference designs
npm run sim-check   # builds reference designs for all 5 levels under game rules and runs the full inspection headlessly
npm run shots       # (dev server running) captures screenshots of the full build → test → repair loop into output/shots
```

## Build & deploy (Cloudflare)

Live: https://pg-duck-bridge-builders.register-c02.workers.dev

Hosted as a static-assets Cloudflare Worker, configured by `cloudflare.config.ts` and deployed with the [`cf` CLI](https://developers.cloudflare.com/cf/):

Every push to `main` is deployed automatically by Cloudflare Workers Builds: it runs `npm run sim-check`, then `npx cf deploy` to the Worker `pg-duck-bridge-builders`. To deploy by hand:

```bash
npx cf auth login   # once
npm run deploy      # = cf deploy: builds with Vite and uploads dist to Cloudflare
```

`npm run build` alone produces a plain static `dist/` (relative paths via `base: './'`), so the game also runs on any static host (GitHub Pages, Netlify, an S3 bucket). The Worker serves `index.html` for unknown paths (single-page-application mode), so refreshing never breaks. Progress is saved in `localStorage`.
