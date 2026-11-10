import { put } from "@vercel/blob"
import { waitUntil } from "@vercel/functions"
import type { ReasoningCoachResult } from "@/lib/teach/reasoning-coach"
import type { TeachFeedback } from "@/lib/teach/feedback"
import type { LessonMeta, TeachVariant } from "@/lib/teach/lessons"
import type { PlanAnalysis } from "@/lib/teach/plan"
import type { PlayerOrder, TurnRecord } from "@/lib/types"

export type TeachAttemptRecord = {
  id: string
  timestamp: string
  lessonId: string
  variant: TeachVariant
  reasoning: string
  selectedProvinceIds: string[]
  orders: PlayerOrder[]
  planSummary: string
  feedbackKind: string
  combatRoll: number
  coach: Pick<ReasoningCoachResult, "reply" | "stance" | "source" | "fallbackReason">
  persistence: "blob" | "unavailable"
}

export type TeachRecordResult = {
  attemptId: string
  persistence: "blob" | "unavailable"
}

export function scheduleTeachRecord(input: {
  meta: LessonMeta
  variant: TeachVariant
  reasoning: string
  selectedProvinceIds: string[]
  orders: PlayerOrder[]
  plan: PlanAnalysis
  feedback: TeachFeedback
  coach: ReasoningCoachResult
  combatRoll: number
  record: TurnRecord
}): TeachRecordResult {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16)
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim()
  const persistence: TeachRecordResult["persistence"] = token ? "blob" : "unavailable"

  const body: TeachAttemptRecord = {
    id,
    timestamp: new Date().toISOString(),
    lessonId: input.meta.lessonId,
    variant: input.variant,
    reasoning: input.reasoning.slice(0, 2000),
    selectedProvinceIds: input.selectedProvinceIds.slice(0, 20),
    orders: input.orders,
    planSummary: input.plan.engineLines.join(" "),
    feedbackKind: input.feedback.kind,
    combatRoll: input.combatRoll,
    coach: {
      reply: input.coach.reply,
      stance: input.coach.stance,
      source: input.coach.source,
      fallbackReason: input.coach.fallbackReason,
    },
    persistence,
  }

  if (token) {
    const day = body.timestamp.slice(0, 10)
    const pathname = `teach-attempts/${day}/${id}.json`
    const task = put(pathname, JSON.stringify(body), {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json",
      token,
    }).catch(() => {})
    try {
      waitUntil(task)
    } catch {
      void task
    }
  }

  return { attemptId: id, persistence }
}
