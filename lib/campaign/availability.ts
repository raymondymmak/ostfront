export type CampaignStorageRefusal = {
  ok: false
  status: 503
  error: string
  code: "storage_unavailable"
}

export type CampaignStorageReady = { ok: true }

export type CampaignStorageStatus = CampaignStorageReady | CampaignStorageRefusal

export function campaignStorageStatus(): CampaignStorageStatus {
  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) return { ok: true }
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
