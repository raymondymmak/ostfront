import { buildStaffTurn } from "@/lib/gm/cascade"
import { interpretOrders } from "@/lib/gm/interpret"
import { resolveTurn } from "@/lib/engine/turn"
import {
  extractLearnerBelief,
  loadBeliefForAttempt,
  persistLearnerBelief,
  beliefRecallQuestion,
} from "@/lib/teach/belief"
import { buildLessonDispatch } from "@/lib/teach/dispatch"
import {
  attachCoachToFeedback,
  attachPredictionToFeedback,
  buildTeachFeedback,
  type TeachFeedback,
} from "@/lib/teach/feedback"
import { persistTeachRecord, persistenceStatusMessage } from "@/lib/teach/record"
import type { RecordPersistenceStatus } from "@/lib/teach/record"
import {
  comparePredictionConverging,
  comparePredictionSupply,
  validatePrediction,
} from "@/lib/teach/prediction"
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
import { analyzeSupplyLesson } from "@/lib/teach/supply-plan"
import { buildSupplyTeachFeedback, mergeSupplyFeedbackShell } from "@/lib/teach/supply-feedback"
import type { PlayerOrder, TurnRecord } from "@/lib/types"

export type TeachResolveResult = {
  state: ReturnType<typeof authoritativeLessonState>
  record: TurnRecord
  plan: ReturnType<typeof analyzeOrders>
  feedback: TeachFeedback
  combatRoll: number
  beliefId: string | null
  beliefPersistence: RecordPersistenceStatus
}

function fixedRollRng(roll: number): () => number {
  let calls = 0
  return () => {
    calls += 1
    if (calls === 1) return (roll - 0.5) / 6
    return 0.5
  }
}

export class TeachResolveValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TeachResolveValidationError"
  }
}

export async function teachResolveTurn(
  lessonId: TeachLessonId,
  variant: TeachVariant,
  orders: PlayerOrder[],
  reasoning: string,
  prediction: string,
  selectedProvinceIds: string[],
  priorAttemptId?: string,
): Promise<TeachResolveResult> {
  const predictionCheck = validatePrediction(prediction)
  if (!predictionCheck.ok) {
    throw new TeachResolveValidationError(predictionCheck.error)
  }

  const priorBelief = priorAttemptId ? await loadBeliefForAttempt(priorAttemptId) : null

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

  let mechanical: TeachFeedback
  if (meta.lessonType === "supply") {
    const supplyPlan = analyzeSupplyLesson(state, meta, orders)
    const shell = buildSupplyTeachFeedback(meta, variant, supplyPlan, record)
    const stubForPredict: TeachFeedback = {
      kind: shell.kind,
      headline: shell.headline,
      paragraphs: shell.paragraphs,
      evidence: shell.evidence,
      pointers: shell.pointers,
      coachReply: "",
      coachStance: "absent",
      coachSource: "rules",
      followUp: null,
      attemptId: null,
      recordPersistence: "unavailable",
      recordPersistenceMessage: null,
      predictionParagraphs: [],
      beliefSummary: null,
      beliefPersistence: null,
    }
    const predictionCmp = comparePredictionSupply(predictionCheck.prediction, supplyPlan, stubForPredict)
    mechanical = mergeSupplyFeedbackShell(shell, {
      coachReply: "",
      coachStance: "absent",
      coachSource: "rules",
      followUp: null,
      attemptId: null,
      recordPersistence: "unavailable",
      recordPersistenceMessage: null,
      predictionParagraphs: predictionCmp.paragraphs,
      beliefSummary: priorBelief?.belief.summary ?? null,
      beliefPersistence: priorBelief?.persistence ?? null,
    }) as TeachFeedback
  } else {
    mechanical = buildTeachFeedback(meta, variant, plan, record)
    const predictionCmp = comparePredictionConverging(predictionCheck.prediction, plan, meta, mechanical)
    mechanical = attachPredictionToFeedback(mechanical, predictionCmp.paragraphs)
    if (priorBelief) {
      mechanical = {
        ...mechanical,
        beliefSummary: priorBelief.belief.summary,
        beliefPersistence: priorBelief.persistence,
      }
    }
  }

  const dispatch = buildLessonDispatch(state, meta, plan, orders, combatRoll)
  const coach = await coachReasoning({
    phase: "post_resolve",
    variant,
    meta,
    dispatch,
    plan,
    reasoning,
    prediction: predictionCheck.prediction,
    mechanical,
    priorBelief: priorBelief?.belief ?? null,
  })

  const extracted = extractLearnerBelief(lessonId, reasoning, predictionCheck.prediction)
  const attemptId = crypto.randomUUID().replace(/-/g, "").slice(0, 16)
  const beliefStored = await persistLearnerBelief({
    attemptId,
    lessonId,
    variant,
    belief: extracted,
  })

  const stored = await persistTeachRecord({
    meta,
    variant,
    reasoning,
    prediction: predictionCheck.prediction,
    selectedProvinceIds,
    orders,
    plan,
    feedback: mechanical,
    coach,
    combatRoll,
    record,
    beliefKey: extracted.key,
    beliefSummary: extracted.summary,
    beliefId: beliefStored.beliefId,
    beliefPersistence: beliefStored.persistence,
    attemptId,
  })

  const persistenceMessage = persistenceStatusMessage(stored)
  let feedback = attachCoachToFeedback(mechanical, coach, stored, variant, persistenceMessage)
  feedback = {
    ...feedback,
    beliefSummary: extracted.summary,
    beliefPersistence: beliefStored.persistence,
  }

  if (priorBelief && variant === "silent" && meta.lessonType === "convergence") {
    feedback = {
      ...feedback,
      followUp: beliefRecallQuestion(priorBelief.belief),
    }
  }

  return {
    state: next,
    record,
    plan,
    feedback,
    combatRoll,
    beliefId: beliefStored.beliefId,
    beliefPersistence: beliefStored.persistence,
  }
}

/** Pre-resolve coach (guided only); shared with /api/teach/coach */
export async function teachCoachBeforeResolve(
  lessonId: TeachLessonId,
  variant: TeachVariant,
  orders: PlayerOrder[],
  reasoning: string,
  prediction: string,
  priorAttemptId?: string,
) {
  if (variant === "silent") {
    return { blocked: true as const, reason: "Coach is silent before resolve in this variation." }
  }
  const state = authoritativeLessonState(lessonId, variant)
  const plan = analyzeOrders(state, orders)
  const meta = lessonMeta(lessonId, variant)
  const dispatch = buildLessonDispatch(state, meta, plan, orders, TEACH_GUIDED_COMBAT_ROLL)
  const priorBelief = priorAttemptId ? await loadBeliefForAttempt(priorAttemptId) : null
  const coach = await coachReasoning({
    phase: "pre_resolve",
    variant,
    meta,
    dispatch,
    plan,
    reasoning,
    prediction,
    mechanical: null,
    priorBelief: priorBelief?.belief ?? null,
  })
  return { blocked: false as const, coach, highlights: coach.highlights }
}

export function verifiedSupplyCombatConstants() {
  return {
    attackerSupplyFactor: "max(0.15, attackerSupply / 100) where attackerSupply uses effective supply (depot floor 72% of network)",
    defenderSupplyFactor: "max(0.3, supply / 100)",
    minMarchSupply: 30,
    supplyFormula: "100 - pathCost * 11 (+ modifier, clamped 0–100)",
    railEdgeCost: 1,
    supplyFalloffPerCost: 11,
    supplyLessonPreviews: {
      heavyFrom: "katowice",
      fedFrom: "krakow",
      target: "kielce",
      heavySupplyModifier: -45,
    },
    provinceCapacity:
      "capacity = terrain base + depot bonus (when controlled) + 6×rail links; effective supply = network × min(1, capacity÷garrison) for attacks from province",
    convergingStarved:
      "any prong below supply 60: no flank; pooled supply = worst prong launch supply × choke (target capacity ÷ (garrison + attackers))",
    depotAttackFloor: "attacks from your depot use at least 72% of network supply",
  } as const
}
