/**
 * Text for a failed POST /api/turn.
 *
 * The route itself returns 401 only when TURN_API_TOKEN is set and the
 * browser did not send it (`{ error: "Turn API access token is required." }`).
 * There is no turn-state signature. Vercel Authentication can also answer 401
 * before the route runs; that body is often `{ error: { message } }` or HTML,
 * which used to render as "[object Object]".
 */
export function formatTurnFailure(status: number, body: string): string {
  const detail = turnFailureDetail(body)
  return detail ? `Turn failed (${status}): ${detail}` : `Turn failed (${status}).`
}

function turnFailureDetail(body: string): string {
  const trimmed = body.trim()
  if (!trimmed) return ""
  try {
    const text = errorText(JSON.parse(trimmed) as unknown)
    if (text) return clip(text)
  } catch {
    // HTML or plain text from a host in front of the route.
  }
  const plain = trimmed
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!plain || plain === "[object Object]") return ""
  return clip(plain)
}

function errorText(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (!value || typeof value !== "object") return ""
  if (Array.isArray(value)) return value.map((item) => errorText(item)).filter(Boolean).join("; ")
  const record = value as Record<string, unknown>
  const nested = "error" in record ? errorText(record.error) : ""
  const message = typeof record.message === "string" ? record.message.trim() : ""
  const issues = Array.isArray(record.issues) ? errorText(record.issues) : ""
  const parts = [nested, message, issues].filter(Boolean)
  if (parts.length) return parts.join(": ")
  try {
    const json = JSON.stringify(value)
    return json && json !== "{}" && json !== "[]" ? json : ""
  } catch {
    return ""
  }
}

function clip(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim()
  if (!clean || clean === "[object Object]") return ""
  return clean.length > 240 ? `${clean.slice(0, 237)}...` : clean
}
