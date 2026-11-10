import {
  enforceTurnGuards,
  readBodyWithLimit,
  turnGuardConfig,
} from "@/lib/api/turn-guard"
import { TeachCoachRequestSchema } from "@/lib/schema"
import { teachCoachBeforeResolve } from "@/lib/teach/resolve"

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
    return Response.json({ error: "The coach request was not valid JSON." }, { status: 400 })
  }

  const parsed = TeachCoachRequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: "Invalid coach request." }, { status: 400 })
  }

  const { lessonId, variant, orders, reasoning, prediction, priorAttemptId } = parsed.data
  const outcome = await teachCoachBeforeResolve(
    lessonId,
    variant,
    orders,
    reasoning,
    prediction,
    priorAttemptId,
  )

  if (outcome.blocked) {
    return Response.json({ error: outcome.reason }, { status: 403 })
  }

  return Response.json({
    coach: outcome.coach,
    highlights: outcome.highlights,
  })
}
