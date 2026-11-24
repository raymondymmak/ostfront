# Campaign shell explicit lifecycle reducer

**Status:** accepted  
**Date:** 2026-11-24

## Context

`components/game-app.tsx` encoded setup, begin-pending, turn-pending, stale campaign, and finale `resultOpen` as independent booleans. That lattice allowed illegal combinations in principle and made boot with a local snapshot missing `gameId` risky (the table could render without a server campaign). The implicit-state-machines inventory flagged this as the highest-risk client cluster.

## Decision

Add `lib/ui/campaign-shell.ts`: a small discriminated-union state machine (`setup` | `table`) with a reducer for begin, turn submit, stale, finale modal, and return-to-setup. `game-app.tsx` owns one `useReducer` plus derived selectors (`shellIsSetup`, `shellTurnBusy`, etc.). Boot calls `peekSave()` from `lib/storage.ts` (parse without requiring `gameId`) and only enters **table** when a `gameId` is present; `loadGame()` stays strict for saves and hydration.

## Consequences

- Illegal transition attempts are no-ops in the reducer (unit-tested).
- Orphan local snapshots without `gameId` land on setup, not the live map.
- `/teach` still uses its own setup flag; only the campaign app adopts this machine.
- Future work can document turn-error codes beside the same type without adding booleans.