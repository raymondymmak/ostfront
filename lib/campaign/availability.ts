import { redisConfigured } from "@/lib/redis/env"

export type CampaignStorageRefusal = {
  ok: false
  status: 503
  error: string
  code: "storage_unavailable"
}

export type CampaignStorageReady = { ok: true }

export type CampaignStorageStatus = CampaignStorageReady | CampaignStorageRefusal

export function campaignStorageStatus(): CampaignStorageStatus {
  if (redisConfigured()) return { ok: true }
  const vercelEnv = process.env.VERCEL_ENV?.trim()
  if (vercelEnv) {
    return {
      ok: false,
      status: 503,
      code: "storage_unavailable",
      error: "Campaign storage is not configured on this host. Try again later or contact the host.",
    }
  }
  return { ok: true }
}
