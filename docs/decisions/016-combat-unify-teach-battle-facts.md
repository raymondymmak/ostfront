# Unify combat resolution and teach grading on BattleFacts

**Status:** accepted  
**Date:** 2026-11-24

## Context

`lib/engine/turn.ts` exported a full `applyAttack` implementation beside the live simultaneous resolver (`resolveManeuvers`). Advisor dry-runs and `tests/combat.test.ts` used the duplicate path, so tests could diverge from real fortnights. Teaching feedback (`lib/teach/feedback.ts`, `supply-feedback.ts`) parsed odds, rolls, and outcomes from resolution summary strings.

## Decision

- Replace `applyAttack` with a thin wrapper that delegates to `resolveManeuvers` (fixed d6 via `fixedRollRng` in `lib/rng.ts`).
- Extend `BattleFacts` with pre-roll combat inputs and outcomes (`attack`, `defense`, `ratio`, `roll`, `launchSupply`, `pooledSupply`) populated in `resolveManeuvers`.
- Teach grading reads assault battles through `lib/teach/battle-from-record.ts` and `battleForProvince`; no regex on summaries.

## Consequences

- Combat tests and advisor legality checks exercise the same model as campaign and `/teach` resolve.
- Battle metadata is richer for news and teaching; older saves without `battle` still load; new resolutions always carry the full fact set when a battle line is emitted.