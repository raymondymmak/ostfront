/** Compare stored Redis value (string or auto-parsed JSON) to the written payload. */
export function redisPayloadMatches(stored: unknown, payload: string): boolean {
  if (stored === payload) return true
  if (typeof stored === "string") return stored === payload
  try {
    return JSON.stringify(stored) === payload
  } catch {
    return false
  }
}
