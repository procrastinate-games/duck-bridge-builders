# AGENTS.md
Project follows the game-creator `make-game` pipeline. Read `docs/STATE.md`, `docs/gameplan.md`, `docs/tech.md` first.
- Engine: Three.js 0.187 + Rapier 0.21, Vite, vanilla JS. Dev: `npm run dev` · Build: `npm run build` · Checks: `npm run sim-check`, `npm run shots`.
- Rules: EventBus for cross-module communication, GameState singleton, balance values in `src/core/Constants.js`, level data in `src/level/levels.js`.
- Test hooks: `window.render_game_to_text()`, `window.advanceTime(ms)`, `window.__GAME__.debug`, driver in `tests/helpers/driver.js`.
- Never script bridge outcomes; failures must come from the solver.
