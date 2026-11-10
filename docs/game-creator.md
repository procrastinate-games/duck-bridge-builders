# Game Creator integration

Use [PlayableIntelligence/game-creator](https://github.com/PlayableIntelligence/game-creator) for creating and maintaining games in repositories derived from this template. This guide adapts that workflow to the owner’s existing Games to Procrastinate To platform; it does not replace the upstream game-development guidance.

## Load the workflow

1. Prefer an installed game-creator skill/plugin. The upstream setup command is `npx skills add playableintelligence/game-creator`, with optional `-a codex`, `-a claude-code` or another supported agent. Install it in the actual game’s environment when needed; do not assume a link in AGENTS.md installs or activates a skill. No installer runs in GitHub Actions.
2. If native skills are unavailable but remote files are readable, read the upstream [make-game entrypoint](https://github.com/PlayableIntelligence/game-creator/blob/main/skills/make-game/SKILL.md) and only the linked phase/sub-pipeline documents relevant to the current work. Resolve their relative links against the upstream repository. This is direct use of the documented workflow, not a claim that a native plugin was installed. If neither route is available, explain the missing access instead of inventing the skill’s rules.
3. For a short one-session game, use [viral-game](https://github.com/PlayableIntelligence/game-creator/blob/main/skills/viral-game/SKILL.md) when appropriate to the user’s request. For larger games, ongoing development or uncertain design, default to make-game, including its idea/session-start phases and project documents. The template’s draft canvas is not an approved gameplan.

Load engine, architecture, assets, design, audio and QA references as required by the chosen workflow. Keep its applicable documentation, acceptance criteria, test hooks such as render_game_to_text()/advanceTime(), and gameplay verification. Do not turn every game into a minimal arcade demo: scope and mechanics come from the user and gameplan.

## Resolve overlap explicitly

| Upstream behavior | Integration in this platform |
| --- | --- |
| Scaffold an engine starter or use an official scaffolder | Adapt the game inside this repository. If a fresh starter is necessary, generate it in a temporary sibling directory and merge its game files/dependencies deliberately. Preserve the repository/history, platform files and platform dependencies; do not blindly copy package.json or a new .github directory over them. |
| Generate or regenerate AGENTS.md during agents-bootstrap | Merge the game overview, architecture, commands and workflow rules into the existing AGENTS.md. Retain its platform contract and link to this guide. Keep CLAUDE.md and GEMINI.md as one-line pointers; do not create conflicting copies of the rules. |
| Choose an engine, language and project architecture | Follow the gameplan and upstream workflow. Vite/empty canvas are replaceable starter choices; preserve npm command aliases and a self-contained static dist/ output. A native-only or server-dependent target needs a separate hosting/architecture decision rather than silently changing this platform. |
| Deploy to here.now, GitHub Pages, Vercel, Netlify or another provider | Replace that deployment step with the existing GitHub Actions publication on main. Do not install another deploy skill, add a second publisher, create another Worker, change the Worker name, or ask for per-game deployment tokens. |
| Suggest Play.fun, sub.games, wallets, leaderboards, subscriptions, ads or gateable monetization features | Monetization is off for this platform. Skip those integrations and their feature scaffolding unless the owner explicitly changes that scope; such a change must reconcile the platform’s static/offline/privacy rules first. |
| Download/generate assets or add audio libraries | Build-time asset tools are compatible with a self-contained runtime. Use licensed local output, retain attributions and check dependency license requirements described upstream. Paid generation or a new external service requires the owner’s explicit authorization. |
| Run repeated QA phases | Preserve required gameplay/runtime checks, but use focused iteration and reuse successful evidence for unchanged code. Do not duplicate full suites locally and in CI without a concrete reason. Read concise summaries; open detailed logs for failures and screenshots for visual checks. |

These are the owner’s platform-specific integration rules. For game-development details follow the upstream workflow; for publishing follow AGENTS.md and the existing pipeline. Explicit user instructions take precedence. Surface any new incompatibility rather than silently discarding either set of requirements.

## Build and publication contract

- Keep `npm ci`, `npm test` and `npm run build` working; build emits the complete game under `dist/`. Wire meaningful game tests into npm test while retaining metadata/schema tests. Preserve pinned Wrangler and the platform smoke-test dependency when adapting package.json. Use relative asset paths (`base: './'` for Vite), iframe-safe input and responsive layout.
- Preserve `.github/workflows/`, `wrangler.jsonc` and `scripts/platform/` during game creation. Publication computes `pg-<repository-name>` and uses organization secrets.
- Fill `public/game.json` with the real game details and English catalog text; slug equals repository name. Add `public/cover.webp` at 960×600, or allow the portal screenshot fallback. Keep status draft while developing; set published when ready, or hidden to publish without a catalog card.
- Preserve all existing save keys/formats when maintaining a game. New saves use localStorage keys prefixed `pg:<slug>:`.
- Push main, then check the existing Actions run. A verified deployment requests a portal refresh automatically. Do not rebuild or redeploy the same revision through another provider.

## Structural compatibility: Duck Bridge Builders example

[Duck Bridge Builders](https://github.com/procrastinate-games/duck-bridge-builders) is a compatible Game Creator project, not a required engine starter for every game. Reviewed against its main commit 0d0d5a3 on 2026-11-10.

| Layer | What to keep or create |
| --- | --- |
| Game architecture | Game Creator supplies the game-specific layout: for Duck this is src/core, src/systems, src/gameplay, src/level and src/ui, with EventBus, GameState, Constants, Three.js and Rapier. The template's tiny src/ starter does not constrain this layout or require copying Duck's mechanics into other games. |
| Planning and continuity | Preserve existing docs/gameplan.md, docs/tech.md, docs/STATE.md, architectural decisions and milestones. In an existing game resume from these; do not rerun fresh-project scaffolding over the game or substitute upstream example engine versions for the approved stack. |
| Starter replacement | In a new game, replace src/main.js, src/rules.js and the example scene/styles as appropriate. Remove or replace tests/rules.test.js together with src/rules.js so no dangling example import remains. Preserve tests/manifest.test.js and scripts/platform/; add the actual game tests to npm test. |
| Browser build | Duck uses Vite with base './' and dist/, so it matches the publishing contract. Development/preview ports (5180/5181 in Duck), ES module layout and additional local libraries can differ. Keep browser-test server URLs aligned with the chosen ports. |
| Controls | Duck's approved v1 is desktop keyboard/mouse. Preserve that choice and the honest no-touch note in its catalog metadata. The template's mobile defaults apply to new designs, not as an instruction to add unsolicited touch controls to an existing game. |
| Saves | Duck's existing key is duck-bridge-builders-save-v1. Preserve it and its data format. The pg:<slug>: prefix is for new storage; do not rename legacy keys to make an existing game look like the template. |
| Verification | Keep Duck's sim-check and browser tests. Its publishing workflow intentionally adds the physics check and runs browser regressions against the chosen server. A new game's npm test must run its own meaningful checks, rather than only the template's helper example. |

The same separation applies to other engines: the skill owns gameplay architecture; the template keeps the publishing contract. Existing game-specific requirements govern game behavior, while platform deployment, metadata and storage-preservation requirements remain in force. If a genuine requirement cannot satisfy both, explain the specific conflict before changing scope.

## Review reference

Reviewed 2026-11-10 against upstream commit [53676bd](https://github.com/PlayableIntelligence/game-creator/tree/53676bd2a524989745ce7cbd4128c17e8a20dd3d): README, make-game, viral-game, scaffold, agents-bootstrap, live-iterate and game-qa guidance. This is a review reference, not a vendored installation or a promise that upstream main will never change. Reconcile material upstream changes when loading the skill.
