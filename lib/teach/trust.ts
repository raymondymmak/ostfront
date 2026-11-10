/**
 * Teaching drills scope a mitigation for graded lessons:
 * - Lesson boards are built only in authoritativeLessonState() on the server.
 * - GET /api/teach/session returns that snapshot for display.
 * - POST /api/teach/resolve accepts lessonId, variant, orders, reasoning, and
 *   map selections only — never client GameState for resolution or grading.
 * - Teach attempts may be written to private Redis when configured; the
 *   API returns persistence=confirmed only after set+get verify. There is no
 *   public read/list endpoint for attempts.
 * - Learner beliefs are extracted on the server from reasoning/prediction text;
 *   clients may pass priorAttemptId for recall only — belief ids and contents
 *   cannot be injected on POST bodies.
 * - Numeric feedback strings are taken from engine previews and resolver summaries.
 *
 * Full Gorlice campaigns (#26): state and combat seed live in private Redis; /api/turn
 * accepts only gameId, expectedTurn, and orders. Dice seeds are not exposed to the client.
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
    pilotBlocked: false,
    notes: [
      "Teaching resolve ignores client GameState; campaign play uses server Redis + gameId.",
      "Combat seeds for campaigns are server-held and omitted from API responses.",
    ],
  }
}

export function campaignTrustAssessment(): TrustAssessment {
  return {
    scope: "full-campaign",
    serverAuthoritativeState: true,
    clientStateTrustedOnResolve: false,
    pilotBlocked: false,
    notes: [
      "Campaign state and dice seed live in private Redis; /api/turn rejects client state.",
      "Guards add rate limit, size, and optional origin/token (lib/api/turn-guard.ts).",
    ],
  }
}
