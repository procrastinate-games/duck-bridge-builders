# Milestones (minimum-viable doc mode)

Ordered; each depends on the previous one.

1. ✅ **M1 Core building** — beaver moves, picks up/carries/places/removes pieces, joints, live XPBD structure.
   AC: user walks to a pile → E picks up → carry → aim → click places → piece snaps and hammers; bridge reacts to gravity.
2. ✅ **M2 Inspection** — TEST BRIDGE → countdown → 10 ducklings → hippo; loads come from walkers; success/failure detection.
   AC: a deck-only 6 m bridge passes ducklings and fails under the hippo; a supported bridge passes the hippo.
3. ✅ **M3 Repair** — results screen, Repair keeps bridge/damage/debris; failure markers; restart clears.
   AC: after a failed hippo test, adding supports in repair mode makes the next test pass.
4. ✅ **M4 Content** — 5 levels, Relaxed + Time Challenge, scoring/stars/awards, progression, local save.
   AC: each level has a verified solvable design (scripts/sim-check.mjs); unlocks persist across reload.
5. ✅ **M5 Polish** (implemented; feel pending user playtest) — animations, audio, camera transitions, particles, celebrations, menus, settings, perf.
   AC: verified by user playtest.
