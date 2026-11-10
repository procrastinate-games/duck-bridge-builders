# ADR 0001: Engine, stack and art style

## Status

accepted

## Date

2026-11-10

## Context

The brief asks for a fully 3D browser game with real physics, breakable connections, animated characters, static hosting (GitHub Pages) and no backend. The user chose Rapier for physics, code-built models, and an autonomous light-doc workflow.

## Decision

Three.js (WebGL) + Vite + vanilla JS, using the game-creator Three.js architecture (EventBus, GameState, Constants, Game orchestrator). Rapier (`@dimforge/rapier3d-compat`, WASM embedded) for rigid-body physics and the character controller. All characters/props are procedural low-poly meshes with procedural animation; all audio is procedural Web Audio.

## Consequences

### Positive

- Zero external assets: instant loading, fully original, trivial static hosting.
- Rapier gives stable stacking, fast WASM and a ready character controller.

### Negative

- Character art fidelity is limited to what primitives allow.
- Rapier's JS API does not expose joint reaction forces — see ADR-0002.

## Alternatives considered

- **cannon-es:** pure JS but jittery under 100:1 mass ratios (hippo vs plank).
- **AI-generated GLB models:** needs API key/credits, less predictable style.

## Related

- ADR-0002 structural simulation.
