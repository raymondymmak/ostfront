import {
  enforceTurnGuards,
  readBodyWithLimit,
  turnGuardConfig,
} from "@/lib/api/turn-guard"
import { createStoredCampaign } from "@/lib/campaign/store"
import { NewGameRequestSchema } from "@/lib/schema"

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
    return Response.json({ error: "The new-game request was not valid JSON." }, { status: 400 })
  }

  const parsed = NewGameRequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      {
        error: "The new-game request did not match the schema.",
        issues: parsed.error.issues.slice(0, 6).map((issue) => issue.message),
      },
      { status: 400 },
    )
  }

  try {
    const created = await createStoredCampaign(parsed.data.difficulty)
    return Response.json({
      gameId: created.gameId,
      state: created.save.state,
      log: created.save.log,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start a new campaign."
    return Response.json({ error: message }, { status: 500 })
  }
}
