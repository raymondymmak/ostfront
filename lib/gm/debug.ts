export type GmContentState = "empty" | "present" | "n/a"

export type GmModelEnv = "LLM_MODEL" | "LLM_MODEL_STRONG"

export type GmDebug = {
  path: "llm" | "cascade"
  reason: string
  elapsedMs: number
  model: string
  modelEnv: GmModelEnv
  httpStatus: number | null
  content: GmContentState
  fallback: "staff-simulation"
}

const SECRET =
  /Bearer\s+\S+|sk-[A-Za-z0-9_-]{6,}|\bLLM_API_KEY\s*[=:]\s*\S+|api[_-]?key["']?\s*[:=]\s*["']?[^\s"']+/gi

/** Drop keys, bearer tokens, and prompt-sized blobs before anything reaches the player. */
export function sanitizeGmText(message: string): string {
  return message.replace(SECRET, "[redacted]").replace(/\s+/g, " ").trim().slice(0, 180)
}

export function formatGmDebug(debug: GmDebug): string {
  const http = debug.httpStatus == null ? "none" : String(debug.httpStatus)
  const reason = sanitizeGmText(debug.reason) || "unknown"
  const model = sanitizeGmText(debug.model) || "unknown"
  const elapsed = Number.isFinite(debug.elapsedMs) ? Math.max(0, Math.round(debug.elapsedMs)) : 0
  const detail = [
    `path ${debug.path}`,
    `abort: ${reason}`,
    `${elapsed}ms`,
    `model ${model} (${debug.modelEnv})`,
    `http ${http}`,
    `content ${debug.content}`,
    "fallback staff simulation",
  ].join(" · ")
  return `debug: ${detail}`
}
