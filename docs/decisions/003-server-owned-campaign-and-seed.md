# Server-owned campaign state and RNG seed

**Status:** accepted  
**Date:** 2026-11-10 (merge commit `af10cfd`, issues #26 / PR #43)

## Context

Clients could post fabricated state or guess dice if the seed lived in the browser. Campaign progress also needed a single source of truth across reloads and devices.

## Decision

New campaigns are created via `POST /api/new-game` and stored under `lib/campaign/store.ts`. The combat seed is **authoritative in `CampaignHead`** (Redis `campaign:{gameId}:head` since PR #45). Before resolution the server merges it with `withServerSeed`. **Turn snapshots omit `state.seed`** (`snapshotSave`); only the head holds the RNG secret. Every browser-visible JSON passes through `stripSeedFromState` in `lib/campaign/public-state.ts`, so API responses never expose the seed. Turns are submitted with `{ gameId, expectedTurn, orders }` — not full state.

The browser still mirrors `gameId` and public state in `localStorage` via `lib/storage.ts` for convenience, but `/api/game` and `/api/turn` are authoritative.

## Consequences

- Cheating by editing local JSON no longer affects adjudication (stale `expectedTurn` returns 409).
- Every turn requires server storage in production (see ADR 006).
- Advisor chat still receives client-posted state (see `ARCHITECTURE.md` trust boundaries).
