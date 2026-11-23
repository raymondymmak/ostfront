# Terminal fortnights still advance the turn index

**Status:** accepted  
**Date:** 2026-11-23

## Context

`commitCampaignTurn` requires `nextSave.state.turn === expectedTurn + 1` and stores an immutable snapshot under that index. `resolveTurn` used to skip `state.turn += 1` when `decideFortnight` set a grade, so the closing fortnight (and sudden death) left the turn unchanged. The client then got **409** `stale_turn` — “Expected fortnight 5, but the resolved state is out of date.” (issue #62) — and never reached the final-map → grade flow.

## Decision

Always advance `state.turn` after recording a fortnight. When a result is set, **do not** advance `state.date`, so the final map still shows the calendar of the fortnight that closed (e.g. 11 July 1915) before the grade screen.

## Consequences

- Last-fortnight and sudden-death commits succeed; head turn matches `save.state.turn`.
- HUD fortnight counter already clamps with `Math.min(turn + 1, scenario length)`.
- Chronicle `TurnRecord.turn` / `date` still describe the fortnight that was just resolved (captured before the index bump).
