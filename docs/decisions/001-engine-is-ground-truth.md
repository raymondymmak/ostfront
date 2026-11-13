# Engine is ground truth; AI only proposes

**Status:** accepted  
**Date:** 2026-10-29 (merge commit `b5a4d5a`, PR #17)

## Context

A language model can narrate and suggest orders, but combat, supply, and victory must stay fair and reproducible. Letting a model “decide” battles would make cheating easy and debugging impossible.

## Decision

`lib/engine/` owns every state change. `lib/gm/interpret.ts` turns player text into proposals; `lib/engine/turn.ts` validates proposals and calls `lib/engine/simultaneous.ts` for battles. AI output is always a `GMTurn` (proposals, events, narration, diplomacy). The engine accepts or rejects each proposal and rolls dice from the server-held seed only.

## Consequences

- Same state, same `GMTurn`, same seed → same chronicle (covered in tests).
- Advisors and game masters can be wrong or unavailable without breaking the game.
- Product copy must not claim the LLM “plays” Russia or resolves combat.
