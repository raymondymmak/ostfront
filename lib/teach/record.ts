import { head, put } from "@vercel/blob"
import { MAX_PREDICTION_LENGTH } from "@/lib/teach/prediction"
import type { ReasoningCoachResult } from "@/lib/teach/reasoning-coach"
import type { TeachFeedback } from "@/lib/teach/feedback"
import type { LessonMeta, TeachVariant } from "@/lib/teach/lessons"
import type { PlanAnalysis } from "@/lib/teach/plan"
import type { PlayerOrder, TurnRecord } from "@/lib/types"

/** End state of a teach attempt write — never "stored" until `confirmed`. */
export type RecordPersistenceStatus = "unavailable" | "confirmed" | "failed"

export type TeachAttemptRecord = {
  id: string
  timestamp: string
  lessonId: string
  variant: TeachVariant
  reasoning: string
  prediction: string
  selectedProvinceIds: string[]
  orders: PlayerOrder[]
  planSummary: string
  feedbackKind: string
  combatRoll: number
  beliefKey: string
  beliefSummary: string
  beliefId: string | null
  beliefPersistence: RecordPersistenceStatus
  coach: Pick<ReasoningCoachResult, "reply" | "stance" | "source" | "fallbackReason">
  persistence: RecordPersistenceStatus
}

export type TeachRecordResult = {
  attemptId: string
  persistence: RecordPersistenceStatus
}

function writeTimeoutMs(): number {
  const raw = process.env.TEACH_RECORD_WRITE_TIMEOUT_MS
  if (!raw?.trim()) return 8_000
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : 8_000
}

export function persistenceStatusMessage(result: TeachRecordResult): string {
  switch (result.persistence) {
    case "confirmed":
      return `Attempt ${result.attemptId} was stored privately for review (plan, reasoning, engine outcome).`
    case "failed":
      return `Attempt ${result.attemptId} was not stored; the private write or verify did not complete.`
    case "unavailable":
      return `Attempt ${result.attemptId} is returned only in this response; durable storage is not configured on the host.`
  }
}

export function persistenceShortLabel(status: RecordPersistenceStatus): string {
  switch (status) {
    case "confirmed":
      return "private storage confirmed"
    case "failed":
      return "storage failed"
    case "unavailable":
      return "storage not configured"
  }
}

export async function persistTeachRecord(input: {
  meta: LessonMeta
  variant: TeachVariant
  reasoning: string
  prediction: string
  selectedProvinceIds: string[]
  orders: PlayerOrder[]
  plan: PlanAnalysis
  feedback: TeachFeedback
  coach: ReasoningCoachResult
  combatRoll: number
  record: TurnRecord
  beliefKey: string
  beliefSummary: string
  beliefId: string | null
  beliefPersistence: RecordPersistenceStatus
  attemptId?: string
}): Promise<TeachRecordResult> {
  const id = input.attemptId ?? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim()

  if (!token) {
    return { attemptId: id, persistence: "unavailable" }
  }

  const timestamp = new Date().toISOString()
  const body: TeachAttemptRecord = {
    id,
    timestamp,
    lessonId: input.meta.lessonId,
    variant: input.variant,
    reasoning: input.reasoning.slice(0, 2000),
    prediction: input.prediction.slice(0, MAX_PREDICTION_LENGTH),
    selectedProvinceIds: input.selectedProvinceIds.slice(0, 20),
    orders: input.orders,
    planSummary: input.plan.engineLines.join(" "),
    feedbackKind: input.feedback.kind,
    combatRoll: input.combatRoll,
    beliefKey: input.beliefKey,
    beliefSummary: input.beliefSummary.slice(0, 500),
    beliefId: input.beliefId,
    beliefPersistence: input.beliefPersistence,
    coach: {
      reply: input.coach.reply,
      stance: input.coach.stance,
      source: input.coach.source,
      fallbackReason: input.coach.fallbackReason,
    },
    persistence: "confirmed",
  }

  const day = timestamp.slice(0, 10)
  const pathname = `teach-attempts/${day}/${id}.json`
  const payload = JSON.stringify(body)

  try {
    await withTimeout(
      async () => {
        const uploaded = await put(pathname, payload, {
          access: "private",
          addRandomSuffix: false,
          contentType: "application/json",
          token,
        })
        const verified = await head(uploaded.url, { token })
        if (!verified?.url || verified.pathname !== uploaded.pathname) {
          throw new Error("Private blob verify mismatch")
        }
      },
      writeTimeoutMs(),
    )
    return { attemptId: id, persistence: "confirmed" }
  } catch {
    return { attemptId: id, persistence: "failed" }
  }
}

async function withTimeout(work: () => Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("teach record write timeout")), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
