# Duck Bridge Builders

## Pitch

You are a beaver construction worker. Carry planks, beams and posts by hand, nail them into a bridge over the river, then watch ten ducklings — and one very large hippo inspector — try to cross it. When it breaks (it will), wade back in and fix it.

## Core gameplay loop

Build → Test → Observe → Repair → Improve → Retest → Succeed

1. **Walk** the beaver to a material pile, **pick up** a piece (plank, beam, post).
2. **Carry** it to the river, **aim** it (cursor + rotate), see the ghost preview snap to joints or ground.
3. **Place** it — the beaver trims it to fit and hammers it in. **Reinforce** joints with metal connectors.
4. Press **TEST BRIDGE** — countdown, then 10 ducklings cross one by one.
5. If all 10 cross, the **hippo inspector** arrives and crosses.
6. Bridge creaks, bends, joints loosen, planks snap — failures come from the simulated loads.
7. **Results** → **Repair** (bridge, damage and debris are preserved) or **Restart**, or **Next level**.

## Game rules

- Every piece is a physical object with length, mass, strength, and joint capacity.
- A new piece must start at an existing joint or on solid ground; the far end snaps to a nearby joint or ground, or stays free (cantilever).
- Joints start nailed (weak). A connector (from the tool belt) makes the joint much stronger. Overloaded joints first loosen (turn into hinges), then pull apart.
- Deck planks carry walkers. Bending under a point load grows with span — long unsupported planks snap under the hippo.
- Posts/beams carry axial load; long members buckle under compression.
- The structure is simulated continuously: it flexes under gravity and the beaver while building, but nothing loosens or breaks until the inspection (overloaded parts glow red and the HUD warns). Disconnected pieces still fall. The inspection always uses full breaking rules, so a bridge that can't hold itself fails right at the countdown.
- F re-nails loose joints even while carrying a piece; connectors need free hands.
- Broken pieces float downstream to the beaver dam; carrying debris back to the pile recycles it.
- Ducklings weigh 8 kg each, the beaver 30 kg, the hippo 950 kg (1100 kg in level 5).

## Win / lose conditions

- ⭐ some ducklings cross · ⭐⭐ all 10 ducklings cross · ⭐⭐⭐ the hippo also crosses (HIPPO APPROVED!).
- The next level unlocks at ⭐⭐. A failure never ends the run — it opens Repair.
- Time Challenge: build timer; when it reaches zero the test starts automatically. After a failure a shorter repair timer runs. Total build time feeds the score.

## Art style

Fully 3D, third-person, a tilted miniature diorama. Stylized low-poly with rounded shapes, warm saturated palette (grass greens, honey wood, sky blue water, sunny yellow ducklings, lavender hippo). Soft directional light + hemisphere fill, soft shadows, light fog. All models built in code from primitives (no external assets).

## Audio direction

Procedural Web Audio: cozy plucky pentatonic background loop, wooden knocks, hammer taps, creaks, snaps, quacks, deep hippo thumps, splashes, cheers. Separate music and SFX volume.

## Player goals

- Session: earn 3 stars per level, ideally on the first try with few materials.
- Long term: unlock and 3-star all five levels in both modes; beat personal best scores/times.

## Anti-goals

- No multiplayer, no AI opponents, no backend, no accounts.
- No automatic bridge generator, no auto-repair, no scripted outcomes.
- Not a precision CAD tool — snapping beats freeform precision.
- No mobile/touch support for v1 (desktop keyboard + mouse).

## References

- Physics bridge-building genre (truss simulation, stress colours) — mechanics only, original everything.
- Cozy diorama games for the camera and palette.

## Levels (v1 = 5)

1. Sunny Creek — 6 m gap, shallow, tutorial.
2. Forest River — 12 m gap, mid-river rock, supports needed.
3. Rocky Gorge — deep gorge, cliff ledges, limited materials.
4. Windy Valley — high crossing with wind gusts.
5. Hippo Highway — 18 m, two islets, limited materials, heavier hippo.

## Open questions

- none (decided with user 2026-11-10: Rapier, code-built models, light-doc autonomous mode).
