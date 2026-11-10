import {
  enforceTurnGuards,
  readBodyWithLimit,
  turnGuardConfig,
} from "@/lib/api/turn-guard"
import { resolveCampaignTurn } from "@/lib/campaign/resolve-turn"
import { loadStoredCampaign, persistCampaignSave } from "@/lib/campaign/store"
import { ServerTurnRequestSchema } from "@/lib/schema"

/** 120s. Fluid Compute allows 300s on Hobby. The 90s game-master budget finishes inside this. */
export const maxDuration = 120

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

  const parsed = ServerTurnRequestSchema.safeParse(body)
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
    const stored = await loadStoredCampaign(parsed.data.gameId)
    if (!stored) {
      return Response.json(
        { error: "No campaign was found for this game id.", code: "unknown_game" },
        { status: 404 },
      )
    }

    const resolved = await resolveCampaignTurn(
      { ...stored.save, gameId: parsed.data.gameId },
      parsed.data.expectedTurn,
      parsed.data.orders,
    )
    if (!resolved.ok) {
      return Response.json(
        { error: resolved.error, code: resolved.code },
        { status: resolved.status },
      )
    }

    const saved = await persistCampaignSave(parsed.data.gameId, resolved.save)
    if (!saved) {
      return Response.json({ error: "The campaign could not be saved." }, { status: 500 })
    }

    return Response.json({
      gameId: parsed.data.gameId,
      state: resolved.save.state,
      record: resolved.record,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "The turn failed."
    return Response.json({ error: message }, { status: 500 })
  }
}
