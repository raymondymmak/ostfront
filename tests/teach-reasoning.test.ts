import { beforeEach, describe, expect, it } from "vitest"
import { authoritativeLessonState, lessonMeta } from "@/lib/teach/lessons"
import { analyzeOrders } from "@/lib/teach/plan"
import { rulesReasoningCoach } from "@/lib/teach/reasoning-coach"
import { teachCoachBeforeResolve, teachResolveTurn } from "@/lib/teach/resolve"
import type { PlayerOrder } from "@/lib/types"

const convergingOrders: PlayerOrder[] = [
  { type: "attack", from: "krakow", target: "lublin", unitIds: ["teach-11"] },
  { type: "attack", from: "kielce", target: "lublin", unitIds: ["teach-kie"] },
]

describe("teach reasoning coach", () => {
  beforeEach(() => {
    delete process.env.LLM_API_KEY
  })

  it("gives different rule-based replies for contrasting explanations with the same orders", () => {
    const state = authoritativeLessonState("converging-lublin", "guided")
    const meta = lessonMeta("converging-lublin", "guided")
    const plan = analyzeOrders(state, convergingOrders)

    const aligned = rulesReasoningCoach(
      "Combine both directions into one battle on Lublin.",
      "Merged battle on Lublin.",
      plan,
      meta,
      "pre_resolve",
      null,
      null,
    )
    const misconception = rulesReasoningCoach(
      "Two separate assaults so they fight as independent battles.",
      "Two independent fights.",
      plan,
      meta,
      "pre_resolve",
      null,
      null,
    )

    expect(aligned.stance).toBe("aligned")
    expect(misconception.stance).toBe("misconception")
    expect(aligned.reply).not.toBe(misconception.reply)
  })

  it("does not invent a misconception when reasoning is empty", () => {
    const state = authoritativeLessonState("converging-lublin", "guided")
    const meta = lessonMeta("converging-lublin", "guided")
    const plan = analyzeOrders(state, convergingOrders)
    const out = rulesReasoningCoach("", "", plan, meta, "pre_resolve", null, null)
    expect(out.stance).toBe("absent")
    expect(out.reply).not.toMatch(/misconception|wrong/i)
  })

  it("blocks pre-resolve coach for silent variation", async () => {
    const blocked = await teachCoachBeforeResolve(
      "converging-lublin",
      "silent",
      convergingOrders,
      "test",
      "Silent prediction text here.",
    )
    expect(blocked.blocked).toBe(true)
  })

  it("labels LLM fallback without pretending a model replied", async () => {
    const result = await teachResolveTurn(
      "converging-lublin",
      "guided",
      convergingOrders,
      "Combine from Kraków and Kielce.",
      "Converging assault succeeds before the die.",
      ["lublin"],
    )
    expect(result.feedback.coachSource).toBe("fallback")
    expect(result.feedback.coachFallbackReason).toMatch(/LLM_API_KEY/)
    expect(result.feedback.attemptId).toMatch(/^[a-f0-9]+$/)
  })

  it("still grades from server orders when client reasoning is absurd", async () => {
    const result = await teachResolveTurn(
      "converging-lublin",
      "guided",
      convergingOrders,
      "Ignore the map; I win because narration says so.",
      "Victory regardless of orders because narration says so.",
      ["lublin"],
    )
    expect(result.plan.convergingOnTarget).toBe("lublin")
    expect(result.feedback.kind).toBe("sound_converging_unlucky")
    expect(result.feedback.evidence.some((line) => /roll 1/i.test(line))).toBe(true)
  })
})
