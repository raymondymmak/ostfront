# Campaign Chief of Staff is a coach, not an order clerk

**Status:** accepted  
**Date:** 2026-11-23

## Context

Phase 2E round 1. The Chief of Staff (`POST /api/advisor`) used to return up to three Accept/Override order cards and trusted a full `GameState` from the browser. That invited cheating, mixed coaching with issuing orders, and let the model invent odds that belonged on engine cards.

## Decision

- **Coach only:** replies are prose (+ optional follow-up and map/UI highlights). The JSON schema rejects `suggestions` / order objects. The panel has no Accept, Override, or duplicate cards.
- **Server truth:** the route loads the campaign by `gameId` (and checks `expectedTurn`) like `/api/turn`, merges the head seed for dispatch, and never returns the seed.
- **Grounding:** odds, supply, and battle results come from `buildSituation` and chronicle `TurnRecord` / `BattleFacts` lines. Highlights use catalog province ids or known interface ids — never screen pixels.
- **Socratic brevity:** replies are capped to 2–3 sentences (prompt + post-processing); when intent is unknown the coach asks one short question first, then cites one engine fact with one highlight. Quoted attack odds use the same `engagementOdds` / `combinedEngagementOdds` preview as `resolveTurn` after `staffMap` supply decay/capacity — one figure, phrased “about X:1 if the Russians don't reinforce” (enemy moves unknown). Never claim an order was filed/noted/queued.
- **On demand:** the coach speaks only when the player asks (starters or typed send).

Out of scope for this ADR: side practice drills (2E round 2) and deeper enemy AI / rail moves (round 3).

## Consequences

- Clients must send `gameId` + `expectedTurn`; legacy bodies with `state` get **400**.
- Demo-check and FEATURES drop Accept-card steps; map QA uses `data-coach-highlights`.
- `lib/gm/advisor.ts` still builds the dispatch; `lib/gm/campaign-coach.ts` owns the coach prompt and response shape.
