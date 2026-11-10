/**
 * Issue #26: POST /api/turn accepts full GameState from the browser with no signature.
 * Campaign play remains client-trusted for all map numbers.
 *
 * Teaching drills scope a mitigation, not a global fix:
 * - Lesson boards are built only in authoritativeLessonState() on the server.
 * - GET /api/teach/session returns that snapshot for display.
 * - POST /api/teach/resolve accepts lessonId, variant, orders, reasoning, and
 *   map selections only — never client GameState for resolution or grading.
 * - Teach attempts may be written to private blob storage when configured; the
 *   API returns persistence=confirmed only after put+head verify. There is no
 *   public read/list endpoint for attempts.
 * - Learner beliefs are extracted on the server from reasoning/prediction text;
 *   clients may pass priorAttemptId for recall only — belief ids and contents
 *   cannot be injected on POST bodies.
 * - Numeric feedback strings are taken from engine previews and resolver summaries.
 *
 * Residual risk: a client could lie in reasoning text or mis-render the map before
 * resolve; graded outcomes still use server orders against server state. Tampering
 * with unit strengths in localStorage does not affect teachResolveTurn.
 */

export type TrustAssessment = {
  scope: "teaching-lesson" | "full-campaign"
  serverAuthoritativeState: boolean
  clientStateTrustedOnResolve: boolean
  pilotBlocked: boolean
  notes: string[]
}

export function teachingTrustAssessment(): TrustAssessment {
  return {
    scope: "teaching-lesson",
    serverAuthoritativeState: true,
    clientStateTrustedOnResolve: false,
    pilotBlocked: true,
    notes: [
      "Teaching resolve ignores client GameState; campaign /api/turn still trusts client state (#26).",
      "External pilot requires campaign-level trust work or server session store.",
    ],
  }
}

export function campaignTrustAssessment(): TrustAssessment {
  return {
    scope: "full-campaign",
    serverAuthoritativeState: false,
    clientStateTrustedOnResolve: true,
    pilotBlocked: true,
    notes: [
      "Browser holds authoritative campaign state and resubmits it each turn.",
      "Guards are rate limit, size, and optional origin/token only (lib/api/turn-guard.ts).",
    ],
  }
}
