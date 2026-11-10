# Tech stack

## Engine / runtime

- **Engine:** Three.js 0.187 (WebGLRenderer) — browser
- **Language(s):** JavaScript (ES modules)
- **Target platforms:** Desktop web (Chrome, Safari, Firefox; Apple Silicon)

## Libraries / frameworks

| Library | Version | Purpose |
|---------|---------|---------|
| three | ^0.187.0 | Rendering, scene graph, materials |
| @dimforge/rapier3d-compat | ^0.21.0 | Rigid bodies (debris, dropped pieces, falling characters), colliders, beaver character controller, raycasts |
| vite | ^8 | Dev server and static build |

## Tooling

- **Package manager:** npm
- **Build:** Vite (`base: './'` so the build works from any GitHub Pages sub-path)
- **Testing:** `node --test` + `scripts/browser-test.mjs` (Chrome DevTools protocol, from game-creator) for browser tests; `scripts/sim-check.mjs` for headless structural-solver checks
- **Linting / formatting:** n/a
- **Asset / binary storage:** no binary assets — everything is procedural (no Git LFS)

## Project layout

```
src/
  core/        Game.js (orchestrator, fixed-step loop), EventBus.js, GameState.js, Constants.js
  systems/     InputSystem, PhysicsWorld (Rapier), StructureSolver (XPBD frame), CameraRig,
               AudioManager, ParticleSystem, SaveSystem
  gameplay/    Beaver, BuildController, Bridge (members/nodes visuals+colliders), Inspection,
               Walker/Duckling/Hippo, Debris, Scoring
  level/       levels.js (data), LevelBuilder (terrain, water, decor, piles), models.js (procedural models)
  ui/          UI.js (menus, HUD, results, settings, tutorial)
  main.js
```

## Conventions

- **Code naming:** PascalCase classes/files, camelCase members, SCREAMING_CASE constants.
- **State machines:** game phase string in `GameState.phase` (`menu | build | countdown | ducks | hippo | results | paused`).
- **Events:** `domain:action` names in `EventBus.Events`.
- **Config:** balance numbers in `Constants.js`; per-level data in `level/levels.js`.
- **Test hooks:** `window.render_game_to_text()`, `window.advanceTime(ms)`, `window.__GAME__`.

## Out-of-scope dependencies

- No TypeScript, no UI framework, no post-processing, no external model/audio files.
- No cannon-es / ammo.js (Rapier chosen, ADR-0001).
