import { CATALOG_BY_ID } from "@/lib/data/catalog"
import { scenarioSpec } from "@/lib/data/objectives"
import { formatDate } from "@/lib/format"
import { renderAdvisorGameFacts, resolveDeicticUserMessage } from "@/lib/gm/advisor-game-facts"
import {
  COACH_HARNESS_SYSTEM,
  finalizeHarnessReply,
  harnessHighlights,
  inferHarnessStance,
  parseCoachHarnessJson,
  type CoachHarnessJson,
  type CoachHarnessStance,
} from "@/lib/gm/advisor-harness"
import { buildSituation, staffMap, type Situation } from "@/lib/gm/advisor"
import { assessManeuvers } from "@/lib/engine/simultaneous"
import {
  combinedEngagementOdds,
  engagementOdds,
  findProvince,
  findUnit,
  type EngagementPreview,
} from "@/lib/engine/turn"
import { playerOrdersToQueued } from "@/lib/orders"
import { legalTargets } from "@/lib/ui/legal-targets"
import { formatUiOddsForAdvisor } from "@/lib/ui/odds-band"
import type { AdvisorChatMessage } from "@/lib/gm/advisor-types"
import { llmChatChain, llmConfigured } from "@/lib/gm/llm"
import { CAMPAIGN_COACH_JSON_SCHEMA } from "@/lib/gm/providers"
import { scheduleLlmResponseLog } from "@/lib/gm/llm-log"
import { provinceLabel } from "@/lib/news/battle"
import { routineLog } from "@/lib/news/routine-copy"
import type { BattleFacts, GameState, PlayerOrder, TurnRecord } from "@/lib/types"

const COACH_TIMEOUT_MS = 22_000
/** Browser abort for `/api/advisor` — slightly above server coach budget. */
export const CLIENT_ADVISOR_TIMEOUT_MS = 32_000
const COACH_CONVERSATION_LIMIT = 8
const COACH_MESSAGE_MAX_CHARS = 480
/** Keep headroom for reasoning models that spend tokens before writing content. */
const COACH_MAX_TOKENS = 2_048
const COACH_MAX_SENTENCES = 3
const COACH_REPLY_MAX_CHARS = 420

/** Campaign UI ids the coach may point at (never screen pixels). */
export const CAMPAIGN_COACH_UI_IDS = [
  "tab-orders",
  "tab-province",
  "chronicle-log-toggle",
  "legend-toggle",
  "advisor-toggle",
  "ohl-toggle",
  "map-mode-supply",
  "map-mode-control",
  "map-mode-unrest",
  "map-mode-resources",
  "attack-odds",
  "combined-odds",
  "queued-orders",
  "end-turn",
  "war-map",
] as const

export type CoachHighlight = { provinceId?: string; uiId?: string }

export type CampaignCoachResponse = {
  reply: string
  stance: CoachHarnessStance
  source: "llm" | "rules" | "fallback"
  unavailable: boolean
  followUp: string | null
  highlights: CoachHighlight[]
  ordersClosed: boolean
  /** Present only so clients can assert the schema forbids order cards. */
  suggestions?: never
}

function coachAllowedOddsTrimmed(map: GameState, queued: PlayerOrder[]): string[] {
  const trimmed: string[] = []
  const pushRatio = (ratio: number) => {
    if (!Number.isFinite(ratio)) return
    trimmed.push((Math.round(ratio * 10) / 10).toFixed(1).replace(/\.0$/, ""))
  }
  const attacks = queued.filter(
    (order): order is Extract<PlayerOrder, { type: "attack" }> => order.type === "attack",
  )
  const byTarget = new Map<string, Extract<PlayerOrder, { type: "attack" }>[]>()
  for (const order of attacks) {
    const list = byTarget.get(order.target) ?? []
    list.push(order)
    byTarget.set(order.target, list)
  }
  for (const order of attacks) {
    const preview = engagementOdds(map, order.from, order.target, order.unitIds)
    if (preview) pushRatio(preview.ratio)
  }
  for (const [targetId, orders] of byTarget) {
    if (orders.length < 2) continue
    const preview = combinedEngagementOdds(
      map,
      targetId,
      orders.map((order) => ({ fromId: order.from, unitIds: order.unitIds })),
    )
    if (preview) pushRatio(preview.ratio)
  }
  for (const contact of buildSituation(map, queued).contacts) {
    pushRatio(contact.ratio)
  }
  return [...new Set(trimmed)]
}

function rulesToHarness(
  map: GameState,
  rules: { reply: string; highlights: CoachHighlight[] },
  allowedOdds: string[],
): { stance: CoachHarnessStance; reply: string; highlights: CoachHighlight[] } {
  const highlights = rules.highlights.slice(0, 1)
  const stance = inferHarnessStance(rules.reply, highlights)
  const finalized = finalizeHarnessReply(map, stance, rules.reply, allowedOdds)
  return { stance: finalized.stance, reply: finalized.reply, highlights }
}

export async function coachCampaign(input: {
  state: GameState
  log: TurnRecord[]
  messages: AdvisorChatMessage[]
  queuedOrders: PlayerOrder[]
  selectedProvinceId?: string | null
}): Promise<CampaignCoachResponse> {
  const queued = input.queuedOrders.filter((order) => order.type !== "text")
  const map = staffMap(input.state)
  const situation = buildSituation(map, queued)
  const chronicle = renderChronicle(input.log)
  const rules = rulesCoach(
    map,
    situation,
    renderSelected(map, input.selectedProvinceId),
    input.selectedProvinceId ?? null,
    input.log,
    input.messages,
    queued,
  )
  const ordersClosed = situation.over

  const conversation = trimAdvisorConversation(
    input.messages.map((message) =>
      message.role === "user"
        ? {
            ...message,
            content: resolveDeicticUserMessage(message.content, map, input.selectedProvinceId),
          }
        : message,
    ),
  )
  const gameFacts = renderAdvisorGameFacts(map, queued, input.selectedProvinceId)
  const queueConflicts = detectQueuedOrderConflicts(map, queued)
  const allowedOdds = coachAllowedOddsTrimmed(map, queued)

  if (!llmConfigured() && !fixtureEnabled()) {
    const harnessed = rulesToHarness(map, rules, allowedOdds)
    return {
      reply: harnessed.reply,
      stance: harnessed.stance,
      source: "fallback",
      unavailable: true,
      followUp: null,
      highlights: harnessed.highlights,
      ordersClosed,
    }
  }

  const prompt = [
    "GAME_FACTS",
    gameFacts.join("\n"),
    "",
    "QUEUE_CONFLICTS",
    queueConflicts.length ? queueConflicts.map((item) => item.detail).join("\n") : "None.",
    "",
    "CHRONICLE",
    chronicle,
    "",
    "CONVERSATION",
    renderConversation(conversation),
    "",
    "Answer the latest player message using GAME_FACTS and CHRONICLE only. Do not invent odds or file orders.",
  ].join("\n")

  let parsedHarness: CoachHarnessJson | null = fixtureEnabled()
    ? {
        stance: inferHarnessStance(rules.reply, rules.highlights),
        reply: rules.reply,
        highlightProvinceId: rules.highlights[0]?.provinceId ?? null,
      }
    : null

  if (!fixtureEnabled()) {
    const chat = await llmChatChain({
      system: COACH_HARNESS_SYSTEM,
      user: prompt,
      timeoutMs: COACH_TIMEOUT_MS,
      maxTokens: COACH_MAX_TOKENS,
      temperature: 0.3,
      gameTurn: map.turn,
      gameDate: map.date,
      kind: "advisor",
      allowFailover: false,
      jsonSchema: { name: "campaign_coach", schema: CAMPAIGN_COACH_JSON_SCHEMA },
      accept: (content) => {
        const judged = parseCoachHarnessJson(content)
        if (judged.parsed) return { ok: true }
        console.log(
          JSON.stringify({
            tag: "ostfront.coach.harness_misfire",
            code: judged.outcome,
            detail: judged.error ?? "invalid harness JSON",
          }),
        )
        return {
          ok: false,
          outcome: judged.outcome === "parse" ? "invalid_json" : "schema",
          error: judged.error ?? "invalid harness JSON",
        }
      },
    })
    console.log(
      JSON.stringify({
        tag: "ostfront.coach.call",
        provider: chat.provider,
        model: chat.model,
        latencyMs: chat.latencyMs,
        outcome: chat.ok ? "ok" : chat.kind,
      }),
    )
    if (chat.ok) {
      const judged = parseCoachHarnessJson(chat.content)
      parsedHarness = judged.parsed
      scheduleLlmResponseLog({
        kind: "advisor",
        attempt: chat.exchange.attempt,
        gameTurn: map.turn,
        gameDate: map.date,
        provider: chat.provider,
        model: chat.model,
        latencyMs: chat.exchange.latencyMs,
        httpStatus: chat.exchange.httpStatus,
        finishReason: chat.exchange.finishReason,
        usage: chat.exchange.usage,
        content: chat.exchange.content,
        outcome: judged.outcome === "ok" ? "ok" : judged.outcome === "parse" ? "invalid_json" : "schema",
        error: judged.error,
        fellBack: judged.outcome !== "ok",
      })
    } else if (chat.kind === "timeout") {
      console.log(
        JSON.stringify({
          tag: "ostfront.coach.timeout",
          provider: chat.provider,
          latencyMs: chat.latencyMs,
          promptChars: prompt.length,
          messageCount: conversation.length,
        }),
      )
    }
  }

  if (!parsedHarness) {
    const harnessed = rulesToHarness(map, rules, allowedOdds)
    return {
      reply: harnessed.reply,
      stance: harnessed.stance,
      source: "rules",
      unavailable: false,
      followUp: null,
      highlights: harnessed.highlights,
      ordersClosed,
    }
  }

  const highlights = harnessHighlights(parsedHarness)
  const finalized = finalizeHarnessReply(map, parsedHarness.stance, parsedHarness.reply, allowedOdds)
  if (!finalized.reply.trim()) {
    const harnessed = rulesToHarness(map, rules, allowedOdds)
    return {
      reply: harnessed.reply,
      stance: harnessed.stance,
      source: "rules",
      unavailable: false,
      followUp: null,
      highlights: harnessed.highlights,
      ordersClosed,
    }
  }
  return {
    reply: finalized.reply,
    stance: finalized.stance,
    source: fixtureEnabled() ? "rules" : "llm",
    unavailable: false,
    followUp: null,
    highlights: highlights.length ? highlights : capCoachHighlights(rules.highlights),
    ordersClosed,
  }
}

/** Split prose into sentences without treating decimal points (e.g. 5.8:1) as endings. */
export function splitCoachSentences(text: string): string[] {
  const parts: string[] = []
  let buf = ""
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!
    buf += ch
    if (ch !== "." && ch !== "!" && ch !== "?") continue
    const prev = text[i - 1]
    const next = text[i + 1]
    if (ch === "." && prev && /\d/.test(prev) && next && /\d/.test(next)) continue
    const trimmed = buf.trim()
    if (trimmed) parts.push(trimmed)
    buf = ""
  }
  const tail = buf.trim()
  if (tail) parts.push(tail)
  return parts
}

/** Drop raw supply ledger pairs (e.g. "159 against 56") — whole sentences only, never mid-clause fragments. */
export function scrubCoachLedgerNoise(reply: string): string {
  const out: string[] = []
  for (const sentence of splitCoachSentences(reply)) {
    const before = sentence
    const cleaned = sentence
      .replace(
        /\s*(?:,|;|:)?\s*(?:and\s+)?(?:(?:the|our|their)\s+)?over[- ]supply(?:\s+of|\s+line(?:\s+reads)?)?\s+\d+\s+against\s+(?:their\s+)?\d+/gi,
        "",
      )
      .replace(/\b\d{2,3}\s+against\s+\d{2,3}\b/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,;:.!?])/g, "$1")
      .trim()
    // Only drop when scrubbing gutted the sentence; keep short intentional sentences.
    if (!cleaned) continue
    if (cleaned !== before.trim() && cleaned.length < 12) continue
    out.push(cleaned)
  }
  return out.join(" ").trim()
}

/**
 * Rewrite forbidden dice phrasing on every reply path (LLM may copy DISPATCH
 * "before the dice" from advisor formatOdds). Dedupe the reinforce clause.
 */
export function scrubCoachOddsLanguage(reply: string): string {
  let out = reply.replace(/\bbefore the dice\b/gi, "if the Russians don't reinforce")
  out = out.replace(
    /(?:\s*if the Russians don't reinforce)+\b/gi,
    " if the Russians don't reinforce",
  )
  out = out.replace(/\s{2,}/g, " ").replace(/\s+([,;:.!?])/g, "$1").trim()
  return out
}

/**
 * Plain map/staff language — strip residual dice/UI jargon and robotic continuity scolding.
 */
export function scrubCoachJargon(reply: string): string {
  let out = reply
  out = out.replace(
    /\bwhat did you expect the dice to (?:give|show|do)(?:\s+you)?\b/gi,
    "what outcome did you expect",
  )
  out = out.replace(/\bexpect(?:ed)? the dice\b/gi, "expect the result")
  out = out.replace(/\bthe dice\b/gi, "the result")
  out = out.replace(/\bcombined-odds board\b/gi, "combined odds on the Orders paper")
  out = out.replace(
    /\bthe figure you cite does not appear in my staff figures\b/gi,
    "I do not see that figure on the map dispatch",
  )
  out = out.replace(/\bin my staff figures\b/gi, "on the map dispatch")
  out = out.replace(/\sstaff figures\b/gi, "map figures")
  out = out.replace(/\bthe objective the map sets\b/gi, "OHL's objective")
  out = out.replace(/\bobjective the map sets\b/gi, "OHL's objective")
  out = out.replace(/\bThe map shows that\b/g, "")
  out = out.replace(/\bThe map shows\b/g, "")
  out = out.replace(/\bthe map shows that\b/gi, "")
  out = out.replace(/\bthe map shows\b/gi, "")
  out = out.replace(/\s{2,}/g, " ").replace(/\s+([,;:.!?])/g, "$1").trim()
  // Recapitalize after stripping a "The map shows" prefix mid-reply.
  out = out.replace(/(^|[.!?]\s+)([a-z])/g, (_, edge: string, letter: string) => `${edge}${letter.toUpperCase()}`)
  return out
}

/** Never leave raw fort-level game labels in player-facing coach copy. */
export function scrubCoachFortLabels(reply: string): string {
  return reply
    .replace(/\bfort\s+1\b/gi, "a fort")
    .replace(/\bfort\s+2\b/gi, "two forts")
    .replace(/\bfort\s+3\b/gi, "three forts")
    .replace(/\bfort\s+(\d+)\b/gi, (_, n: string) => `${n} forts`)
}

/** Round odds figures to one decimal (or a whole number) for staff speech. */
export function scrubCoachOddsDecimals(reply: string): string {
  return reply.replace(/(\d+\.\d+)\s*:\s*1\b/g, (_, raw: string) => `${trimRatio(raw)}:1`)
}

/** Cut points when stripping a second odds figure (broader than the verbless check). */
const SUBORDINATE_STARTER =
  /\s+(?:when|while|whereas|compared to|against|versus|than)\b/i

/** Verbless check only: post-odds comparison shapes, not ordinary when/than prose. */
const VERBLESS_SUBORDINATE_STARTER = /\s+(?:when|while|whereas|compared to)\b/i

const FINITE_VERB_IN_CLAUSE =
  /\b(?:offers?|stands?|sits?|is|are|was|were|has|have|had|holds?|held|remains?|lies?|lay|does|do|did|can|could|will|would|should|must|needs?|takes?|took|cracks?|swings?|marches?|grinds?|accepts?|keeps?|stays?|comes?|goes?|gets?|makes?|leaves?|falls?|fell|reaches?|reached|reinforces?|reinforced|attacks?|attacked|defends?|defended)\b/i

const OPENING_QUESTION =
  /^(?:Do you|Does |Did |What |Which |Who |How |Why |Where |When )\b/i

function looksLikeOpenQuestion(sentence: string): boolean {
  return OPENING_QUESTION.test(sentence.trim())
}

function finishCoachSentence(body: string, wasQuestion: boolean): string {
  const cleaned = body.replace(/[,;:\s]+$/, "").trim()
  if (!cleaned) return ""
  if (wasQuestion) {
    const stem = cleaned.replace(/[.!?…]+$/, "").trim()
    return stem ? `${stem}?` : ""
  }
  if (/[.!?]$/.test(cleaned)) return cleaned
  return `${cleaned}.`
}

/**
 * True when a trailing when/while/whereas/compared-to clause after an odds
 * figure has no finite verb (e.g. "…at about 2.2:1 when Kielce, taken by…").
 * Ordinary prose ("Lemberg falls when the Russians reinforce") is not flagged.
 */
export function hasVerblessTrailingSubordinate(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  const match = trimmed.match(
    /(?:\d+(?:\.\d+)?\s*:\s*1)\b[^?]{0,100}?(when|while|whereas|compared to)\b([\s\S]*)$/i,
  )
  if (!match) return false
  const tail = (match[2] ?? "").replace(/[.!?…]+$/, "").trim()
  if (!tail) return true
  return !FINITE_VERB_IN_CLAUSE.test(tail)
}

/** Opening interrogative skeleton that lost its question mark. */
export function hasMissingQuestionMark(text: string): boolean {
  const first = (splitCoachSentences(text)[0] ?? text).trim()
  if (!first || /\?/.test(first)) return false
  return looksLikeOpenQuestion(first)
}

/** True when prose ends on a truncated preposition/clause after odds scrubbing. */
export function hasDanglingCoachClause(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  // Bare preposition/truncated tail at the end of the sentence.
  if (/\b(?:to|at|only|from|by|into|toward|towards|than|versus|vs)\s*[.!?…]*$/i.test(trimmed)) {
    return true
  }
  // Comparison verb with a missing figure ("raise it to.", "rising to if…").
  if (/\brising\s+to\s+if\b/i.test(trimmed)) return true
  if (/\b(?:raise|lift|make)\s+it\s+to\s*(?:if\b|[.!?…]|$)/i.test(trimmed)) return true
  if (/\b(?:raising|lifting|pooling)\s+to\s*(?:if\b|[.!?…]|$)/i.test(trimmed)) return true
  if (/\bmake\s+it\s+(?:two-pronged\s+|concentric\s+)?at\s*[.!?…]*$/i.test(trimmed)) return true
  if (/\bpools?\s+to\s+(?:only\s*)?[.!?…]*$/i.test(trimmed)) return true
  if (hasVerblessTrailingSubordinate(trimmed)) return true
  return false
}

/**
 * Strip verbless trailing subordinates and restore lost `?` on open questions.
 */
export function scrubVerblessSubordinates(reply: string): string {
  const out: string[] = []
  for (const sentence of splitCoachSentences(reply)) {
    let primary = sentence.trim()
    const wasQuestion = /\?\s*$/.test(primary) || looksLikeOpenQuestion(primary)
    if (hasVerblessTrailingSubordinate(primary)) {
      const cut = primary.search(VERBLESS_SUBORDINATE_STARTER)
      if (cut > 20) {
        primary = finishCoachSentence(primary.slice(0, cut), wasQuestion)
      } else {
        continue
      }
    } else if (wasQuestion && !/\?/.test(primary)) {
      primary = finishCoachSentence(primary, true)
    }
    primary = primary.replace(/\s{2,}/g, " ").trim()
    if (primary && !hasVerblessTrailingSubordinate(primary)) out.push(primary)
  }
  return out.join(" ").trim()
}

/**
 * After stripping a second odds figure, drop or rewrite dangling comparison tails
 * ("…raise it to.", "…rising to if…") rather than leaving mid-clause fragments.
 */
export function scrubDanglingOddsClauses(reply: string): string {
  const sentences = splitCoachSentences(reply)
  const out: string[] = []
  for (const sentence of sentences) {
    let primary = sentence.trim()
    const wasQuestion = /\?\s*$/.test(primary) || looksLikeOpenQuestion(primary)
    if (
      !hasDanglingCoachClause(primary) &&
      !/\b(?:adding|including)\b[\s\S]{0,80}\b(?:to|at)\s*[.!?]*$/i.test(primary)
    ) {
      out.push(primary)
      continue
    }
    ODDS_FIGURE.lastIndex = 0
    const first = ODDS_FIGURE.exec(primary)
    if (first) {
      const after = primary.slice(first.index + first[0].length)
      const reinforce = after.match(/^\s*(if the Russians don't reinforce)?/i)
      const end = first.index + first[0].length + (reinforce?.[0]?.length ?? 0)
      primary = finishCoachSentence(primary.slice(0, end), wasQuestion)
    } else {
      const cut = primary.search(SUBORDINATE_STARTER)
      if (cut > 20) {
        primary = finishCoachSentence(primary.slice(0, cut), wasQuestion)
      } else {
        const softCut = primary.search(/,\s*(?:but|while|and|though|although|adding|including)\b/i)
        if (softCut > 20) {
          primary = finishCoachSentence(primary.slice(0, softCut), wasQuestion)
        } else {
          continue
        }
      }
    }
    primary = primary.replace(/\s{2,}/g, " ").trim()
    if (primary.length >= 12 && !hasDanglingCoachClause(primary)) out.push(primary)
  }
  return scrubVerblessSubordinates(out.join(" ").trim())
}

/**
 * Only claims that the coach itself filed/noted/queued an order — not ordinary
 * talk about the player's queued arrows ("this queued attack", "your queue").
 */
const FILED_CLAIM_SENTENCE =
  /\bfiled as noted\b|\bnoted as filed\b|\bi(?:'ve| have|'ll)?\s+(?:filed|noted|queued)\b|\bwe(?:'ve| have|'ll)?\s+(?:filed|noted|queued)\b|\b(?:order|orders)\s+(?:(?:was|were|has been|have been|is|are)\s+)?(?:filed|noted)(?:\s+as\s+noted)?\b|\b(?:it|that|this)\s+(?:(?:was|has been|is)\s+)?(?:filed|noted)(?:\s+as\s+noted)?\b/i

/** Never claim an order was filed or noted — coach cannot issue orders. */
export function scrubCoachFiledClaims(reply: string): string {
  const sentences = splitCoachSentences(reply)
  const out: string[] = []
  for (const sentence of sentences) {
    if (FILED_CLAIM_SENTENCE.test(sentence) && !/\b(?:do not|don't|cannot|can't|never)\s+file\b/i.test(sentence)) {
      out.push("I do not file orders.")
      continue
    }
    out.push(sentence)
  }
  return out.join(" ").replace(/(?:I do not file orders\.\s*){2,}/gi, "I do not file orders. ").trim()
}

/** True when a sentence leads with the ratio instead of a question. */
export function replyOpensWithOdds(sentence: string): boolean {
  return /^\s*(?:about\s+)?(?:odds\s+(?:about\s+)?)?\d+(?:\.\d+)?\s*:\s*1\b/i.test(sentence.trim())
}

/**
 * Imperative order language ("cancel the fortify", "attack Kielce") — a refusal
 * must ask about the tradeoff instead of prescribing the arrow.
 */
export function prescribesConcreteOrder(sentence: string): boolean {
  const trimmed = sentence.trim()
  if (
    /\?\s*$/.test(trimmed) &&
    !/^(?:please\s+)?(?:just\s+)?(?:cancel|scrap|drop|abort|attack|fortify|move|recruit)\b/i.test(trimmed)
  ) {
    return false
  }
  if (
    /\b(?:do not|don't|cannot|can't|never|will not|won't)\s+(?:file|issue|order)\b/i.test(trimmed) &&
    !/\b(?:cancel|scrap|drop)\s+(?:the|that|your|this)\b/i.test(trimmed)
  ) {
    return false
  }
  if (/\b(?:cancel|scrap|drop|abort)\s+(?:the|that|your|this)\s+(?:fortify|attack|move|order|garrison|arrow)/i.test(trimmed)) {
    return true
  }
  if (/\byou (?:should|must|need to)\s+(?:cancel|scrap|drop|attack|fortify|move|recruit|march)\b/i.test(trimmed)) {
    return true
  }
  if (/^(?:please\s+)?(?:just\s+)?(?:cancel|scrap|drop|abort)\b/i.test(trimmed)) return true
  if (
    /^(?:please\s+)?(?:just\s+)?(?:attack|fortify|move|recruit)\b/i.test(trimmed) &&
    !/\b(?:is|are|stands|looks|rates|cannot|can't|does not|doesn't)\b/i.test(trimmed)
  ) {
    return true
  }
  return false
}

/** Drop commanded orders; keep a tradeoff question and a plain refusal. */
export function scrubPrescribedOrders(reply: string): string {
  const sentences = splitCoachSentences(reply)
  const out: string[] = []
  let sawPrescription = false
  for (const sentence of sentences) {
    const normalized = sentence.replace(/\bi file no orders\b/gi, "I do not file orders")
    if (prescribesConcreteOrder(normalized)) {
      sawPrescription = true
      continue
    }
    out.push(normalized)
  }
  if (sawPrescription && !out.some((sentence) => sentence.includes("?"))) {
    out.unshift("What is the tradeoff if you keep that order?")
  }
  if (sawPrescription && !out.some((sentence) => /I do not file orders/i.test(sentence))) {
    const questionAt = out.findIndex((sentence) => sentence.includes("?"))
    if (questionAt >= 0) out.splice(questionAt + 1, 0, "I do not file orders.")
    else out.unshift("I do not file orders.")
  }
  return out.join(" ").replace(/(?:I do not file orders\.\s*){2,}/gi, "I do not file orders. ").trim()
}

/** Resolved battle lines (roll, fortnight, losses) are not a queued-plan assumption. */
function isChronicleOddsSentence(sentence: string): boolean {
  return /\(\s*roll\s+\d|\bchronicle\b|\bfortnight\s+\d|\bwe lost\b|\bthey lost\b/i.test(sentence)
}

function annotateOddsAssumption(sentence: string, queuedAttacks: boolean): string {
  if (!queuedAttacks || isChronicleOddsSentence(sentence)) return sentence
  if (/\b(?:queued|column|prong|combined|concentric|contact|plan)\b/i.test(sentence)) return sentence
  ODDS_FIGURE.lastIndex = 0
  if (!ODDS_FIGURE.test(sentence)) return sentence
  ODDS_FIGURE.lastIndex = 0
  return sentence.replace(ODDS_FIGURE, (match) => `${match} on the queued plan`)
}

/**
 * Every odds reply opens with a question. "On the queued plan" is added only when
 * a queued attack exists and the sentence is not a chronicle battle line.
 */
export function ensureOddsQuestionFirst(reply: string, queuedAttacks = false): string {
  const sentences = splitCoachSentences(reply).map((sentence) => annotateOddsAssumption(sentence, queuedAttacks))
  if (!sentences.length) return reply
  const joined = sentences.join(" ").trim()
  ODDS_FIGURE.lastIndex = 0
  if (!ODDS_FIGURE.test(joined)) return joined
  const first = sentences[0]!
  if (first.includes("?") && !replyOpensWithOdds(first)) return joined
  const questionAt = sentences.findIndex((sentence) => sentence.includes("?") && !replyOpensWithOdds(sentence))
  if (questionAt > 0) {
    const question = sentences[questionAt]!
    return [question, ...sentences.filter((_, index) => index !== questionAt)].join(" ").trim()
  }
  const chronicle = sentences.some(isChronicleOddsSentence)
  const lead =
    queuedAttacks && !chronicle
      ? "What does that ratio change in your plan?"
      : "What does that figure change in your decision?"
  return [lead, ...sentences].join(" ").trim()
}

const ODDS_FIGURE =
  /\b(?:odds\s+(?:about\s+)?)?(?:\d+(?:\.\d+)?)\s*:\s*1\b|\babout\s+\d+(?:\.\d+)?\s*:\s*1\b/gi

/** True when an earlier coach turn already named the Russian-reinforcement caveat. */
export function conversationStatedReinforceCaveat(messages: AdvisorChatMessage[]): boolean {
  return messages.some(
    (message) =>
      message.role === "advisor" && /if the russians don't reinforce/i.test(message.content),
  )
}

/** Neighboring Russian provinces still hold formations that could march to reinforce. */
export function reinforcementsPlausiblyMatter(map: GameState, targetId: string): boolean {
  const target = findProvince(map, targetId)
  if (!target) return false
  for (const neighborId of target.neighbors) {
    const neighbor = findProvince(map, neighborId)
    if (!neighbor || neighbor.controller !== "russia") continue
    if (neighbor.units.some((unit) => unit.faction === "russia")) return true
  }
  return false
}

/** Staff voice: caveat on first odds quote in a thread, or when reserves can still respond. */
export function shouldQuoteReinforceCaveat(
  messages: AdvisorChatMessage[],
  map: GameState,
  targetId?: string | null,
): boolean {
  if (!conversationStatedReinforceCaveat(messages)) return true
  if (targetId && reinforcementsPlausiblyMatter(map, targetId)) return true
  return false
}

/**
 * Keep the first odds ratio; drop later sentences that carry another ratio.
 * When two ratios share one sentence, cut at the subordinate comparison
 * (when/while/whereas/…) after the first figure — never at a late comma inside
 * a participial phrase (that left "…2.2:1 when Kielce, taken by…").
 */
export function keepOneOddsFigure(reply: string): string {
  const sentences = splitCoachSentences(reply)
  let seen = false
  const out: string[] = []
  for (const sentence of sentences) {
    ODDS_FIGURE.lastIndex = 0
    const matches = sentence.match(ODDS_FIGURE)
    if (!matches?.length) {
      out.push(sentence)
      continue
    }
    if (!seen) {
      seen = true
      let primary = sentence
      const wasQuestion = /\?\s*$/.test(sentence.trim()) || looksLikeOpenQuestion(sentence)
      ODDS_FIGURE.lastIndex = 0
      const first = ODDS_FIGURE.exec(sentence)
      const second = first ? ODDS_FIGURE.exec(sentence) : null
      if (first && second) {
        const afterFirst = sentence.slice(first.index + first[0].length, second.index)
        const reinforce = afterFirst.match(/^\s*(?:if the Russians don't reinforce)?/i)
        const afterReinforce = afterFirst.slice(reinforce?.[0]?.length ?? 0)
        const subAt = afterReinforce.search(SUBORDINATE_STARTER)
        if (subAt >= 0) {
          const cut =
            first.index + first[0].length + (reinforce?.[0]?.length ?? 0) + subAt
          primary = finishCoachSentence(sentence.slice(0, cut), wasQuestion)
        } else {
          const head = sentence.slice(0, second.index)
          const cutPatterns = [
            /,\s*while\b/i,
            /,\s*but\b/i,
            /;\s+and\s+/i,
            /,\s*and\s+(?:also\s+)?/i,
            /\s+but\s+(?:adding|including)\b/i,
            /\s+(?:while|though|although)\s+/i,
            /,\s*(?:adding|including)\b/i,
            /\s+(?:rising|raising|lifting|pooling)\s+to\b/i,
            /\s+(?:raise|lift|pool|make)\s+it\b/i,
            /\s+would\s+(?:raise|lift|make|pool)\b/i,
            /\s+adding\b/i,
          ]
          let cut = -1
          for (const pattern of cutPatterns) {
            const at = head.search(pattern)
            if (at > 0 && (cut < 0 || at < cut)) cut = at
          }
          // Do not fall back to the last comma — that eats verbs from
          // "when Kielce, taken by…" participial tails.
          if (cut > 0) {
            primary = finishCoachSentence(sentence.slice(0, cut), wasQuestion)
          } else {
            const end =
              first.index + first[0].length + (reinforce?.[0]?.length ?? 0)
            primary = finishCoachSentence(sentence.slice(0, end), wasQuestion)
          }
        }
      } else if (first && hasVerblessTrailingSubordinate(sentence)) {
        const afterFirst = sentence.slice(first.index + first[0].length)
        const reinforce = afterFirst.match(/^\s*(?:if the Russians don't reinforce)?/i)
        const afterReinforce = afterFirst.slice(reinforce?.[0]?.length ?? 0)
        const subAt = afterReinforce.search(SUBORDINATE_STARTER)
        if (subAt >= 0) {
          const cut =
            first.index + first[0].length + (reinforce?.[0]?.length ?? 0) + subAt
          primary = finishCoachSentence(sentence.slice(0, cut), wasQuestion)
        }
      }
      // Never blank-replace a leftover second ratio in place.
      ODDS_FIGURE.lastIndex = 0
      const stillFirst = ODDS_FIGURE.exec(primary)
      const stillSecond = stillFirst ? ODDS_FIGURE.exec(primary) : null
      if (stillFirst && stillSecond) {
        const afterFirst = primary.slice(stillFirst.index + stillFirst[0].length)
        const reinforce = afterFirst.match(/^\s*(?:if the Russians don't reinforce)?/i)
        const end = stillFirst.index + stillFirst[0].length + (reinforce?.[0]?.length ?? 0)
        primary = finishCoachSentence(primary.slice(0, end), wasQuestion)
      }
      primary = scrubDanglingOddsClauses(primary)
      primary = scrubVerblessSubordinates(primary)
      if (primary.length >= 12) out.push(primary)
      continue
    }
    // Later odds sentences: drop entirely (do not strip in place).
  }
  return scrubVerblessSubordinates(scrubDanglingOddsClauses(out.join(" ").trim()))
}

/** Move the first question sentence to the front when intent/prediction asks trail evidence. */
export function putQuestionFirst(reply: string): string {
  const sentences = splitCoachSentences(reply)
  if (sentences.length < 2) return reply
  const qi = sentences.findIndex((sentence) => sentence.includes("?"))
  if (qi <= 0) return reply
  const question = sentences[qi]!
  return [question, ...sentences.filter((_, index) => index !== qi)].join(" ").trim()
}

/**
 * Enforce the character budget by dropping whole trailing sentences — never cut mid-clause.
 * Only if a single remaining sentence still exceeds the cap, truncate at a word boundary.
 */
export function fitCoachReplyLength(reply: string, maxChars = COACH_REPLY_MAX_CHARS): string {
  let sentences = splitCoachSentences(reply)
  if (!sentences.length) return ""
  while (sentences.length > 1 && sentences.join(" ").length > maxChars) {
    sentences = sentences.slice(0, -1)
  }
  const out = sentences.join(" ").trim()
  if (out.length <= maxChars) return out
  // One long sentence: keep a complete leading clause if possible, else word-boundary ellipsis.
  const clauseCut = out.search(/,\s+(?:while|though|although|and|but)\b/i)
  if (clauseCut > 40 && clauseCut < maxChars - 1) {
    const clause = `${out.slice(0, clauseCut).replace(/[,;:\s]+$/, "")}.`
    if (clause.length <= maxChars) return clause
  }
  const sliced = out.slice(0, maxChars - 1).replace(/\s+\S*$/, "").replace(/[,;:\s]+$/, "").trim()
  return sliced ? `${sliced}…` : out.slice(0, maxChars - 1).trimEnd() + "…"
}

/**
 * Post-process coach prose on every path: scrub dice/filing noise, one odds figure,
 * question first, 2–3 sentence cap, then whole-sentence character fit.
 */
export function capCoachReply(reply: string, options?: { queuedAttacks?: boolean }): string {
  let cleaned = scrubCoachLedgerNoise(reply.replace(/\s+/g, " ").trim())
  cleaned = scrubCoachOddsLanguage(cleaned)
  cleaned = scrubCoachFortLabels(cleaned)
  cleaned = scrubCoachOddsDecimals(cleaned)
  cleaned = scrubCoachJargon(cleaned)
  cleaned = scrubCoachFiledClaims(cleaned)
  cleaned = scrubPrescribedOrders(cleaned)
  cleaned = keepOneOddsFigure(cleaned)
  cleaned = scrubDanglingOddsClauses(cleaned)
  cleaned = scrubVerblessSubordinates(cleaned)
  cleaned = scrubCoachOddsLanguage(cleaned)
  cleaned = scrubCoachFortLabels(cleaned)
  cleaned = scrubCoachOddsDecimals(cleaned)
  cleaned = scrubCoachJargon(cleaned)
  cleaned = putQuestionFirst(cleaned)
  const queuedAttacks = options?.queuedAttacks === true
  cleaned = ensureOddsQuestionFirst(cleaned, queuedAttacks)
  if (!cleaned) return cleaned
  const kept = splitCoachSentences(cleaned).slice(0, COACH_MAX_SENTENCES)
  const ordered = ensureOddsQuestionFirst(putQuestionFirst(kept.join(" ").trim()), queuedAttacks)
  return fitCoachReplyLength(ordered)
}

/** Merge a trailing follow-up question into reply-first form; then cap. */
export function shapeCoachReply(
  reply: string,
  followUp: string | null,
  options?: { queuedAttacks?: boolean },
): { reply: string; followUp: string | null } {
  let text = reply.replace(/\s+/g, " ").trim()
  let next = followUp?.trim() ? followUp.trim() : null
  const hasQuestion = splitCoachSentences(text).some((sentence) => sentence.includes("?"))
  if (next && /\?/.test(next)) {
    if (!hasQuestion) {
      text = `${next} ${text}`.trim()
      next = null
    } else {
      // Reply already asks; drop duplicate follow-up questions.
      next = null
    }
  }
  return { reply: capCoachReply(text, options), followUp: next }
}

/** Socratic coach: keep a single map/UI pointer. */
export function capCoachHighlights(raw: CoachHighlight[] | undefined): CoachHighlight[] {
  return sanitizeHighlights(raw).slice(0, 1)
}

const STARTER_LIKE =
  /what do you make of my queued plan|explain the selected province|review the last battle from the chronicle/i

/** True when the player has stated an aim/expectation beyond a bare starter. */
export function playerStatedIntent(messages: AdvisorChatMessage[]): boolean {
  for (const message of messages) {
    if (message.role !== "user") continue
    const text = message.content.trim()
    if (!text) continue
    if (STARTER_LIKE.test(text) && text.length < 90) continue
    if (
      /expect|aim|goal|want|trying to|hoping|so that|for the .+ push|plan to (take|hold|open)|open the road/i.test(
        text,
      )
    ) {
      return true
    }
    if (text.length > 70 && !STARTER_LIKE.test(text)) return true
  }
  return false
}

/** Latest user prediction about a battle outcome, if any. */
export function extractPlayerPrediction(messages: AdvisorChatMessage[]): string | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue
    const text = message.content.trim()
    if (
      /expect(ed|ing)?\s+(to\s+)?(take|hold|win|lose|fail|fall)|predict|should (take|fall|hold)|odds (will|should)/i.test(
        text,
      )
    ) {
      return text.slice(0, 160)
    }
  }
  return null
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`
}

function trimRatio(raw: string): string {
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  return (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "")
}

/**
 * Compact odds phrase for player-facing coach copy (no trailing period).
 * Uses the same engagementOdds / combinedEngagementOdds preview resolveTurn feeds
 * when the garrison is unchanged; names the inherent enemy-move gap in plain words.
 */
export function formatCoachOddsPhrase(
  preview: EngagementPreview | null,
  includeReinforceCaveat = true,
): string | null {
  if (!preview) return null
  const reinforce = includeReinforceCaveat ? " if the Russians don't reinforce" : ""
  if (preview.empty && preview.origins < 2) {
    return includeReinforceCaveat
      ? "undefended on this queued column if the Russians don't reinforce"
      : "undefended on this queued column"
  }
  const ratio =
    preview.empty || !Number.isFinite(preview.ratio) ? null : trimRatio(String(preview.ratio))
  const odds = ratio
    ? `about ${ratio}:1${reinforce}`
    : includeReinforceCaveat
      ? "undefended if the Russians don't reinforce"
      : "undefended"
  if (preview.origins >= 2) {
    const shape = preview.origins === 2 ? "two-pronged" : "concentric"
    const ring = preview.encircled ? ", and the defender is surrounded" : ""
    return `${shape} on the queued plan, ${odds}${ring}`
  }
  if (ratio) return `about ${ratio}:1 on this queued column${reinforce}`
  return includeReinforceCaveat
    ? "undefended on this queued column if the Russians don't reinforce"
    : "undefended on this queued column"
}

/** First odds ratio quoted in coach prose, or null. */
export function extractCoachOddsRatio(text: string): number | null {
  const match = text.match(/\b(?:odds\s+(?:about\s+)?)?(\d+(?:\.\d+)?)\s*:\s*1\b|\babout\s+(\d+(?:\.\d+)?)\s*:\s*1\b/i)
  if (!match) return null
  const raw = match[1] ?? match[2]
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export type CoachAttackCheck =
  | { ok: true; preview: EngagementPreview; phrase: string | null }
  | { ok: false; reason: string }

/** Same validity gates as `validateAttack` in simultaneous resolve (supply, border, ownership). */
export function coachAttackOrderCheck(
  map: GameState,
  order: Extract<PlayerOrder, { type: "attack" }>,
): CoachAttackCheck {
  const verdict = assessManeuvers(map, [
    { type: "attack", from: order.from, target: order.target, units: order.unitIds },
  ])
  if (!verdict.ok) return { ok: false, reason: verdict.summary }
  for (const id of order.unitIds) {
    const located = findUnit(map, id)
    if (located && located.unit.faction !== "central") {
      return { ok: false, reason: "Those formations are not Central Powers columns." }
    }
  }
  const preview = engagementOdds(map, order.from, order.target, order.unitIds)
  return { ok: true, preview: preview!, phrase: formatCoachOddsPhrase(preview) }
}

/**
 * Map-arrow legality from the live board (same helper as the UI highlights).
 * Selected province first when set.
 */
export function renderCoachLegalTargets(
  map: GameState,
  queued: PlayerOrder[],
  selectedProvinceId?: string | null,
): string {
  const queue = playerOrdersToQueued(queued)
  const fromIds = new Set<string>()
  if (selectedProvinceId) fromIds.add(selectedProvinceId)
  for (const order of queued) {
    if (order.type === "attack") fromIds.add(order.from)
    else if (order.type === "fortify" || order.type === "recruit") fromIds.add(order.provinceId)
    else if (order.type === "move") {
      const located = findUnit(map, order.unitId)
      if (located) fromIds.add(located.province.id)
    }
  }
  if (!fromIds.size) {
    for (const province of map.provinces) {
      if (province.controller === "central" && province.units.some((u) => u.faction === "central")) {
        fromIds.add(province.id)
      }
    }
  }
  const lines: string[] = []
  const sorted = [...fromIds].sort((a, b) => {
    if (a === selectedProvinceId) return -1
    if (b === selectedProvinceId) return 1
    return provinceLabel(a).localeCompare(provinceLabel(b))
  })
  for (const fromId of sorted) {
    const targets = legalTargets(map, fromId, queue)
    const fromName = provinceLabel(fromId)
    const attack = targets.attack.map((id) => provinceLabel(id)).join(", ")
    const move = targets.move.map((id) => provinceLabel(id)).join(", ")
    const blocked = targets.blocked.map((item) => `${provinceLabel(item.id)}: ${item.reason}`).join("; ")
    const bits = [
      attack ? `orderable attack: ${attack}` : null,
      move ? `orderable move: ${move}` : null,
      blocked ? `blocked neighbors: ${blocked}` : null,
    ].filter(Boolean)
    lines.push(bits.length ? `${fromName}: ${bits.join("; ")}` : `${fromName}: no legal arrows this fortnight.`)
  }
  return lines.length ? lines.join("\n") : "None."
}

export type QueuedTargetOdds = {
  phrase: string | null
  /** Per-prong engine rejections (supply, border, …) that still leave other prongs valid. */
  rejectedProngs: string[]
}

/** Dispatch slice: odds per target plus separate REJECTED_PRONG lines for failed prongs only. */
export function renderQueuedResolutionOdds(
  map: GameState,
  queued: PlayerOrder[],
  messages: AdvisorChatMessage[] = [],
): string {
  const oddsByTarget = queuedAttackOddsByTarget(map, queued, messages)
  if (!oddsByTarget.size) return "None."
  const lines: string[] = []
  for (const [targetId, row] of oddsByTarget) {
    lines.push(`${targetId} ${provinceLabel(targetId)}: ${row.phrase ?? "unknown"}`)
    for (const prong of row.rejectedProngs) {
      lines.push(`REJECTED_PRONG ${prong}`)
    }
  }
  return lines.join("\n")
}

function centralView(battle: BattleFacts): { ours: number; theirs: number; weWon: boolean } {
  const ours = battle.attacker === "central" ? battle.attackerLoss : battle.defenderLoss
  const theirs = battle.attacker === "central" ? battle.defenderLoss : battle.attackerLoss
  const weWon = battle.attacker === "central" ? battle.attackerWon : !battle.attackerWon
  return { ours, theirs, weWon }
}

/** Plain-sentence battle line for the coach dispatch (no key=value fields). */
export function formatBattleForCoach(battle: BattleFacts): string {
  const target = provinceLabel(battle.targetId)
  const from = joinNames(battle.origins.map(provinceLabel))
  const { ours, theirs, weWon } = centralView(battle)
  const kind = battle.kind === "meeting" ? "meeting engagement" : "assault"
  const ring = battle.encircled ? " The defenders were surrounded." : ""
  if (battle.attacker === "central") {
    const verb = weWon ? `took ${target}` : `failed against ${target}`
    return `Our ${kind} from ${from} ${verb}. We lost ${ours}, they lost ${theirs}.${ring}`
  }
  const verb = weWon ? `we held ${target}` : `Russia took ${target}`
  return `A Russian ${kind} from ${from}: ${verb}. We lost ${ours}, they lost ${theirs}.${ring}`
}

/**
 * Compact chronicle evidence for a Socratic review (odds/roll/losses/control).
 * No key=value fields and no raw supply ledger pairs.
 */
export function formatBattleReviewForPlayer(
  turn: number,
  date: string,
  battle: BattleFacts,
  summary: string,
): string {
  const target = provinceLabel(battle.targetId)
  const from = joinNames(battle.origins.map(provinceLabel))
  const { ours, theirs, weWon } = centralView(battle)
  const kind = battle.kind === "meeting" ? "meeting engagement" : "assault"
  const oddsMatch = summary.match(/odds\s+([\d.]+)\s+\(roll\s+(\d+)\)/i)
  const oddsPhrase = oddsMatch
    ? ` at ${trimRatio(oddsMatch[1]!)}:1 (roll ${oddsMatch[2]})`
    : /undefended/i.test(summary)
      ? " against an undefended garrison"
      : ""

  let outcome: string
  if (battle.attacker === "central" && weWon) {
    outcome = `our ${kind} from ${from} took ${target}${oddsPhrase}`
  } else if (battle.attacker === "central" && !weWon) {
    outcome = `our ${kind} from ${from} into ${target} failed${oddsPhrase}`
  } else if (battle.attacker === "russia" && !weWon) {
    outcome = `a Russian ${kind} from ${from} took ${target}${oddsPhrase}`
  } else {
    outcome = `we held ${target} against a Russian ${kind} from ${from}${oddsPhrase}`
  }
  return `In fortnight ${turn + 1} (${date}) ${outcome}; we lost ${ours}, they lost ${theirs}.`
}

function describeNonAttackOrders(map: GameState, queued: PlayerOrder[]): string[] {
  return queued
    .map((order) => {
      if (order.type === "fortify") return `fortify ${provinceLabel(order.provinceId)}`
      if (order.type === "move") {
        const name = findUnit(map, order.unitId)?.unit.name ?? order.unitId
        return `move ${name} to ${provinceLabel(order.to)}`
      }
      if (order.type === "recruit") return `recruit at ${provinceLabel(order.provinceId)}`
      return null
    })
    .filter((line): line is string => Boolean(line))
}

/** Natural queued-plan sentence for the rules/offline coach (all attacks + other orders). */
export function formatQueuedPlanForPlayer(
  map: GameState,
  queued: PlayerOrder[],
  oddsByTarget: Map<string, QueuedTargetOdds> | null,
): string {
  const attacks = queued.filter(
    (order): order is Extract<PlayerOrder, { type: "attack" }> => order.type === "attack",
  )
  const other = describeNonAttackOrders(map, queued)

  if (!attacks.length) {
    const listed = other.length ? joinNames(other) : "orders"
    return `Your queue shows ${listed}. I do not file orders.`
  }

  const byTarget = new Map<string, Extract<PlayerOrder, { type: "attack" }>[]>()
  for (const order of attacks) {
    const group = byTarget.get(order.target) ?? []
    group.push(order)
    byTarget.set(order.target, group)
  }

  const attackClauses: string[] = []
  for (const [targetId, prongs] of byTarget) {
    const target = provinceLabel(targetId)
    const names = prongs.flatMap((order) =>
      order.unitIds.map((id) => findUnit(map, id)?.unit.name ?? id),
    )
    const fromPlaces = [...new Set(prongs.map((order) => provinceLabel(order.from)))]
    const units = joinNames(names)
    const from = joinNames(fromPlaces)
    const odds = oddsByTarget?.get(targetId)?.phrase
    const oddsClause = odds ? `, ${odds}` : ""
    attackClauses.push(`${units} from ${from} into ${target}${oddsClause}`)
  }

  const parts = [`You have ${joinNames(attackClauses)} queued`]
  if (other.length) parts.push(`plus ${joinNames(other)}`)
  return `${parts.join(", ")}. I do not file orders — change the arrows yourself if you disagree.`
}

/** Odds phrases for every distinct queued attack target (committed unitIds). */
export function queuedAttackOddsByTarget(
  map: GameState,
  queued: PlayerOrder[],
  messages: AdvisorChatMessage[] = [],
): Map<string, QueuedTargetOdds> {
  const out = new Map<string, QueuedTargetOdds>()
  const attacks = queued.filter(
    (order): order is Extract<PlayerOrder, { type: "attack" }> => order.type === "attack",
  )
  const byTarget = new Map<string, Extract<PlayerOrder, { type: "attack" }>[]>()
  for (const order of attacks) {
    const group = byTarget.get(order.target) ?? []
    group.push(order)
    byTarget.set(order.target, group)
  }
  for (const [targetId, prongs] of byTarget) {
    const accepted: Extract<PlayerOrder, { type: "attack" }>[] = []
    const rejectedProngs: string[] = []
    for (const order of prongs) {
      const check = coachAttackOrderCheck(map, order)
      if (!check.ok) {
        rejectedProngs.push(
          `${provinceLabel(order.from)}→${provinceLabel(targetId)}: ${check.reason}`,
        )
        continue
      }
      accepted.push(order)
    }
    const target = findProvince(map, targetId)
    if (target?.controller === "central") {
      out.set(targetId, {
        phrase: `REJECTED — ${target.name} is already held by your side — march there, do not attack it again.`,
        rejectedProngs,
      })
      continue
    }
    if (!accepted.length) {
      out.set(targetId, {
        phrase: `REJECTED — ${rejectedProngs.join("; ")}`,
        rejectedProngs,
      })
      continue
    }
    const preview =
      accepted.length >= 2
        ? combinedEngagementOdds(
            map,
            targetId,
            accepted.map((order) => ({ fromId: order.from, unitIds: order.unitIds })),
          )
        : engagementOdds(map, accepted[0]!.from, targetId, accepted[0]!.unitIds)
    const includeReinforce = shouldQuoteReinforceCaveat(messages, map, targetId)
    out.set(targetId, {
      phrase: formatCoachOddsPhrase(preview, includeReinforce),
      rejectedProngs,
    })
  }
  return out
}

function contactOddsSuffix(
  messages: AdvisorChatMessage[],
  map: GameState,
  targetId: string,
  empty: boolean,
  finiteRatio: boolean,
): string {
  const include = shouldQuoteReinforceCaveat(messages, map, targetId)
  if (!finiteRatio && empty) {
    return include ? ", undefended if the Russians don't reinforce" : ", undefended"
  }
  return include ? " if the Russians don't reinforce" : ""
}

export type LatestChronicleEvidence =
  | {
      kind: "battle"
      turn: number
      date: string
      battle: BattleFacts
      summary: string
    }
  | {
      kind: "rejected"
      turn: number
      date: string
      summary: string
    }

/** Newest chronicle row the coach may cite: latest battle, else latest rejected order. */
export function latestChronicleEvidence(log: TurnRecord[]): LatestChronicleEvidence | null {
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const record = log[i]!
    const battles = record.resolutions.filter((item) => item.battle)
    if (battles.length) {
      const last = battles[battles.length - 1]!
      return {
        kind: "battle",
        turn: record.turn,
        date: record.date,
        battle: last.battle!,
        summary: last.summary,
      }
    }
    const rejected = record.resolutions.filter((item) => item.status === "rejected")
    if (rejected.length) {
      const last = rejected[rejected.length - 1]!
      return {
        kind: "rejected",
        turn: record.turn,
        date: record.date,
        summary: last.summary,
      }
    }
  }
  return null
}

/** Latest fortnight that recorded at least one battle, newest resolution last. */
export function latestBattleFacts(log: TurnRecord[]): Array<{
  turn: number
  date: string
  battle: BattleFacts
  summary: string
}> {
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const record = log[i]!
    const rows = record.resolutions
      .filter((item) => item.battle)
      .map((item) => ({
        turn: record.turn,
        date: record.date,
        battle: item.battle!,
        summary: item.summary,
      }))
    if (rows.length) return rows
  }
  return []
}

/** Build the chronicle slice the coach may quote (engine records only). */
export function renderChronicle(log: TurnRecord[]): string {
  if (!log.length) return "No fortnights closed yet."
  const recent = log.slice(-3)
  return recent
    .map((record) => {
      const battles = record.resolutions
        .filter((item) => item.battle)
        .map((item) => formatBattleForCoach(item.battle!))
      const rejected = record.resolutions
        .filter((item) => item.status === "rejected")
        .map((item) => `REJECTED: ${item.summary}`)
      const routine = routineLog(record)
      return [
        `Fortnight ${record.turn + 1} · ${record.date}`,
        ...routine.slice(0, 8),
        ...rejected,
        ...battles,
      ].join("\n")
    })
    .join("\n\n")
}

export function sanitizeHighlights(raw: CoachHighlight[] | undefined): CoachHighlight[] {
  if (!raw?.length) return []
  const uiAllow = new Set<string>(CAMPAIGN_COACH_UI_IDS)
  const out: CoachHighlight[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const provinceId =
      item.provinceId && CATALOG_BY_ID[item.provinceId] ? item.provinceId : undefined
    const uiId = item.uiId && uiAllow.has(item.uiId) ? item.uiId : undefined
    if (!provinceId && !uiId) continue
    const key = `${provinceId ?? ""}|${uiId ?? ""}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...(provinceId ? { provinceId } : {}), ...(uiId ? { uiId } : {}) })
    if (out.length >= 6) break
  }
  return out
}

function renderSelected(state: GameState, selectedProvinceId?: string | null): string {
  if (!selectedProvinceId) return "None."
  const province = state.provinces.find((item) => item.id === selectedProvinceId)
  if (!province) return "None (id not on the map)."
  const strength = province.units
    .filter((unit) => unit.faction === "central")
    .reduce((sum, unit) => sum + unit.strength, 0)
  return `${province.id} ${province.name} controller=${province.controller} supply=${province.supply} fort=${province.fort} centralStrength=${strength}`
}

/**
 * Engine preview for the player's committed queued attacks.
 * Uses order.unitIds (same path as the order panel), never default-formation contacts.
 */
export function queuedAttackPreview(
  map: GameState,
  queued: PlayerOrder[],
): { targetId: string; odds: string | null } | null {
  const attacks = queued.filter(
    (order): order is Extract<PlayerOrder, { type: "attack" }> => order.type === "attack",
  )
  if (!attacks.length) return null

  const byTarget = new Map<string, Extract<PlayerOrder, { type: "attack" }>[]>()
  for (const order of attacks) {
    const group = byTarget.get(order.target) ?? []
    group.push(order)
    byTarget.set(order.target, group)
  }

  for (const [targetId, prongs] of byTarget) {
    const accepted = prongs.filter((order) => coachAttackOrderCheck(map, order).ok)
    if (!accepted.length) return { targetId, odds: null }
    const preview =
      accepted.length >= 2
        ? combinedEngagementOdds(
            map,
            targetId,
            accepted.map((order) => ({ fromId: order.from, unitIds: order.unitIds })),
          )
        : engagementOdds(map, accepted[0]!.from, targetId, accepted[0]!.unitIds)
    const target = findProvince(map, targetId)
    if (target?.controller === "central") return { targetId, odds: null }
    return { targetId, odds: formatCoachOddsPhrase(preview) }
  }
  return null
}

export type QueuedOrderConflict = {
  provinceId: string
  targetId: string
  detail: string
}

/** Fortify + attack (or overlapping commitments) the player queued on the same garrison. */
export function detectQueuedOrderConflicts(map: GameState, queued: PlayerOrder[]): QueuedOrderConflict[] {
  const conflicts: QueuedOrderConflict[] = []
  const seen = new Set<string>()
  const attacks = queued.filter(
    (order): order is Extract<PlayerOrder, { type: "attack" }> => order.type === "attack",
  )
  const fortifies = queued.filter(
    (order): order is Extract<PlayerOrder, { type: "fortify" }> => order.type === "fortify",
  )
  for (const fort of fortifies) {
    for (const attack of attacks) {
      if (attack.from !== fort.provinceId) continue
      const key = `${fort.provinceId}->${attack.target}`
      if (seen.has(key)) continue
      seen.add(key)
      conflicts.push({
        provinceId: fort.provinceId,
        targetId: attack.target,
        detail: `Fortify ${provinceLabel(fort.provinceId)} conflicts with attack from ${provinceLabel(attack.from)} into ${provinceLabel(attack.target)} — the same garrison cannot dig in and march this fortnight.`,
      })
    }
  }
  return conflicts
}

/** Natural fort wording for staff speech — never "fort 1" / "fort 2". */
export function fortLevelPhrase(level: number): string {
  if (level <= 0) return "no forts"
  if (level === 1) return "a fort"
  if (level === 2) return "two forts"
  if (level === 3) return "three forts"
  return `${level} forts`
}

function inputSelectedFrom(selected: string): string | null {
  if (selected.startsWith("None")) return null
  return selected.split(/\s+/)[0] ?? null
}

function foldDiacritics(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/Ł/g, "L")
    .replace(/ł/g, "l")
}

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function mentionTexts(question: string): string[] {
  const lower = question.toLowerCase()
  const folded = foldDiacritics(question).toLowerCase()
  return lower === folded ? [lower] : [lower, folded]
}

/** Too generic to resolve a province on token fallback alone (need a full label). */
const GENERIC_LABEL_TOKENS = new Set([
  "central",
  "eastern",
  "east",
  "greater",
  "inner",
  "lesser",
  "lower",
  "north",
  "northern",
  "outer",
  "south",
  "southern",
  "upper",
  "west",
  "western",
])

function boundaryPattern(phrase: string): RegExp {
  const body = escapeRegExp(phrase).replace(/\s+/g, "\\s+")
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "iu")
}

function fullLabelMentionedInQuestion(question: string, label: string): boolean {
  const trimmed = label.trim()
  if (!trimmed) return false
  const labelForms = [...new Set([trimmed.toLowerCase(), foldDiacritics(trimmed).toLowerCase()])]
  for (const text of mentionTexts(question)) {
    for (const form of labelForms) {
      if (boundaryPattern(form).test(text)) return true
    }
  }
  return false
}

function tokenMentionedInQuestion(question: string, token: string): boolean {
  if (token.length <= 2) return false
  const tokenForms = [...new Set([token.toLowerCase(), foldDiacritics(token).toLowerCase()])]
  for (const text of mentionTexts(question)) {
    for (const form of tokenForms) {
      if (boundaryPattern(form).test(text)) return true
    }
  }
  return false
}

/** Token appears inside another province's full phrase already matched in this question. */
function tokenConsumedByFullLabel(question: string, map: GameState, token: string): boolean {
  const lowerToken = token.toLowerCase()
  for (const province of map.provinces) {
    for (const label of provinceLabels(province)) {
      if (!fullLabelMentionedInQuestion(question, label)) continue
      const words = label
        .toLowerCase()
        .split(/[\s-]+/)
        .filter((part) => part.length > 2)
      if (words.length > 1 && words.includes(lowerToken)) return true
    }
  }
  return false
}

function tokenFallbackMentionedInQuestion(question: string, map: GameState, label: string): boolean {
  const tokens = label
    .toLowerCase()
    .split(/[\s-]+/)
    .filter((part) => part.length > 2)
  const candidates = tokens.length > 0 ? tokens : [label.toLowerCase()]
  return candidates.some((token) => {
    if (GENERIC_LABEL_TOKENS.has(token)) return false
    return !tokenConsumedByFullLabel(question, map, token) && tokenMentionedInQuestion(question, token)
  })
}

function provinceLabels(province: GameState["provinces"][number]): string[] {
  const catalog = CATALOG_BY_ID[province.id]
  return [...new Set([province.id, province.name, ...(catalog?.aliases ?? [])])]
}

/** Catalog names, ids, and aliases (ASCII fold) mentioned in player text. */
export function collectMentionedProvinceIds(map: GameState, question: string): string[] {
  const fullMatch: string[] = []
  for (const province of map.provinces) {
    if (provinceLabels(province).some((label) => fullLabelMentionedInQuestion(question, label))) {
      fullMatch.push(province.id)
    }
  }
  const uniqueFull = new Set(fullMatch)

  const tokenMatch: string[] = []
  for (const province of map.provinces) {
    if (uniqueFull.has(province.id)) continue
    if (provinceLabels(province).some((label) => tokenFallbackMentionedInQuestion(question, map, label))) {
      tokenMatch.push(province.id)
    }
  }
  return [...new Set([...uniqueFull, ...tokenMatch])]
}

function provinceIdFromLooseLabel(map: GameState, raw: string): string | null {
  const needle = raw.trim()
  if (!needle) return null
  const mentioned = collectMentionedProvinceIds(map, needle)
  if (mentioned.length === 1) return mentioned[0]!
  if (mentioned.length > 1) {
    const foldedNeedle = foldDiacritics(needle).toLowerCase()
    const exact = mentioned.find((id) => id === needle.toLowerCase() || foldDiacritics(provinceLabel(id)).toLowerCase() === foldedNeedle)
    if (exact) return exact
  }
  for (const province of map.provinces) {
    if (provinceLabels(province).some((label) => fullLabelMentionedInQuestion(needle, label))) {
      return province.id
    }
  }
  for (const province of map.provinces) {
    if (provinceLabels(province).some((label) => tokenFallbackMentionedInQuestion(needle, map, label))) {
      return province.id
    }
  }
  return null
}

/** Pick origin/destination from the question wording — not catalog iteration order. */
export function resolveReachabilityEndpoints(
  map: GameState,
  question: string,
  selectedProvinceId?: string | null,
): { fromId: string | null; targetId: string | null } {
  const lower = question.toLowerCase()
  let fromId: string | null = selectedProvinceId ?? null
  const fromMatch = lower.match(/\bfrom\s+([^,?]+?)(?:\s*,|\s+can|\s+to|\s+into|\?|$)/i)
  if (fromMatch?.[1]) {
    fromId = provinceIdFromLooseLabel(map, fromMatch[1]) ?? fromId
  }
  let targetId: string | null = null
  const isReachable = lower.match(/\bis\s+([^?]+?)\s+reachable\b/i)
  if (isReachable?.[1]) {
    targetId = provinceIdFromLooseLabel(map, isReachable[1])
  }
  const destMatch = lower.match(/\b(?:to|into|reach(?:able)?|attack)\s+([^,?]+?)(?:\s+from|\s*\?|$|,|\s+this)/i)
  if (destMatch?.[1]) {
    targetId = provinceIdFromLooseLabel(map, destMatch[1]) ?? targetId
  }
  if (!targetId) {
    const unique = collectMentionedProvinceIds(map, question)
    targetId = unique.find((id) => id !== fromId) ?? unique[0] ?? null
  }
  if (targetId === fromId) {
    const alt = collectMentionedProvinceIds(map, question).find((id) => id !== fromId)
    if (alt) targetId = alt
  }
  return { fromId, targetId }
}

function coachReachabilityReply(
  map: GameState,
  queued: PlayerOrder[],
  selectedProvinceId: string | null,
  questionLower: string,
): { reply: string; followUp: string | null; highlights: CoachHighlight[] } | null {
  const asksNeighbor =
    /warsaw|warszawa|reachable|legal attack|share a border|no contact|cannot (?:reach|march)|can't (?:reach|march)/.test(
      questionLower,
    )
  if (!asksNeighbor) return null
  const { fromId, targetId } = resolveReachabilityEndpoints(map, questionLower, selectedProvinceId)
  if (!targetId || !fromId) return null
  const queue = playerOrdersToQueued(queued)
  const targets = legalTargets(map, fromId, queue)
  const targetName = provinceLabel(targetId)
  const fromName = provinceLabel(fromId)
  const orderable = targets.attack.includes(targetId)
  const reachable =
    orderable || targets.reach.attack.includes(targetId) || targets.move.includes(targetId) || targets.reach.move.includes(targetId)
  if (!reachable) {
    return {
      reply: `What are you weighing at ${fromName}? ${fromName} and ${targetName} are not legal attack neighbors on the current board.`,
      followUp: null,
      highlights: [{ provinceId: fromId }],
    }
  }
  if (orderable) {
    return {
      reply: `What do you need ${targetName} for this fortnight? ${targetName} is an orderable attack neighbor from ${fromName} on the current board — draw the arrow if that is your aim.`,
      followUp: null,
      highlights: [{ provinceId: targetId }],
    }
  }
  const queuedAttack = queued.find(
    (order): order is Extract<PlayerOrder, { type: "attack" }> =>
      order.type === "attack" && order.from === fromId && order.target === targetId,
  )
  if (queuedAttack) {
    const preview = engagementOdds(map, queuedAttack.from, queuedAttack.target, queuedAttack.unitIds)
    const odds = preview ? formatUiOddsForAdvisor(preview) : null
    return {
      reply: `${targetName} is already queued from ${fromName}${odds ? ` — Orders panel reads ${odds}` : ""}. No second arrow from ${fromName} is legal until you change the queue.`,
      followUp: null,
      highlights: [{ provinceId: targetId }],
    }
  }
  return {
    reply: `${targetName} borders ${fromName} but no legal attack arrow remains this fortnight — check supply and which formations are still unassigned.`,
    followUp: null,
    highlights: [{ provinceId: fromId }],
  }
}

function strongestDispatchContact(situation: Situation, map: GameState) {
  return [...situation.contacts]
    .filter((contact) => findProvince(map, contact.targetId)?.controller !== "central")
    .sort((a, b) => b.ratio - a.ratio)[0]
}

/** Varied intent openers — avoid a stock Kielce/Lemberg line on every turn. */
export function intentQuestionForTarget(targetName: string): string {
  const options = [
    `What do you need ${targetName} for this fortnight?`,
    `What do you expect taking ${targetName} to unlock?`,
    `What happens to your line if ${targetName} holds?`,
    `How do you take ${targetName} and still keep OHL's timetable?`,
  ]
  let hash = 0
  for (let i = 0; i < targetName.length; i += 1) hash = (hash + targetName.charCodeAt(i) * (i + 1)) % options.length
  return options[hash]!
}

function rulesExplainSelectedProvince(
  map: GameState,
  queue: ReturnType<typeof playerOrdersToQueued>,
  selectedProvinceId: string,
  deictic: boolean,
): { reply: string; followUp: string | null; highlights: CoachHighlight[] } {
  const province = findProvince(map, selectedProvinceId)
  if (!province) {
    return {
      reply: "That selection is not on the current board.",
      followUp: null,
      highlights: [],
    }
  }
  const targets = legalTargets(map, selectedProvinceId, queue)
  const strength = province.units
    .filter((unit) => unit.faction === "central")
    .reduce((sum, unit) => sum + unit.strength, 0)
  const neighbors = province.neighbors.map((id) => provinceLabel(id)).join(", ")
  const atk = targets.attack.map((id) => provinceLabel(id)).join(", ") || "none"
  const move = targets.move.map((id) => provinceLabel(id)).join(", ") || "none"
  const body = [
    `${province.name} is ${province.controller}-held with supply ${province.supply}, ${fortLevelPhrase(province.fort)}, central strength ${strength}.`,
    `Neighbors: ${neighbors}.`,
    `Orderable this fortnight: attack → ${atk}; move → ${move}.`,
  ].join(" ")
  const opener = deictic ? `Understood — ${province.name}.` : `${province.name}:`
  return {
    reply: `${opener} ${body}`,
    followUp: null,
    highlights: [{ provinceId: selectedProvinceId }],
  }
}

function rulesCoach(
  map: GameState,
  situation: Situation,
  selected: string,
  selectedProvinceId: string | null,
  log: TurnRecord[],
  messages: AdvisorChatMessage[],
  queued: PlayerOrder[],
): { reply: string; followUp: string | null; highlights: CoachHighlight[] } {
  const latest = [...messages].reverse().find((message) => message.role === "user")?.content ?? ""
  const lower = latest.toLowerCase()
  const queue = playerOrdersToQueued(queued)

  if (/explain the selected province/i.test(lower) && selectedProvinceId) {
    return rulesExplainSelectedProvince(map, queue, selectedProvinceId, false)
  }
  if (
    selectedProvinceId &&
    /^(?:this one|here|this province|the selected province)\.?$/i.test(latest.trim())
  ) {
    return rulesExplainSelectedProvince(map, queue, selectedProvinceId, true)
  }
  if (/explain the selected province/i.test(lower) && !selectedProvinceId) {
    return {
      reply: "No province is selected on the map — open the Province tab and click a province first.",
      followUp: null,
      highlights: [{ uiId: "tab-province" }],
    }
  }

  if (/which fortnight|when does the campaign|campaign end|11 july/i.test(lower)) {
    const spec = scenarioSpec(map.scenario)
    const endDate = formatDate(spec.length - 1)
    return {
      reply: `This is fortnight ${situation.fortnight} of ${situation.length}; the campaign ends ${endDate}.`,
      followUp: null,
      highlights: [],
    }
  }
  if (/order anything from krak|legal.*krak/i.test(lower)) {
    const queue = playerOrdersToQueued(queued)
    const targets = legalTargets(map, "krakow", queue)
    const atk = targets.attack.map((id) => provinceLabel(id)).join(", ")
    const move = targets.move.map((id) => provinceLabel(id)).join(", ")
    const bits = [
      atk ? `orderable attack: ${atk}` : null,
      move ? `orderable move: ${move}` : null,
    ].filter(Boolean)
    return {
      reply: `What axis from Kraków matters most this fortnight? The engine lists ${bits.join("; ") || "no legal arrows this fortnight"}.`,
      followUp: null,
      highlights: [{ provinceId: "krakow" }],
    }
  }
  const wantsReview = /battle|fought|last fortnight|chronicle|review|how did|losses|result/.test(lower)
  const hasIntent = playerStatedIntent(messages)
  const prediction = extractPlayerPrediction(messages)
  const conflicts = detectQueuedOrderConflicts(map, queued)

  if (wantsReview) {
    const chronicle = latestChronicleEvidence(log)
    if (chronicle?.kind === "rejected") {
      const body = chronicle.summary.replace(/\.$/, "")
      return {
        reply: `What were you trying to force in fortnight ${chronicle.turn + 1} (${chronicle.date})? The chronicle rejected that order: ${body}.`,
        followUp: null,
        highlights: [{ uiId: "chronicle-log-toggle" }],
      }
    }
    if (chronicle?.kind === "battle") {
      const target = provinceLabel(chronicle.battle.targetId)
      const formatted = formatBattleReviewForPlayer(
        chronicle.turn,
        chronicle.date,
        chronicle.battle,
        chronicle.summary,
      )
      const evidenceBody = formatted.replace(/^In /, "").replace(/\.$/, "")
      if (prediction) {
        return {
          reply: `You expected ${prediction.replace(/\.$/, "")}; the chronicle shows ${evidenceBody}.`,
          followUp: null,
          highlights: [{ provinceId: chronicle.battle.targetId }],
        }
      }
      return {
        reply: `What outcome did you expect at ${target}? The chronicle shows ${evidenceBody}.`,
        followUp: null,
        highlights: [{ provinceId: chronicle.battle.targetId }],
      }
    }
    return {
      reply:
        "No battles are recorded in the chronicle yet. What outcome are you trying to force this fortnight?",
      followUp: null,
      highlights: [{ uiId: "chronicle-log-toggle" }],
    }
  }

  const reachability = coachReachabilityReply(map, queued, selectedProvinceId, lower)
  if (reachability) return reachability

  if (conflicts.length) {
    const conflict = conflicts[0]!
    const name = provinceLabel(conflict.provinceId)
    const target = provinceLabel(conflict.targetId)
    return {
      reply: `Which job should that ${name} garrison keep: digging in, or marching on ${target}? Your queue both fortifies ${name} and attacks from it.`,
      followUp: null,
      highlights: [{ provinceId: conflict.provinceId }],
    }
  }

  const wantsFiling =
    /(?:just |please )?(?:attack|fortify|move|recruit).{0,60}\bfor me\b|\bfile (?:an? )?orders?\b|\byou (?:should )?(?:attack|order)\b/i.test(
      lower,
    )
  if (wantsFiling) {
    const weak = strongestDispatchContact(situation, map)
    if (weak) {
      const suffix = contactOddsSuffix(messages, map, weak.targetId, weak.empty, Number.isFinite(weak.ratio))
      const oddsBit = Number.isFinite(weak.ratio)
        ? ` at about ${trimRatio(String(weak.ratio))}:1${suffix}`
        : weak.empty
          ? suffix.replace(/^ /, ", ")
          : suffix
      return {
        reply: `I do not file orders. ${intentQuestionForTarget(weak.targetName)} ${weak.fromName} into ${weak.targetName} is the strongest contact${oddsBit}.`,
        followUp: null,
        highlights: [{ provinceId: weak.targetId }],
      }
    }
    return {
      reply: "I do not file orders. What are you trying to achieve this fortnight?",
      followUp: null,
      highlights: [{ uiId: "tab-orders" }],
    }
  }

  const queuedAttacks = queued.filter((order) => order.type === "attack")
  if (situation.queue.length || queuedAttacks.length) {
    const oddsByTarget = queuedAttackOddsByTarget(map, queued, messages)
    if (oddsByTarget.size) {
      const [targetId, oddsRow] = [...oddsByTarget.entries()][0]!
      const oddsPhrase = oddsRow.phrase
      const target = provinceLabel(targetId)
      const rejectedNote =
        oddsRow.rejectedProngs.length && oddsPhrase && !oddsPhrase.startsWith("REJECTED")
          ? ` ${oddsRow.rejectedProngs.length === 1 ? "One prong was rejected" : "Some prongs were rejected"}: ${oddsRow.rejectedProngs.join("; ")}.`
          : ""
      const evidence = oddsPhrase?.startsWith("REJECTED")
        ? `The engine would reject that march: ${oddsPhrase.replace(/^REJECTED —\s*/, "")}`
        : oddsPhrase
          ? `${oddsPhrase.charAt(0).toUpperCase()}${oddsPhrase.slice(1)}.${rejectedNote}`
          : `You have a column queued into ${target}.`
      const affirmsPlan = /^(?:yes|yep|yeah|ok|okay|sure|agreed|we(?:'ll| will| can)|deal with)\b/i.test(
        lower.trim(),
      )
      if (!hasIntent) {
        return {
          reply: `${intentQuestionForTarget(target)} ${evidence}`,
          followUp: null,
          highlights: [{ provinceId: targetId }],
        }
      }
      if (affirmsPlan) {
        return {
          reply: `Understood. What stops the Russians from reinforcing ${target} while you grind there? ${evidence}`,
          followUp: null,
          highlights: [{ provinceId: targetId }],
        }
      }
      return {
        reply: `Where does that plan break first? ${evidence}`,
        followUp: null,
        highlights: [{ provinceId: targetId }],
      }
    }
    const other = describeNonAttackOrders(map, queued)
    return {
      reply: other.length
        ? `What are you trying to achieve with ${other[0]}? I do not file orders.`
        : "What are you trying to achieve with this queue? I do not file orders.",
      followUp: null,
      highlights: [{ uiId: "queued-orders" }],
    }
  }

  if (!selected.startsWith("None")) {
    const id = selected.split(" ")[0]
    const province = map.provinces.find((item) => item.id === id)
    const name = province?.name ?? id
    const forts = fortLevelPhrase(province?.fort ?? 0)
    if (!hasIntent) {
      return {
        reply: `What are you weighing at ${name}? It is ${province?.controller ?? "unknown"}-held.`,
        followUp: null,
        highlights: id ? [{ provinceId: id }] : [{ uiId: "tab-province" }],
      }
    }
    return {
      reply: `${name} is ${province?.controller ?? "unknown"}-held with ${forts}. I advise only; you draw the arrows.`,
      followUp: null,
      highlights: id ? [{ provinceId: id }] : [{ uiId: "tab-province" }],
    }
  }

  const weak = strongestDispatchContact(situation, map)
  if (weak) {
    const suffix = contactOddsSuffix(messages, map, weak.targetId, weak.empty, Number.isFinite(weak.ratio))
    const oddsBit = Number.isFinite(weak.ratio)
      ? ` at about ${trimRatio(String(weak.ratio))}:1${suffix}`
      : weak.empty
        ? suffix.replace(/^ /, ", ")
        : suffix
    return {
      reply: `What axis are you weighing this fortnight? ${weak.fromName} into ${weak.targetName} is the strongest contact${oddsBit}.`,
      followUp: null,
      highlights: [{ provinceId: weak.targetId }],
    }
  }

  const selectedId = inputSelectedFrom(selected)
  const probeFrom =
    selectedId ??
    map.provinces.find((province) => province.controller === "central")?.id ??
    null
  if (probeFrom) {
    const legal = legalTargets(map, probeFrom, queue)
    const legalAttack = legal.attack[0]
    if (legalAttack) {
      return {
        reply: `What do you need ${provinceLabel(legalAttack)} for this fortnight? ${provinceLabel(probeFrom)} has a legal attack neighbor at ${provinceLabel(legalAttack)} on the current board.`,
        followUp: null,
        highlights: [{ provinceId: legalAttack }],
      }
    }
  }

  return {
    reply: "What are you trying to achieve this fortnight? No open march into an enemy neighbor shows on the dispatch.",
    followUp: null,
    highlights: [{ uiId: "tab-orders" }],
  }
}

function trimAdvisorConversation(messages: AdvisorChatMessage[]): AdvisorChatMessage[] {
  return messages.slice(-COACH_CONVERSATION_LIMIT).map((message) => ({
    ...message,
    content:
      message.content.length > COACH_MESSAGE_MAX_CHARS
        ? `${message.content.slice(0, COACH_MESSAGE_MAX_CHARS)}…`
        : message.content,
  }))
}

function renderConversation(messages: AdvisorChatMessage[]): string {
  if (!messages.length) return "None."
  return messages
    .map((message) => `${message.role === "user" ? "Player" : "Falkenhayn"}: ${message.content}`)
    .join("\n")
}

function fixtureEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.OSTFRONT_ADVISOR_FIXTURE === "1"
}

