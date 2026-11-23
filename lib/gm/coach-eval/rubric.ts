import { extractTopLevelJson, llmChat } from "@/lib/gm/llm"
import { z } from "zod"
import type { PedagogyCriterionResult, PedagogyGrade } from "@/lib/gm/coach-eval/types"

const RubricSchema = z
  .object({
    blind_spot: z.object({ pass: z.boolean(), rationale: z.string().min(1).max(400) }),
    socratic: z.object({ pass: z.boolean(), rationale: z.string().min(1).max(400) }),
    map_revelation: z.object({ pass: z.boolean(), rationale: z.string().min(1).max(400) }),
    tone: z.object({ pass: z.boolean(), rationale: z.string().min(1).max(400) }),
  })
  .strict()

const RUBRIC_SYSTEM = `You grade a Socratic wargame coach reply. Return one JSON object only (no markdown):
{"blind_spot":{"pass":true,"rationale":"..."},"socratic":{"pass":true,"rationale":"..."},"map_revelation":{"pass":true,"rationale":"..."},"tone":{"pass":true,"rationale":"..."}}

Criteria:
- blind_spot: Does the reply aim at the scenario's real mistake/trade-off (given as BLIND_SPOT), not a generic boilerplate question unrelated to that trap?
- socratic: Genuinely Socratic — does NOT disguise a direct order as a question (e.g. "Have you considered attacking X?" as the order). Asking what the player expects is good; telling them the move is bad.
- map_revelation: Surfaces one concrete piece of board evidence a newcomer could have missed (odds, empty flank, supply, chronicle result, adjacency).
- tone: Concise, warm, non-robotic; handles pushback without repeating stock phrases.

Be strict but fair. Short rules-fallback replies that still hit the blind spot with real engine evidence may pass.`

export function resolveJudgeModel(coachModel: string): string {
  const override = process.env.EVAL_JUDGE_MODEL?.trim()
  if (override) return override
  return coachModel
}

export async function gradePedagogy(input: {
  scenarioId: string
  title: string
  blindSpot: string
  playerMessages: string[]
  reply: string
  judgeModel: string
}): Promise<PedagogyGrade> {
  const user = [
    `SCENARIO_ID: ${input.scenarioId}`,
    `TITLE: ${input.title}`,
    `BLIND_SPOT: ${input.blindSpot}`,
    "",
    "PLAYER_MESSAGES:",
    ...input.playerMessages.map((line, index) => `${index + 1}. ${line}`),
    "",
    "COACH_REPLY:",
    input.reply,
    "",
    "Grade the four criteria.",
  ].join("\n")

  const chat = await llmChat({
    model: input.judgeModel,
    system: RUBRIC_SYSTEM,
    user,
    timeoutMs: 30_000,
    maxTokens: 800,
    temperature: 0,
  })

  if (!chat.ok) {
    return {
      criteria: [],
      allPass: false,
      error: `${chat.kind}: ${chat.message}`,
    }
  }

  const extracted = extractTopLevelJson(chat.content)
  if (!extracted.ok) {
    return { criteria: [], allPass: false, error: extracted.error, raw: chat.content }
  }
  const parsed = RubricSchema.safeParse(extracted.value)
  if (!parsed.success) {
    return {
      criteria: [],
      allPass: false,
      error: parsed.error.issues[0]?.message ?? "schema",
      raw: chat.content,
    }
  }

  const criteria: PedagogyCriterionResult[] = [
    { id: "blind_spot", pass: parsed.data.blind_spot.pass, rationale: parsed.data.blind_spot.rationale },
    { id: "socratic", pass: parsed.data.socratic.pass, rationale: parsed.data.socratic.rationale },
    {
      id: "map_revelation",
      pass: parsed.data.map_revelation.pass,
      rationale: parsed.data.map_revelation.rationale,
    },
    { id: "tone", pass: parsed.data.tone.pass, rationale: parsed.data.tone.rationale },
  ]
  return {
    criteria,
    allPass: criteria.every((item) => item.pass),
    raw: chat.content,
  }
}
