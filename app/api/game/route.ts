import { campaignStorageStatus } from "@/lib/campaign/availability"
import { publicSavePayload } from "@/lib/campaign/public-state"
import { loadStoredCampaign, withServerSeed } from "@/lib/campaign/store"
import { CampaignQuerySchema } from "@/lib/schema"

export const maxDuration = 30

export async function GET(request: Request) {
  const storage = campaignStorageStatus()
  if (!storage.ok) {
    return Response.json({ error: storage.error, code: storage.code }, { status: storage.status })
  }

  const url = new URL(request.url)
  const parsed = CampaignQuerySchema.safeParse({ gameId: url.searchParams.get("gameId") ?? "" })
  if (!parsed.success) {
    return Response.json({ error: "A valid game id is required." }, { status: 400 })
  }

  const stored = await loadStoredCampaign(parsed.data.gameId)
  if (!stored) {
    return Response.json({ error: "No campaign was found for this game id." }, { status: 404 })
  }

  const save = {
    ...stored.save,
    state: withServerSeed(stored.save.state, stored.head.seed),
  }
  return Response.json(publicSavePayload(parsed.data.gameId, save))
}
