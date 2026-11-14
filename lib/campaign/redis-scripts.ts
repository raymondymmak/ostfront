/**
 * Atomically: verify head.turn == expectedTurn, SET NX snapshot, advance head.
 * Avoids orphan snapshots when head CAS would have failed after a Blob put.
 */
export const COMMIT_TURN_LUA = `
local headRaw = redis.call('GET', KEYS[1])
if not headRaw then
  return { 'missing' }
end
local head = cjson.decode(headRaw)
local expected = tonumber(ARGV[1])
if head.turn ~= expected then
  return { 'stale', tostring(head.turn) }
end
if redis.call('EXISTS', KEYS[2]) == 1 then
  return { 'conflict' }
end
local setSnap = redis.call('SET', KEYS[2], ARGV[3], 'NX', 'EX', tonumber(ARGV[4]))
if not setSnap then
  return { 'conflict' }
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[4]))
return { 'ok' }
`

export const CREATE_CAMPAIGN_LUA = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return { 'exists' }
end
local okHead = redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', tonumber(ARGV[3]))
if not okHead then
  return { 'exists' }
end
local okSnap = redis.call('SET', KEYS[2], ARGV[2], 'NX', 'EX', tonumber(ARGV[3]))
if not okSnap then
  redis.call('DEL', KEYS[1])
  return { 'exists' }
end
return { 'ok' }
`

export type CommitTurnLuaResult = "ok" | "missing" | "stale" | "conflict"

export function parseCommitTurnLuaReply(reply: unknown): {
  result: CommitTurnLuaResult
  currentTurn?: number
} {
  if (!Array.isArray(reply) || reply.length < 1) return { result: "conflict" }
  const tag = String(reply[0])
  if (tag === "ok") return { result: "ok" }
  if (tag === "missing") return { result: "missing" }
  if (tag === "stale") {
    const current = reply[1] != null ? Number.parseInt(String(reply[1]), 10) : undefined
    return { result: "stale", currentTurn: Number.isFinite(current) ? current : undefined }
  }
  if (tag === "conflict") return { result: "conflict" }
  return { result: "conflict" }
}
