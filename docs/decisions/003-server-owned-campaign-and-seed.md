# Server-owned campaign state and RNG seed

**Status:** accepted  
**Date:** 2026-11-10 (merge commit `af10cfd`, issues #26 / PR #43)

## Context

Clients could post fabricated state or guess dice if the seed lived in the browser. Campaign progress also needed a single source of truth across reloads and devices.

## Decision

New campaigns are created via `POST /api/new-game` and stored under `lib/campaign/store.ts`. The dice seed lives only in `head.json` on the server; snapshots in turn files omit it from what the browser needs, and `stripSeedFromState` in `lib/campaign/public-state.ts` removes `seed` from every API response. Turns are submitted with `{ gameId, expectedTurn, orders }` — not full state.

The browser still mirrors `gameId` and public state in `localStorage` via `lib/storage.ts` for convenience, but `/api/game` and `/api/turn` are authoritative.

## Consequences

- Cheating by editing local JSON no longer affects adjudication (stale `expectedTurn` returns 409).
- Every turn requires server storage in production (see ADR 004).
- Advisor chat still receives client-posted state (see `ARCHITECTURE.md` trust boundaries).
