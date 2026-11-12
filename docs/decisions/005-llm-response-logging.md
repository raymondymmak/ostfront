# LLM responses logged to Blob for debugging

**Status:** accepted  
**Date:** 2026-10-29 (merge commit `bbf1275`, PR #21)

## Context

Game-master and advisor calls can fail on timeouts, invalid JSON, or schema rejection. Operators need forensics without blocking the player on logging I/O.

## Decision

`scheduleLlmResponseLog` in `lib/gm/llm-log.ts` uploads truncated response bodies to private Blob paths via `waitUntil` after the route returns. Structured cascade metrics go to stdout through `logGmCall` in `lib/gm/route-log.ts`.

## Consequences

- Logging is best-effort; missing `BLOB_READ_WRITE_TOKEN` skips upload silently in dev.
- Content is capped (`LLM_LOG_CONTENT_LIMIT`, 50KB) before upload.
- Scripts such as `scripts/list-llm-logs.ts` help inspect production logs offline.
