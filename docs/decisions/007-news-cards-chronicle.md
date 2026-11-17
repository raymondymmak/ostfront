# News cards and compact Chronicle

**Status:** accepted  
**Date:** 2025-11-17  

## Context

After each fortnight, the full Chronicle narration forced too much reading before the player could return to the map. Raymond wanted HOI4-style headline cards for decisive moments and one-line routine rows for logistics and income.

## Decision

Add a client-only `lib/news/` module that derives up to four `NewsEvent` cards from `prev`/`next` `GameState` plus the `TurnRecord` (no engine or API changes). `NewsCardQueue` in `game-app.tsx` shows the queue over a dimmed map; `timeline-panel.tsx` uses `routineLog()` for compact rows and tucks the legacy log behind a Details toggle. Historical photos live in `public/news/` with `CREDITS.md`; map beats use a stylized SVG vignette distinct from the live MapLibre view.

## Consequences

- Turn resolution behaviour is unchanged; news is pure presentation.
- `selectNewsEvents` must stay in sync with `TurnRecord` and objective metadata in `lib/data/objectives.ts`.
- Encirclement headlines wait for BattleFacts (part 3).