# ADR 0002: Hybrid structural simulation (XPBD frame + Rapier)

## Status

accepted

## Date

2026-11-10

## Context

Bridge failure must come from simulated loads, and the player must be able to understand why it failed. That needs the force in every member and every joint. Rapier's JS API exposes no joint reaction impulses, so breakable Rapier joints would have to guess stress from constraint drift, which is noisy and makes failures look random.

## Decision

The load-bearing bridge is simulated by our own **2D XPBD frame solver** (`systems/StructureSolver.js`) in the bridge's vertical plane (x–y, z = 0):

- Nodes have position + rotation; members are distance constraints (axial force = λ/h²); each member end is a rigid-joint angle constraint (moment = λ/h²).
- Fixed timestep 1/60 s with 16 substeps, light damping.
- Failure: joint moment over capacity → joint loosens to a hinge; end tension over pull-out → member detaches; axial over strength/buckling → member snaps; deck bending from walker point loads (M = F·a·b/L) → plank snaps.
- Walkers (beaver, ducklings, hippo) add their mass and weight to member end nodes by position along the member, including footstep dynamics.

**Rapier** handles everything that is a free rigid body: terrain/rock colliders, kinematic colliders that mirror every intact member each frame (so the beaver can walk on the bridge), debris and detached pieces, dropped materials, falling ducklings/hippo, and the beaver's KinematicCharacterController.

Bridges look 3D: planks are 2.2 m wide decks, beams/posts render as twin side rails at z = ±1.05.

## Consequences

### Positive

- Exact, explainable forces → stress colours, readable failure reasons, deterministic results.
- Very stable for heavy loads (hippo) with cheap cost (< 100 members).

### Negative

- The structure is planar; out-of-plane sway (wind) is cosmetic.
- Two physics representations must be kept in sync (member → kinematic collider; broken member → Rapier debris body).

## Alternatives considered

- **Rapier impulse joints with drift-based break detection:** noisy, unexplainable failures.
- **Scripted collapse:** forbidden by the brief.
