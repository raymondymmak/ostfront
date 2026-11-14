# LLM responses logged to Blob for debugging

**Status:** accepted (revised 2026-11-13, PR #45)  
**Date:** 2026-10-29 (merge commit `bbf1275`, PR #21)

## Context

Game-master and advisor calls can fail on timeouts, invalid JSON, or schema rejection. Operators need forensics without blocking the player on logging I/O.

## Decision

`scheduleLlmResponseLog` in `lib/gm/llm-log.ts` may upload truncated response bodies to **private Vercel Blob** via `waitUntil` after the route returns. Structured cascade metrics always go to **stdout** (`ostfront.gm.call` / `ostfront.llm.log` lines) so Vercel function logs remain the default trail.

**Blob upload is off by default** to preserve Hobby Blob quotas:

- `LLM_LOG_BLOB=1` (or `true` / `yes`) **and** `BLOB_READ_WRITE_TOKEN`
- On **preview**, also set `LLM_LOG_BLOB_PREVIEW=1`

Without those flags, no Blob put runs on the turn or advisor request path.

## Consequences

- Production forensics rely on console logs unless an operator opts into Blob retention.
- Content is still capped (`LLM_LOG_CONTENT_LIMIT`, 50KB) and redacted before upload.
- `scripts/list-llm-logs.ts` lists Blob objects only when logging was enabled.
