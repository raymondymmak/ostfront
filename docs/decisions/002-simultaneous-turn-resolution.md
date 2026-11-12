# Simultaneous fortnight resolution

**Status:** accepted  
**Date:** 2026-10-29 (merge commit `b5a4d5a`, PR #17)

## Context

Sequential move-then-fight turns let the second mover exploit the first mover’s marches. The 1915 design treats both sides’ orders as locked against the same opening map.

## Decision

`resolveTurn` in `lib/engine/turn.ts` runs phases in order: fortify and shocks, then GM events, then `resolveManeuvers` in `lib/engine/simultaneous.ts` for all marches and attacks together, then supply tracing, economy, and victory. Proposal order in the list does not change combat outcomes.

## Consequences

- UI odds and the advisor describe the map at turn open, not hidden Russian marches.
- Encirclement and meeting engagements need careful rules in `simultaneous.ts` (documented in `ARCHITECTURE.md`).
- Tests such as `tests/simultaneous.test.ts` and `tests/concentric.test.ts` are the spec for edge cases.
