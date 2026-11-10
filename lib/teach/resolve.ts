import { buildStaffTurn } from "@/lib/gm/cascade"
import { interpretOrders } from "@/lib/gm/interpret"
import { resolveTurn } from "@/lib/engine/turn"
import { buildLessonDispatch } from "@/lib/teach/dispatch"
import { attachCoachToFeedback, buildTeachFeedback } from "@/lib/teach/feedback"
import { scheduleTeachRecord } from "@/lib/teach/record"
import { coachReasoning } from "@/lib/teach/reasoning-coach"
import {
  authoritativeLessonState,
  TEACH_GUIDED_COMBAT_ROLL,
  TEACH_SILENT_COMBAT_ROLL,
  type TeachLessonId,
  type TeachVariant,
} from "@/lib/teach/lessons"
import { analyzeOrders } from "@/lib/teach/plan"
import { lessonMeta } from "@/lib/teach/lessons"
import type { PlayerOrder, TurnRecord } from "@/lib/types"
import type { TeachFeedback } from "@/lib/teach/feedback"

export type TeachResolveResult = {
  state: ReturnType<typeof authoritativeLessonState>
  record: TurnRecord
  plan: ReturnType<typeof analyzeOrders>
  feedback: TeachFeedback
  combatRoll: number
}

function fixedRollRng(roll: number): () => number {
  let calls = 0
  return () => {
    calls += 1
    if (calls === 1) return (roll - 0.5) / 6
    return 0.5
  }
}

export async function teachResolveTurn(
  lessonId: TeachLessonId,
  variant: TeachVariant,
  orders: PlayerOrder[],
  reasoning: string,
  selectedProvinceIds: string[],
): Promise<TeachResolveResult> {
  const state = authoritativeLessonState(lessonId, variant)
  const interpreted = interpretOrders(state, orders)
  const emptyStaff = { narration: "", proposals: [], events: [], diplomacy: [] as string[] }
  const gm = buildStaffTurn(state, emptyStaff, interpreted)
  const combatRoll = variant === "guided" ? TEACH_GUIDED_COMBAT_ROLL : TEACH_SILENT_COMBAT_ROLL
  const { state: next, record } = resolveTurn(state, gm, {
    notes: interpreted.notes,
    gmSource: "mock",
    rng: fixedRollRng(combatRoll),
  })
  const plan = analyzeOrders(state, orders)
  const meta = lessonMeta(lessonId, variant)
  const mechanical = buildTeachFeedback(meta, variant, plan, record)
  const dispatch = buildLessonDispatch(state, meta, plan, orders, combatRoll)
  const coach = await coachReasoning({
    phase: "post_resolve",
    variant,
    meta,
    dispatch,
    plan,
    reasoning,
    mechanical,
  })
  const stored = scheduleTeachRecord({
    meta,
    variant,
    reasoning,
    selectedProvinceIds,
    orders,
    plan,
    feedback: mechanical,
    coach,
    combatRoll,
    record,
  })
  const feedback = attachCoachToFeedback(
    mechanical,
    coach,
    stored,
    variant,
  )
  return { state: next, record, plan, feedback, combatRoll }
}

/** Pre-resolve coach (guided only); shared with /api/teach/coach */
export async function teachCoachBeforeResolve(
  lessonId: TeachLessonId,
  variant: TeachVariant,
  orders: PlayerOrder[],
  reasoning: string,
) {
  if (variant === "silent") {
    return { blocked: true as const, reason: "Coach is silent before resolve in this variation." }
  }
  const state = authoritativeLessonState(lessonId, variant)
  const plan = analyzeOrders(state, orders)
  const meta = lessonMeta(lessonId, variant)
  const dispatch = buildLessonDispatch(state, meta, plan, orders, TEACH_GUIDED_COMBAT_ROLL)
  const coach = await coachReasoning({
    phase: "pre_resolve",
    variant,
    meta,
    dispatch,
    plan,
    reasoning,
    mechanical: null,
  })
  return { blocked: false as const, coach, highlights: coach.highlights }
}
