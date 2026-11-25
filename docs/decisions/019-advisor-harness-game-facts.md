# ADR 019: Phase 2G advisor harness and compact game facts

## Status

Accepted (Sprint 1)

## Context

Playtest Defeat −26 showed the campaign coach inventing legality and calendar facts from a full DISPATCH dump, and style gates retried LLM calls without fixing grounding. Players also queued into supply and depot traps without UI warning.

## Decision

1. **GAME_FACTS** — Before each `/api/advisor` reply, inject 5–8 engine lines from `lib/gm/advisor-game-facts.ts` (fortnight calendar, legal targets for selected/queued provinces, supply/depot/encirclement risks). Drop the full-board `renderSituation` dispatch from the coach prompt.
2. **Harness** — Structured JSON `{ stance, reply, highlightProvinceId }` with stances `probe|warn|confirm|brief` (`lib/gm/advisor-harness.ts`). Remove sentence-count / question-first post-processing on the LLM path; log harness misfires; hard checks only for safety (no orders filed, no invented odds).
3. **UI warnings** — `previewMarch` merges low-supply and depot warnings; queued orders show `supply-warning` / `depot-warning` (including thin depot garrisons); map paints `data-encirclement-risk` via `centralEncirclementRiskIds`.

Advisor GAME_FACTS omit map "reach-only" hints (neighbor topology without a current arrow); they list queued arrows, `legalTargets` orderable neighbors, Orders UI odds, supply &lt; 30, depot drain, and encirclement. Coach prompts ban robotic hedge wording; the advisor panel shows a retry banner on timeout.

## Consequences

- `FEATURES.md` and `ARCHITECTURE.md` describe the harness, not Phase 2E Socratic caps.
- `coach-eval` Layer 1 is safety-only; fixtures include playtest calendar and Kraków legality scenarios.