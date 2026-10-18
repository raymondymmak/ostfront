import {
  enforceTurnGuards,
  readBodyWithLimit,
  turnGuardConfig,
} from "@/lib/api/turn-guard"
import { playTurn } from "@/lib/gm"
import { TurnRequestSchema } from "@/lib/schema"

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
    return Response.json({ error: "The turn request was not valid JSON." }, { status: 400 })
  }

  const parsed = TurnRequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      {
        error: "The turn request did not match the game schema.",
        issues: parsed.error.issues.slice(0, 6).map((issue) => issue.message),
      },
      { status: 400 },
    )
  }

  try {
    const result = await playTurn(parsed.data.state, parsed.data.orders)
    return Response.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "The turn failed."
    return Response.json({ error: message }, { status: 500 })
  }
}
