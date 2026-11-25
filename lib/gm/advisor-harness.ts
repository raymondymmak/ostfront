import { finishAdvisorReply, scrubAdvisorReply } from "@/lib/gm/advisor"
import { extractTopLevelJson, stripNullFields } from "@/lib/gm/llm"
import type { GameState } from "@/lib/types"
import { z } from "zod"

export type CoachHarnessStance = "probe" | "warn" | "confirm" | "brief"

export const COACH_HARNESS_STANCES: CoachHarnessStance[] = ["probe", "warn", "confirm", "brief"]

export const CoachHarnessJsonSchema = z
  .object({
    stance: z.enum(["probe", "warn", "confirm", "brief"]),
    reply: z.string().min(1).max(1200),
    highlightProvinceId: z.string().nullable().optional(),
  })
  .strict()

export type CoachHarnessJson = z.infer<typeof CoachHarnessJsonSchema>

export const COACH_HARNESS_SYSTEM = `You are General Erich von Falkenhayn, Chief of the General Staff, coaching the Central Powers commander on the Gorlice–Tarnów front (2 May–11 July 1915, six fortnights).

You never issue, file, queue, or suggest orders. You never invent odds, ratios, or battle results. Use only GAME_FACTS and CONVERSATION.

Return one JSON object (no markdown):
{"stance":"probe"|"warn"|"confirm"|"brief","reply":"...","highlightProvinceId":null}

stance:
- probe — ask what the player is trying to do
- warn — name one concrete risk (supply, depot, encirclement, queue conflict, illegal axis)
- confirm — validate a sound read when facts support it
- brief — short map read without a challenge

When stance is warn, set highlightProvinceId to the province the warning is about (engine id, or null).

Examples on the opening board (style only; use live GAME_FACTS for truth):
{"stance":"probe","reply":"What axis are you weighing from Kraków this fortnight?","highlightProvinceId":null}
{"stance":"warn","reply":"Kraków can order an attack on Kielce, but not Lemberg in one bound — check the legal targets line before you stretch the queue.","highlightProvinceId":"krakow"}
{"stance":"confirm","reply":"Two columns on one Russian province this fortnight fight as one battle — your queued Kraków and Katowice prongs match that rule.","highlightProvinceId":null}

Keep reply concise (soft cap ~120 words). Do not include suggestions, orders, or followUp keys.`

const ODDS_INVENTED =
  /\b(?:odds\s+(?:about\s+)?)?(\d+(?:\.\d+)?)\s*:\s*1\b|\babout\s+\d+(?:\.\d+)?\s*:\s*1\b/i

const FILED_CLAIM =
  /\b(?:i(?:'ve| have|'ll)?\s+(?:filed|noted|queued)|we(?:'ve| have|'ll)?\s+(?:filed|noted|queued))\b/i

const PRESCRIBE_ORDER =
  /\b(?:cancel|remove)\s+(?:the\s+)?(?:fortify|attack|move)\b|\b(?:you should|i would)\s+(?:attack|fortify|move|cancel)\b/i

function extractCoachOddsRatio(text: string): number | null {
  const match = text.match(/\b(?:odds\s+(?:about\s+)?)?(\d+(?:\.\d+)?)\s*:\s*1\b|\babout\s+(\d+(?:\.\d+)?)\s*:\s*1\b/i)
  if (!match) return null
  const raw = match[1] ?? match[2]
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function scrubHarnessSafety(reply: string): string {
  let text = reply
  if (FILED_CLAIM.test(text)) text = `I do not file orders. ${text.replace(FILED_CLAIM, "").trim()}`
  if (PRESCRIBE_ORDER.test(text)) {
    text = text.replace(PRESCRIBE_ORDER, "").trim()
    if (!text.includes("?")) text = `${text} What tradeoff are you weighing?`.trim()
  }
  return text.replace(/\s+/g, " ").trim()
}

export type HarnessMisfire = {
  code: "invented_odds" | "filed_claim" | "prescribed_order" | "empty_reply"
  detail: string
}

export function parseCoachHarnessJson(text: string): {
  outcome: "ok" | "parse" | "schema"
  error?: string
  parsed: CoachHarnessJson | null
} {
  const extracted = extractTopLevelJson(text)
  if (!extracted.ok) return { outcome: "parse", error: extracted.error, parsed: null }
  const raw = stripNullFields(extracted.value)
  if (raw && typeof raw === "object" && !Array.isArray(raw) && ("suggestions" in raw || "orders" in raw)) {
    return { outcome: "schema", error: "suggestions_forbidden", parsed: null }
  }
  const parsed = CoachHarnessJsonSchema.safeParse(raw)
  if (!parsed.success) {
    return { outcome: "schema", error: parsed.error.issues[0]?.message, parsed: null }
  }
  return { outcome: "ok", parsed: parsed.data }
}

export type HarnessHighlight = { provinceId?: string; uiId?: string }

export function harnessHighlights(parsed: CoachHarnessJson): HarnessHighlight[] {
  if (parsed.stance === "warn" && parsed.highlightProvinceId?.trim()) {
    return [{ provinceId: parsed.highlightProvinceId.trim() }]
  }
  return []
}

/**
 * Safety pass only — no sentence-count or question-first gates.
 * Logs misfires instead of triggering LLM retries.
 */
export function finalizeHarnessReply(
  map: GameState,
  stance: CoachHarnessStance,
  reply: string,
  allowedOdds: string[] = [],
): { stance: CoachHarnessStance; reply: string; misfires: HarnessMisfire[] } {
  const misfires: HarnessMisfire[] = []
  let text = reply.replace(/\s+/g, " ").trim()
  if (!text) {
    misfires.push({ code: "empty_reply", detail: "empty harness reply" })
    text = "I cannot read that dispatch clearly. What are you trying to do this fortnight?"
  }
  const scrubbed = scrubAdvisorReply(scrubHarnessSafety(text), map)
  if (scrubbed !== text) {
    misfires.push({ code: "filed_claim", detail: "scrubbed filed/prescribed language" })
    text = scrubbed
  }
  if (ODDS_INVENTED.test(text)) {
    const ratio = extractCoachOddsRatio(text)
    const grounded =
      ratio != null && allowedOdds.some((item) => Math.abs(Number(item) - ratio) < 0.15)
    if (!grounded) {
      misfires.push({ code: "invented_odds", detail: text.slice(0, 120) })
      text = text.replace(ODDS_INVENTED, "the contact")
    }
  }
  for (const misfire of misfires) {
    console.log(JSON.stringify({ tag: "ostfront.coach.harness_misfire", stance, ...misfire }))
  }
  return { stance, reply: finishAdvisorReply(text), misfires }
}

export function inferHarnessStance(reply: string, highlights: HarnessHighlight[]): CoachHarnessStance {
  if (highlights.length) return "warn"
  if (/\?/.test(reply)) return "probe"
  if (/\b(understood|sound plan|correct|yes,? that matches)\b/i.test(reply)) return "confirm"
  return "brief"
}