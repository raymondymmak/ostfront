import {
  enforceTurnGuards,
  readBodyWithLimit,
  turnGuardConfig,
} from "@/lib/api/turn-guard"
import { advise } from "@/lib/gm/advisor"
import { AdvisorRequestSchema } from "@/lib/schema"

export const maxDuration = 30

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
    return Response.json({ error: "The advisor request was not valid JSON." }, { status: 400 })
  }

  const parsed = AdvisorRequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      {
        error: "The advisor request did not match the game schema.",
        issues: parsed.error.issues.slice(0, 6).map((issue) => issue.message),
      },
      { status: 400 },
    )
  }

  try {
    const result = await advise({
      state: parsed.data.state,
      messages: parsed.data.messages,
      queuedOrders: parsed.data.queuedOrders,
    })
    return Response.json(result)
  } catch {
    return Response.json({
      reply: "The chief of staff is unavailable offline. The map is unchanged.",
      source: "rules",
      unavailable: true,
      suggestions: [],
      dropped: 0,
      ordersClosed: Boolean(parsed.data.state.result),
    })
  }
}
