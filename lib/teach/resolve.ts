import { buildStaffTurn } from "@/lib/gm/cascade"
import { interpretOrders } from "@/lib/gm/interpret"
import { resolveTurn } from "@/lib/engine/turn"
import {
  authoritativeLessonState,
  TEACH_GUIDED_COMBAT_ROLL,
  TEACH_SILENT_COMBAT_ROLL,
  type TeachLessonId,
  type TeachVariant,
} from "@/lib/teach/lessons"
import { analyzeOrders } from "@/lib/teach/plan"
import { buildTeachFeedback } from "@/lib/teach/feedback"
import { lessonMeta } from "@/lib/teach/lessons"
import type { PlayerOrder, TurnRecord } from "@/lib/types"

export type TeachResolveResult = {
  state: ReturnType<typeof authoritativeLessonState>
  record: TurnRecord
  plan: ReturnType<typeof analyzeOrders>
  feedback: ReturnType<typeof buildTeachFeedback>
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

export function teachResolveTurn(
  lessonId: TeachLessonId,
  variant: TeachVariant,
  orders: PlayerOrder[],
  reasoning: string,
  selectedProvinceIds: string[],
): TeachResolveResult {
  void reasoning
  void selectedProvinceIds
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
  const feedback = buildTeachFeedback(meta, variant, plan, record)
  return { state: next, record, plan, feedback, combatRoll }
}
