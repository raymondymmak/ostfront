# Campaign snapshots in Vercel Blob

**Status:** accepted (to be superseded by Redis in open draft PR #45)  
**Date:** 2026-11-10 (merge commit `af10cfd`, PR #43)

## Context

Server-owned campaigns need durable storage on Vercel without operating a database. Each turn commit must avoid lost updates when two tabs close the same fortnight.

## Decision

Store under `campaigns/{gameId}/`:

- `head.json` — current turn index, seed, difficulty, metadata
- `turn-N.json` — immutable snapshot of `SaveGame` after fortnight *N*

`commitCampaignTurn` writes the new snapshot with `allowOverwrite: false`, then updates `head.json` with Blob `ifMatch` (ETag CAS). Races return HTTP 409 `storage_conflict`. Without `BLOB_READ_WRITE_TOKEN`, tests and local dev use an in-memory map; on Vercel without a token, `campaignStorageStatus()` fails closed with 503.

## Consequences

- Two Blob advanced operations per turn (put snapshot + put head) counts against Vercel Hobby advanced-op limits at scale.
- The two-step commit is not one atomic transaction: a failed head update after a successful snapshot could orphan a turn file until cleanup (motivation for PR #45).
- Teach attempt records and LLM debug logs also use Blob when configured (`lib/teach/record.ts`, `lib/gm/llm-log.ts`).
