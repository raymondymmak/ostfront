import { coachHints, coachPrompt } from "@/lib/teach/coach"
import {
  authoritativeLessonState,
  lessonMeta,
  TEACH_GUIDED_COMBAT_ROLL,
  TEACH_SILENT_COMBAT_ROLL,
} from "@/lib/teach/lessons"
import { beliefRecallQuestion, loadBeliefForAttempt } from "@/lib/teach/belief"
import { teachingTrustAssessment } from "@/lib/teach/trust"
import { TeachSessionQuerySchema } from "@/lib/schema"

export const maxDuration = 30

export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsed = TeachSessionQuerySchema.safeParse({
    lessonId: url.searchParams.get("lessonId") ?? "converging-lublin",
    variant: url.searchParams.get("variant") ?? "guided",
    priorAttemptId: url.searchParams.get("priorAttemptId") ?? undefined,
  })
  if (!parsed.success) {
    return Response.json({ error: "Invalid teaching session query." }, { status: 400 })
  }

  const { lessonId, variant, priorAttemptId } = parsed.data
  const state = authoritativeLessonState(lessonId, variant)
  const meta = lessonMeta(lessonId, variant)
  const prompt = coachPrompt(meta)
  const hints = coachHints(meta, state, variant)
  const priorBelief = priorAttemptId ? await loadBeliefForAttempt(priorAttemptId) : null

  return Response.json({
    meta,
    prompt,
    hints,
    state,
    pedagogy: {
      guidedFixedRoll: TEACH_GUIDED_COMBAT_ROLL,
      silentFixedRoll: TEACH_SILENT_COMBAT_ROLL,
      disclosure:
        "Guided resolution uses a fixed die roll for teaching, not campaign randomness. Outcome numbers still come from the resolver.",
    },
    trust: teachingTrustAssessment(),
    highlights: [
      { provinceId: meta.targetProvinceId, uiId: "tab-province" },
      ...meta.prongProvinceIds.map((provinceId) => ({ provinceId })),
    ],
    beliefRecall: priorBelief
      ? {
          summary: priorBelief.belief.summary,
          key: priorBelief.belief.key,
          question: beliefRecallQuestion(priorBelief.belief),
          persistence: priorBelief.persistence,
          priorAttemptId,
        }
      : null,
  })
}
