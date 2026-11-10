import { loadStoredCampaign } from "@/lib/campaign/store"
import { CampaignQuerySchema } from "@/lib/schema"

export const maxDuration = 30

export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsed = CampaignQuerySchema.safeParse({ gameId: url.searchParams.get("gameId") ?? "" })
  if (!parsed.success) {
    return Response.json({ error: "A valid game id is required." }, { status: 400 })
  }

  const stored = await loadStoredCampaign(parsed.data.gameId)
  if (!stored) {
    return Response.json({ error: "No campaign was found for this game id." }, { status: 404 })
  }

  return Response.json({
    gameId: stored.gameId,
    state: stored.save.state,
    log: stored.save.log,
  })
}
