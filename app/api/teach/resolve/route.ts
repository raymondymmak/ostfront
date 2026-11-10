import {
  enforceTurnGuards,
  readBodyWithLimit,
  turnGuardConfig,
} from "@/lib/api/turn-guard"
import { TeachResolveRequestSchema } from "@/lib/schema"
import { teachResolveTurn } from "@/lib/teach/resolve"
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

  const { lessonId, variant, orders, reasoning, selectedProvinceIds } = parsed.data
  const result = await teachResolveTurn(lessonId, variant, orders, reasoning, selectedProvinceIds)

  return Response.json({
    ...result,
    trust: teachingTrustAssessment(),
    record: result.record,
  })
}
