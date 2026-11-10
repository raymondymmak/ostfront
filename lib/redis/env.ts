/** REST credentials for Upstash Redis (Vercel KV / Marketplace). */
export function redisRestCredentials(): { url: string; token: string } | null {
  const url =
    process.env.KV_REST_API_URL?.trim() || process.env.UPSTASH_REDIS_REST_URL?.trim() || ""
  const token =
    process.env.KV_REST_API_TOKEN?.trim() || process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || ""
  if (url && token) return { url, token }
  return null
}

export function redisConfigured(): boolean {
  return redisRestCredentials() !== null
}

/** Campaign keys expire after 30 days on the free tier. */
export const CAMPAIGN_TTL_SECONDS = 30 * 24 * 60 * 60
