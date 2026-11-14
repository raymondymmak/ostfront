# Campaign persistence on Upstash Redis

**Status:** accepted  
**Date:** 2026-11-13 (PR #45)

## Context

Vercel Blob Hobby **advanced operations** (put, copy, list) are capped at 2 000 per month. Campaign play used two puts per turn plus two per new game; LLM debug logging added more. Hitting the cap hard-blocks all Blob access for ~30 days.

The Blob design (ADR 004) also committed each turn in **two steps**: immutable `turn-N` put, then `head` CAS. A successful snapshot with a failed head update could orphan a turn file and stall the campaign.

## Decision

Store campaigns in **Upstash Redis** (REST via `@upstash/redis`) when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set (`KV_REST_API_*` accepted as aliases).

**Key layout** (TTL 30 days):

- `campaign:{gameId}:head` — JSON `CampaignHead` (authoritative `seed`, `turn`, difficulty)
- `campaign:{gameId}:turn:{n}` — JSON `TurnSnapshot` (`SaveGame` without `state.seed`)

**New game:** Lua `CREATE_CAMPAIGN_LUA` — `SET NX` on head and turn `0` together; rollback head if snapshot fails.

**Turn commit:** Lua `COMMIT_TURN_LUA` — verify `head.turn === expectedTurn`, `SET NX` snapshot, advance head in one script. Exactly one parallel writer succeeds; others get **409** `storage_conflict` or `stale_turn`.

**Fail closed:** If `VERCEL_ENV` is set and Redis creds are missing, `campaignStorageStatus()` returns **503** `storage_unavailable`. Local dev and Vitest use an in-memory map when creds are absent.

**Teach attempts and beliefs** use separate Redis keys (`teach:attempt:…`, `teach:belief:…`), not Blob.

**Blob** remains only for optional LLM response archives when explicitly enabled (ADR 005).

## Consequences

- Normal campaign play uses **zero** Blob advanced operations.
- Atomic Lua removes orphan-snapshot stuck games.
- Old Blob campaigns are not migrated; unknown or expired `gameId` → 404 or start a new game.
- Free-tier Redis size is bounded by TTL and key count; no cross-region Blob ETag semantics to reason about.

See **ARCHITECTURE.md** (turn flow, storage, 503/409).
