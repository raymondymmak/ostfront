import { CATALOG_BY_ID } from "@/lib/data/catalog"
import {
  buildSituation,
  finishAdvisorReply,
  renderSituation,
  scrubAdvisorReply,
  staffMap,
  type Situation,
} from "@/lib/gm/advisor"
import type { AdvisorChatMessage } from "@/lib/gm/advisor-types"
import { extractTopLevelJson, llmChat, llmConfigured, resolveLlmModels } from "@/lib/gm/llm"
import { scheduleLlmResponseLog } from "@/lib/gm/llm-log"
import { lossesLine } from "@/lib/news/battle"
import { routineLog } from "@/lib/news/routine-copy"
import type { BattleFacts, GameState, PlayerOrder, TurnRecord } from "@/lib/types"
import { z } from "zod"

const COACH_TIMEOUT_MS = 20_000
const COACH_MAX_TOKENS = 2_048

const OFFLINE_LINE =
  "The chief of staff is unavailable offline. What follows is read from the map and the chronicle, not from the wire."

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
  "attack-odds",
  "combined-odds",
  "queued-orders",
  "end-turn",
  "war-map",
] as const

export type CoachHighlight = { provinceId?: string; uiId?: string }

export type CampaignCoachResponse = {
  reply: string
  source: "llm" | "rules" | "fallback"
  unavailable: boolean
  followUp: string | null
  highlights: CoachHighlight[]
  ordersClosed: boolean
  /** Present only so clients can assert the schema forbids order cards. */
  suggestions?: never
}

const CoachJsonSchema = z
  .object({
    reply: z.string().min(1).max(2000),
    followUp: z.string().max(400).nullable().optional(),
    highlights: z
      .array(
        z.object({
          provinceId: z.string().optional(),
          uiId: z.string().optional(),
        }),
      )
      .max(6)
      .optional(),
  })
  .strict()

const COACH_SYSTEM = `You are General Erich von Falkenhayn, Chief of the General Staff, coaching the player who commands the Central Powers in the Gorlice–Tarnów offensive (2 May–11 July 1915).

You do NOT issue orders. You never return suggestions, Accept cards, or order JSON. You speak only in reply to the player's latest question.

You know only the DISPATCH in the user message: engine map facts, the player's selected province (if any), their queued arrows, and CHRONICLE records of fortnights already resolved (including BattleFacts). You do not know Stavka's hidden plan. If a fact is not in the DISPATCH, say the map or chronicle does not show it.

Accuracy rules:
- Odds, supply figures, strengths, and battle results must come from the DISPATCH only. Never invent ratios or outcomes.
- Post-battle questions must use CHRONICLE / BattleFacts lines, not a generic debrief.
- Prefer pointing with highlights: provinceId from the catalog, or uiId from the allowed interface list in the DISPATCH. Never invent screen coordinates.

Speak in short staff prose, present tense, two to five sentences. Optional followUp is one short question or null.

Return one JSON object and no markdown:
{"reply":"...","followUp":null,"highlights":[{"provinceId":"kielce"},{"uiId":"tab-orders"}]}

Do not include a suggestions key. Do not include order objects.`

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
  const selected = renderSelected(map, input.selectedProvinceId)
  const rules = rulesCoach(situation, selected, input.log, input.messages, queued)
  const ordersClosed = situation.over

  if (!llmConfigured() && !fixtureEnabled()) {
    return {
      reply: finishAdvisorReply(`${OFFLINE_LINE}\n\n${rules.reply}`),
      source: "fallback",
      unavailable: true,
      followUp: rules.followUp,
      highlights: sanitizeHighlights(rules.highlights),
      ordersClosed,
    }
  }

  const prompt = [
    renderSituation(situation),
    "",
    "SELECTED",
    selected,
    "",
    "CHRONICLE",
    chronicle,
    "",
    "ALLOWED_UI_IDS",
    CAMPAIGN_COACH_UI_IDS.join(", "),
    "",
    "CONVERSATION",
    renderConversation(input.messages),
    "",
    "Answer the latest question. Use the dispatch and chronicle only. Do not issue orders.",
  ].join("\n")

  let failure: "empty" | "http" | "timeout" | null = null
  let parsed: z.infer<typeof CoachJsonSchema> | null = null

  if (fixtureEnabled()) {
    parsed = {
      reply: rules.reply,
      followUp: rules.followUp,
      highlights: rules.highlights,
    }
  } else {
    const models = resolveLlmModels()
    const chat = await llmChat({
      model: models.cheap,
      system: COACH_SYSTEM,
      user: prompt,
      timeoutMs: COACH_TIMEOUT_MS,
      maxTokens: COACH_MAX_TOKENS,
      temperature: 0.3,
      gameTurn: map.turn,
      gameDate: map.date,
    })
    console.log(
      JSON.stringify({
        tag: "ostfront.coach.call",
        model: models.cheap,
        latencyMs: chat.latencyMs,
        outcome: chat.ok ? "ok" : chat.kind,
      }),
    )
    if (chat.ok) {
      const judged = classifyCoachJson(chat.content)
      parsed = judged.parsed
      scheduleLlmResponseLog({
        kind: "advisor",
        attempt: chat.exchange.attempt,
        gameTurn: map.turn,
        gameDate: map.date,
        model: models.cheap,
        latencyMs: chat.exchange.latencyMs,
        httpStatus: chat.exchange.httpStatus,
        finishReason: chat.exchange.finishReason,
        usage: chat.exchange.usage,
        content: chat.exchange.content,
        outcome: judged.outcome === "ok" ? "ok" : judged.outcome === "parse" ? "invalid_json" : "schema",
        error: judged.error,
        fellBack: judged.outcome !== "ok",
      })
      if (!parsed) failure = "empty"
    } else {
      failure = chat.kind === "unconfigured" ? "http" : chat.kind
    }
  }

  if (!parsed) {
    const wire =
      failure === "empty"
        ? "The wire returned nothing I can file. Reasoning spent the dispatch before a reply was written."
        : "The wire returned nothing I can file."
    return {
      reply: finishAdvisorReply(`${wire}\n\n${rules.reply}`),
      source: "rules",
      unavailable: false,
      followUp: rules.followUp,
      highlights: sanitizeHighlights(rules.highlights),
      ordersClosed,
    }
  }

  const reply = scrubAdvisorReply(parsed.reply, map)
  return {
    reply: finishAdvisorReply(reply || rules.reply),
    source: "llm",
    unavailable: false,
    followUp: parsed.followUp?.trim() ? parsed.followUp.trim() : null,
    highlights: sanitizeHighlights(parsed.highlights ?? rules.highlights),
    ordersClosed,
  }
}

/** Central Powers–relative battle line for the coach dispatch. */
export function formatBattleForCoach(battle: BattleFacts): string {
  const ours = battle.attacker === "central" ? battle.attackerLoss : battle.defenderLoss
  const theirs = battle.attacker === "central" ? battle.defenderLoss : battle.attackerLoss
  const weWon = battle.attacker === "central" ? battle.attackerWon : !battle.attackerWon
  return `Battle ${battle.targetId}: attacker=${battle.attacker} defender=${battle.defender} kind=${battle.kind} weWon=${weWon} encircled=${battle.encircled} oursLost=${ours} theirsLost=${theirs} (${lossesLine(battle)})`
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
      const routine = routineLog(record)
      return [
        `Fortnight ${record.turn + 1} · ${record.date}`,
        ...routine.slice(0, 8),
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

/** Engine preview for the player's actual queued attacks (not an unrelated contact). */
export function queuedAttackPreview(
  situation: Situation,
  queued: PlayerOrder[],
): { targetId: string; odds: string | null } | null {
  const attacks = queued.filter((order) => order.type === "attack")
  if (!attacks.length) return null
  for (const battle of situation.combined) {
    const hits = attacks.some((order) => order.type === "attack" && order.target === battle.targetId)
    if (!hits) continue
    if (battle.queuedOdds || battle.prongs.some((prong) => prong.queued)) {
      return { targetId: battle.targetId, odds: battle.queuedOdds ?? battle.odds }
    }
  }
  for (const order of attacks) {
    if (order.type !== "attack") continue
    const contact = situation.contacts.find(
      (item) => item.fromId === order.from && item.targetId === order.target,
    )
    if (contact) return { targetId: contact.targetId, odds: contact.odds }
  }
  const first = attacks[0]
  return first && first.type === "attack" ? { targetId: first.target, odds: null } : null
}

function rulesCoach(
  situation: Situation,
  selected: string,
  log: TurnRecord[],
  messages: AdvisorChatMessage[],
  queued: PlayerOrder[],
): { reply: string; followUp: string | null; highlights: CoachHighlight[] } {
  const latest = [...messages].reverse().find((message) => message.role === "user")?.content ?? ""
  const lower = latest.toLowerCase()
  const wantsReview = /battle|fought|last fortnight|chronicle|review|how did|losses|result/.test(lower)
  const wantsPlan = /plan|queue|arrow|attack|compare|should i|what about|this fortnight/.test(lower)
  const highlights: CoachHighlight[] = []

  if (wantsReview) {
    const battles = latestBattleFacts(log)
    if (battles.length) {
      const last = battles[battles.length - 1]!
      highlights.push({ provinceId: last.battle.targetId, uiId: "chronicle-log-toggle" })
      return {
        reply: `From the chronicle, the last battle of fortnight ${last.turn + 1} (${last.date}): ${formatBattleForCoach(last.battle)}. ${last.summary} Ask if you want another province named.`,
        followUp: "Which battle do you want to walk through?",
        highlights,
      }
    }
  }

  if (situation.queue.length) {
    const preview = queuedAttackPreview(situation, queued)
    if (preview) {
      highlights.push({ provinceId: preview.targetId, uiId: "queued-orders" })
      return {
        reply: `Your queue shows ${situation.queue.slice(0, 2).join("; ")}. Engine preview for that queued attack: ${preview.odds ?? "see COMBINED in the dispatch for the committed columns"}. I do not file orders — change the arrows yourself if you disagree.`,
        followUp: wantsPlan ? "Do you want the same blow from one column only?" : null,
        highlights,
      }
    }
    return {
      reply: `Your queue shows ${situation.queue.slice(0, 2).join("; ")}. No attack column is queued, so I am not attaching combat odds. I do not file orders.`,
      followUp: wantsPlan ? "Queue an attack if you want engine odds on an axis." : null,
      highlights: [{ uiId: "queued-orders" }],
    }
  }

  if (!selected.startsWith("None")) {
    const id = selected.split(" ")[0]
    if (id) highlights.push({ provinceId: id, uiId: "tab-province" })
    return {
      reply: `Selected province: ${selected}. Queue is ${situation.queue.length ? "not empty" : "empty"}. I advise only; you still draw the arrows.`,
      followUp: "Ask about a neighbor attack or the last chronicle battle.",
      highlights,
    }
  }

  const weak = [...situation.contacts].sort((a, b) => b.ratio - a.ratio)[0]
  if (weak) {
    highlights.push({ provinceId: weak.targetId, uiId: "tab-orders" })
    return {
      reply: `On the map the strongest engine contact is ${weak.fromName} into ${weak.targetName} (${weak.odds}). That is a reading, not an order.`,
      followUp: "Queue an arrow if you want me to discuss your plan.",
      highlights,
    }
  }

  return {
    reply: "The dispatch shows no open march into an enemy neighbor. Hold, dig, or raise troops from the yards listed.",
    followUp: null,
    highlights: [{ uiId: "tab-orders" }],
  }
}

function renderConversation(messages: AdvisorChatMessage[]): string {
  if (!messages.length) return "None."
  return messages
    .slice(-10)
    .map((message) => `${message.role === "user" ? "Player" : "Falkenhayn"}: ${message.content}`)
    .join("\n")
}

function fixtureEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.OSTFRONT_ADVISOR_FIXTURE === "1"
}

function classifyCoachJson(text: string): {
  outcome: "ok" | "parse" | "schema"
  error?: string
  parsed: z.infer<typeof CoachJsonSchema> | null
} {
  const extracted = extractTopLevelJson(text)
  if (!extracted.ok) return { outcome: "parse", error: extracted.error, parsed: null }
  const raw = extracted.value
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "suggestions" in raw) {
    return { outcome: "schema", error: "suggestions_forbidden", parsed: null }
  }
  const parsed = CoachJsonSchema.safeParse(raw)
  if (!parsed.success) return { outcome: "schema", error: parsed.error.issues[0]?.message, parsed: null }
  return { outcome: "ok", parsed: parsed.data }
}
