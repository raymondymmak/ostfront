import {
  enforceTurnGuards,
  readBodyWithLimit,
  turnGuardConfig,
} from "@/lib/api/turn-guard"
import { campaignStorageStatus } from "@/lib/campaign/availability"
import { loadStoredCampaign, withServerSeed } from "@/lib/campaign/store"
import { coachCampaign } from "@/lib/gm/campaign-coach"
import { AdvisorRequestSchema } from "@/lib/schema"

/** Same 120s ceiling as the turn route. The coach call itself stays shorter. */
export const maxDuration = 120

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

    const state = withServerSeed(stored.save.state, stored.head.seed)
    const result = await coachCampaign({
      state,
      log: stored.save.log ?? [],
      messages: parsed.data.messages,
      queuedOrders: parsed.data.queuedOrders,
      selectedProvinceId: parsed.data.selectedProvinceId,
    })
    return Response.json(result)
  } catch (error) {
    console.error("[ostfront] /api/advisor failed", error)
    return Response.json({
      reply: "I could not read the staff wire. The map is unchanged.",
      source: "fallback",
      unavailable: true,
      followUp: null,
      highlights: [],
      ordersClosed: false,
    })
  }
}
