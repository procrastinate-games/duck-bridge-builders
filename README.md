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

## Build & deploy (static, GitHub Pages)
```bash
npm run build       # outputs dist/ with relative paths (base: './')
npm run preview
```
**GitHub Actions (recommended):** push to a GitHub repo, then Settings → Pages → Source: *GitHub Actions*. `.github/workflows/deploy.yml` runs sim-check, builds and deploys on every push to `main`.

**Manual:** `npm run deploy` publishes `dist/` to the `gh-pages` branch; then set Pages → Source: *Deploy from branch → gh-pages*.

The game is a single page with no routes, so refreshing never breaks. Progress is saved in `localStorage`.
