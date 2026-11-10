import { z } from "zod"
import { extractTopLevelJson, llmChat, llmConfigured, resolveLlmModels } from "@/lib/gm/llm"
import type { LessonDispatch } from "@/lib/teach/dispatch"
import type { TeachFeedback } from "@/lib/teach/feedback"
import type { LessonMeta, TeachVariant } from "@/lib/teach/lessons"
import type { PlanAnalysis } from "@/lib/teach/plan"
import { dispatchForLlm } from "@/lib/teach/dispatch"

const COACH_TIMEOUT_MS = 18_000

export type CoachStance = "aligned" | "partial" | "misconception" | "unclear" | "absent"

export type CoachHighlight = { provinceId?: string; uiId?: string }

export type ReasoningCoachResult = {
  reply: string
  stance: CoachStance
  followUp: string | null
  highlights: CoachHighlight[]
  source: "llm" | "rules" | "fallback"
  fallbackReason?: string
}

const CoachJsonSchema = z.object({
  reply: z.string().min(1).max(2000),
  stance: z.enum(["aligned", "partial", "misconception", "unclear", "absent"]),
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

const COACH_SYSTEM = `You are a staff instructor during a short teaching drill on converging attacks in a deterministic wargame.

You receive a DISPATCH JSON with engine-computed facts only: plan summary, queued attacks, pooled preview ratios, and optional pedagogical combat roll. You also receive the player's stated reasoning (may be empty).

Your job:
- Compare the player's reasoning to what the queued orders actually do under the rules.
- If reasoning matches a sound converging plan, affirm briefly and ask one grounded follow-up when useful.
- If reasoning conflicts with the plan (e.g. they say "two separate battles" but orders converge on one target), name the misconception without shaming; use engine facts from DISPATCH.
- If reasoning is empty or vague, say what you can observe from the plan only; stance "absent" or "unclear"; do not invent a misconception.
- Never invent odds, strengths, or battle outcomes. Cite only DISPATCH figures. Do not change game state.
- Reply in two to four short sentences. followUp is optional one question or null.

Return JSON only:
{"reply":"...","stance":"aligned|partial|misconception|unclear|absent","followUp":null,"highlights":[{"provinceId":"lublin"}]}`

export async function coachReasoning(input: {
  phase: "pre_resolve" | "post_resolve"
  variant: TeachVariant
  meta: LessonMeta
  dispatch: LessonDispatch
  plan: PlanAnalysis
  reasoning: string
  mechanical: TeachFeedback | null
}): Promise<ReasoningCoachResult> {
  if (input.variant === "silent" && input.phase === "pre_resolve") {
    return silentBlocked()
  }

  const trimmed = input.reasoning.trim()
  if (input.variant === "silent") {
    return {
      reply:
        "Silent drill: your plan and reasoning are stored for review. Outcome numbers below are from the resolver.",
      stance: trimmed ? "unclear" : "absent",
      followUp: null,
      highlights: [{ provinceId: input.meta.targetProvinceId, uiId: "tab-orders" }],
      source: "rules",
    }
  }

  const rules = rulesReasoningCoach(trimmed, input.plan, input.meta, input.phase, input.mechanical)

  if (!llmConfigured()) {
    return { ...rules, source: "fallback", fallbackReason: "LLM_API_KEY is not set" }
  }

  const models = resolveLlmModels()
  const user = buildCoachUserMessage(input.dispatch, trimmed, input.phase, input.mechanical)
  const llm = await llmChat({
    model: models.cheap,
    system: COACH_SYSTEM,
    user,
    timeoutMs: COACH_TIMEOUT_MS,
    maxTokens: 800,
    temperature: 0.35,
    gameTurn: 0,
    gameDate: "Teaching drill",
  })

  if (!llm.ok) {
    return {
      ...rules,
      source: "fallback",
      fallbackReason: llm.kind === "timeout" ? "Coach request timed out" : llm.message,
    }
  }

  const extracted = extractTopLevelJson(llm.content)
  if (!extracted.ok) {
    return { ...rules, source: "fallback", fallbackReason: "Coach returned invalid JSON" }
  }

  let parsed: z.infer<typeof CoachJsonSchema>
  try {
    parsed = CoachJsonSchema.parse(extracted.value)
  } catch {
    return { ...rules, source: "fallback", fallbackReason: "Coach JSON did not match schema" }
  }

  return {
    reply: parsed.reply.trim(),
    stance: parsed.stance,
    followUp: parsed.followUp?.trim() || null,
    highlights: sanitizeHighlights(parsed.highlights, input.meta),
    source: "llm",
  }
}

function silentBlocked(): ReasoningCoachResult {
  return {
    reply: "Coach is silent until you resolve this fortnight.",
    stance: "absent",
    followUp: null,
    highlights: [],
    source: "rules",
  }
}

function buildCoachUserMessage(
  dispatch: LessonDispatch,
  reasoning: string,
  phase: "pre_resolve" | "post_resolve",
  mechanical: TeachFeedback | null,
): string {
  const parts = [
    `PHASE: ${phase}`,
    `DISPATCH:\n${dispatchForLlm(dispatch)}`,
    `PLAYER_REASONING: ${reasoning || "(empty)"}`,
  ]
  if (mechanical) {
    parts.push(
      `OUTCOME_KIND: ${mechanical.kind}`,
      `ENGINE_OUTCOME_LINES:\n${mechanical.evidence.join("\n")}`,
    )
  }
  return parts.join("\n\n")
}

/** Deterministic baseline; contrasting reasoning text yields different replies even without LLM. */
export function rulesReasoningCoach(
  reasoning: string,
  plan: PlanAnalysis,
  meta: LessonMeta,
  phase: "pre_resolve" | "post_resolve",
  mechanical: TeachFeedback | null,
): ReasoningCoachResult {
  const converging = plan.convergingOnTarget === meta.targetProvinceId
  const text = reasoning.toLowerCase()
  const highlights: CoachHighlight[] = [
    { provinceId: meta.targetProvinceId, uiId: "tab-orders" },
  ]
  for (const prong of plan.attackProngs) {
    highlights.push({ provinceId: prong.fromId })
  }

  if (!reasoning.trim()) {
    const reply =
      phase === "pre_resolve"
        ? converging
          ? "You queued a converging assault on the objective. Add a sentence on why you chose that shape before resolving."
          : plan.attackProngs.length
            ? "You have attacks queued. State what rule you are relying on before resolving."
            : "Queue your plan on the map, then explain your reasoning."
        : mechanical
          ? `${mechanical.headline}. The evidence list is from the engine.`
          : "No reasoning was recorded."
    return { reply, stance: "absent", followUp: null, highlights, source: "rules" }
  }

  const thinksSeparate =
    /\b(separate|two battles|two fights|independent|split)\b/.test(text) &&
    !/\b(one battle|same target|combined|converge|together)\b/.test(text)
  const thinksCombine =
    /\b(combine|converge|together|same target|one battle|two.prong|pooled|directions)\b/.test(text)
  const thinksLuck = /\b(luck|dice|roll|variance|unlucky)\b/.test(text)

  if (converging && thinksSeparate) {
    return {
      reply:
        "Your orders strike the same province from two provinces this fortnight, so the rules merge them into one battle with a direction bonus — not two separate assaults. Check the pooled odds line in Orders.",
      stance: "misconception",
      followUp: "What changes in the preview when both prongs aim at the same target?",
      highlights,
      source: "rules",
    }
  }

  if (converging && thinksCombine) {
    const extra =
      phase === "post_resolve" && mechanical?.kind === "sound_converging_unlucky" && thinksLuck
        ? " You linked variance to the outcome; the resolver line shows whether the die hurt a sound plan."
        : ""
    return {
      reply: `Your reasoning matches what the queue does: two directions into ${meta.targetProvinceId} for one merged fight.${extra}`,
      stance: "aligned",
      followUp: phase === "pre_resolve" ? "Which province would you inspect to see the defender's strength?" : null,
      highlights,
      source: "rules",
    }
  }

  if (!converging && thinksCombine) {
    return {
      reply:
        "You mention combining directions, but the queued orders do not all strike the same target this fortnight. Compare each arrow with the pooled odds line.",
      stance: "misconception",
      followUp: "Which second province still needs an attack arrow on the objective?",
      highlights,
      source: "rules",
    }
  }

  if (plan.singleProngOnTarget && thinksCombine) {
    return {
      reply:
        "Only one prong is aimed at the objective so far. A single blow can be valid, but you would not receive the converging bonus until a second province joins the same target.",
      stance: "partial",
      followUp: null,
      highlights,
      source: "rules",
    }
  }

  return {
    reply:
      phase === "post_resolve" && mechanical
        ? `${mechanical.headline}. I read your reasoning against the queued plan; see the engine evidence below.`
        : "I compared your reasoning to the queued plan. Verify on the map that both prongs share the objective this fortnight.",
    stance: "unclear",
    followUp: null,
    highlights,
    source: "rules",
  }
}

function sanitizeHighlights(
  raw: CoachHighlight[] | undefined,
  meta: LessonMeta,
): CoachHighlight[] {
  const allowed = new Set([
    meta.targetProvinceId,
    ...meta.prongProvinceIds,
    "tab-orders",
    "tab-province",
    "attack-odds",
  ])
  const out: CoachHighlight[] = []
  for (const item of raw ?? []) {
    const id = item.provinceId ?? item.uiId
    if (!id || !allowed.has(id)) continue
    out.push(item)
  }
  return out.length ? out : [{ provinceId: meta.targetProvinceId, uiId: "tab-orders" }]
}
