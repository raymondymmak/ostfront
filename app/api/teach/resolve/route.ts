import {
  enforceTurnGuards,
  readBodyWithLimit,
  turnGuardConfig,
} from "@/lib/api/turn-guard"
import { TeachResolveRequestSchema } from "@/lib/schema"
import { stripHostileBeliefFields } from "@/lib/teach/belief"
import { teachResolveTurn, TeachResolveValidationError } from "@/lib/teach/resolve"
import { teachingTrustAssessment } from "@/lib/teach/trust"

export const maxDuration = 60

export async function POST(request: Request) {
  const { maxBody } = turnGuardConfig()
  const raw = await readBodyWithLimit(request, maxBody)
  if (!raw.ok) {
    return Response.json({ error: raw.error }, { status: raw.status })
  }

  const guard = enforceTurnGuards(request, new TextEncoder().encode(raw.text).byteLength)
  if (!guard.ok) {
    return Response.json({ error: guard.error }, { status: guard.status })
  }

  let body: unknown
  try {
    body = JSON.parse(raw.text)
  } catch {
    return Response.json({ error: "The teaching request was not valid JSON." }, { status: 400 })
  }

  if (typeof body === "object" && body !== null) {
    const hostile = stripHostileBeliefFields(body as Record<string, unknown>)
    if (hostile.length) {
      return Response.json(
        { error: "Belief fields are server-owned; omit beliefId or beliefText from the client." },
        { status: 400 },
      )
    }
  }

  const parsed = TeachResolveRequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      {
        error: "The teaching request did not match the schema.",
        issues: parsed.error.issues.slice(0, 6).map((issue) => issue.message),
      },
      { status: 400 },
    )
  }

  const { lessonId, variant, orders, reasoning, prediction, selectedProvinceIds, priorAttemptId } =
    parsed.data
  try {
    const result = await teachResolveTurn(
      lessonId,
      variant,
      orders,
      reasoning,
      prediction,
      selectedProvinceIds,
      priorAttemptId,
    )
    return Response.json({
      ...result,
      trust: teachingTrustAssessment(),
      record: result.record,
    })
  } catch (caught) {
    if (caught instanceof TeachResolveValidationError) {
      return Response.json({ error: caught.message }, { status: 400 })
    }
    throw caught
  }
}
