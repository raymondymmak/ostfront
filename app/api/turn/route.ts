import {
  enforceTurnGuards,
  readBodyWithLimit,
  turnGuardConfig,
} from "@/lib/api/turn-guard"
import { campaignStorageStatus } from "@/lib/campaign/availability"
import { stripSeedFromState } from "@/lib/campaign/public-state"
import { resolveCampaignTurn } from "@/lib/campaign/resolve-turn"
import {
  commitCampaignTurn,
  loadStoredCampaign,
  withServerSeed,
} from "@/lib/campaign/store"
import { ServerTurnRequestSchema } from "@/lib/schema"

/** 120s. Fluid Compute allows 300s on Hobby. The 90s game-master budget finishes inside this. */
export const maxDuration = 120

const GENERIC_TURN_ERROR = "The staff could not close the fortnight. Try again in a moment."

export async function POST(request: Request) {
  const storage = campaignStorageStatus()
  if (!storage.ok) {
    return Response.json({ error: storage.error, code: storage.code }, { status: storage.status })
  }

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

    if (stored.head.turn !== parsed.data.expectedTurn) {
      return Response.json(
        {
          error: `Expected fortnight ${parsed.data.expectedTurn}, but the server holds fortnight ${stored.head.turn}. Reload or start a new campaign.`,
          code: "stale_turn",
        },
        { status: 409 },
      )
    }

    const save = {
      ...stored.save,
      gameId: parsed.data.gameId,
      state: withServerSeed(stored.save.state, stored.head.seed),
    }

    const resolved = await resolveCampaignTurn(
      save,
      parsed.data.expectedTurn,
      parsed.data.orders,
    )
    if (!resolved.ok) {
      return Response.json(
        { error: resolved.error, code: resolved.code },
        { status: resolved.status },
      )
    }

    const committed = await commitCampaignTurn(
      parsed.data.gameId,
      parsed.data.expectedTurn,
      resolved.save,
    )
    if (!committed.ok) {
      return Response.json(
        { error: committed.error, code: committed.code },
        { status: committed.status },
      )
    }

    return Response.json({
      gameId: parsed.data.gameId,
      state: stripSeedFromState(resolved.save.state),
      record: resolved.record,
    })
  } catch (error) {
    console.error("[ostfront] /api/turn failed", error)
    return Response.json({ error: GENERIC_TURN_ERROR }, { status: 500 })
  }
}
