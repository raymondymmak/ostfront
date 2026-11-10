import { coachHints, coachPrompt } from "@/lib/teach/coach"
import { authoritativeLessonState, lessonMeta } from "@/lib/teach/lessons"
import { teachingTrustAssessment } from "@/lib/teach/trust"
import { TeachSessionQuerySchema } from "@/lib/schema"

export const maxDuration = 30

export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsed = TeachSessionQuerySchema.safeParse({
    lessonId: url.searchParams.get("lessonId") ?? "converging-lublin",
    variant: url.searchParams.get("variant") ?? "guided",
  })
  if (!parsed.success) {
    return Response.json({ error: "Invalid teaching session query." }, { status: 400 })
  }

  const { lessonId, variant } = parsed.data
  const state = authoritativeLessonState(lessonId, variant)
  const meta = lessonMeta(lessonId, variant)
  const prompt = coachPrompt(meta)
  const hints = coachHints(meta, state, variant)

  return Response.json({
    meta,
    prompt,
    hints,
    state,
    trust: teachingTrustAssessment(),
    highlights: [
      { provinceId: meta.targetProvinceId, uiId: "tab-province" },
      ...meta.prongProvinceIds.map((provinceId) => ({ provinceId })),
    ],
  })
}
