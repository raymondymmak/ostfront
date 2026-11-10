import type { RecordPersistenceStatus } from "@/lib/teach/record"
import type { TeachLessonId } from "@/lib/teach/lessons"
import { teachBeliefKey, TEACH_TTL_SECONDS } from "@/lib/teach/redis-keys"
import { redisPayloadMatches } from "@/lib/teach/redis-verify"
import { redisConfigured } from "@/lib/redis/env"
import { getRedisClient } from "@/lib/redis/client"

export type LearnerBeliefKey =
  | "separate_battles"
  | "more_troops_stronger_attack"
  | "supply_irrelevant"
  | "unclassified"

export type ExtractedBelief = {
  key: LearnerBeliefKey
  summary: string
}

export type LearnerBeliefRecord = {
  id: string
  attemptId: string
  lessonId: TeachLessonId
  variant: "guided" | "silent"
  key: LearnerBeliefKey
  summary: string
  extractedAt: string
  persistence: RecordPersistenceStatus
}

export type BeliefPersistResult = {
  beliefId: string
  persistence: RecordPersistenceStatus
}

const CLIENT_OWNED_FIELDS = [
  "belief",
  "beliefId",
  "beliefKey",
  "beliefSummary",
  "beliefText",
  "learnerBelief",
] as const

/** Reject hostile injection of belief fields on teach POST bodies. */
export function stripHostileBeliefFields(body: Record<string, unknown>): string[] {
  const rejected: string[] = []
  for (const key of CLIENT_OWNED_FIELDS) {
    if (key in body) rejected.push(key)
  }
  return rejected
}

export function extractLearnerBelief(
  lessonId: TeachLessonId,
  reasoning: string,
  prediction: string,
): ExtractedBelief {
  const text = `${reasoning}\n${prediction}`.toLowerCase()

  if (
    /\b(separate|two battles|two fights|independent assaults|split assaults)\b/.test(text) &&
    !/\b(one battle|same target|combined|converge|merged)\b/.test(text)
  ) {
    return {
      key: "separate_battles",
      summary: "Player treats simultaneous blows as separate battles, not one merged fight.",
    }
  }

  if (
    lessonId === "supply-tradeoff" &&
    (/\b(more troops|bigger stack|headcount|mass|sheer numbers|larger formation)\b/.test(text) &&
      /\b(stronger|always wins|always means|best attack|harder hit)\b/.test(text))
  ) {
    return {
      key: "more_troops_stronger_attack",
      summary: "Player links attack power to headcount alone, not supply-starved combat power.",
    }
  }

  if (lessonId === "supply-tradeoff" && /\b(supply does not matter|ignore supply|supply irrelevant)\b/.test(text)) {
    return {
      key: "supply_irrelevant",
      summary: "Player treats march supply as irrelevant to attack strength.",
    }
  }

  if (lessonId === "converging-lublin" && /\b(more troops|bigger stack).*(stronger|always)\b/.test(text)) {
    return {
      key: "more_troops_stronger_attack",
      summary: "Player links strength to headcount without naming convergence or supply context.",
    }
  }

  return {
    key: "unclassified",
    summary: trimmedSummary(reasoning || prediction),
  }
}

function trimmedSummary(raw: string): string {
  const line = raw.trim().replace(/\s+/g, " ")
  if (!line) return "No stated belief extracted."
  return line.length > 160 ? `${line.slice(0, 157)}…` : line
}

function beliefWriteTimeoutMs(): number {
  const raw = process.env.TEACH_RECORD_WRITE_TIMEOUT_MS
  if (!raw?.trim()) return 8_000
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : 8_000
}

export async function persistLearnerBelief(input: {
  attemptId: string
  lessonId: TeachLessonId
  variant: "guided" | "silent"
  belief: ExtractedBelief
}): Promise<BeliefPersistResult> {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16)
  if (!redisConfigured()) {
    return { beliefId: id, persistence: "unavailable" }
  }
  const redis = getRedisClient()
  if (!redis) {
    return { beliefId: id, persistence: "unavailable" }
  }

  const extractedAt = new Date().toISOString()
  const body: LearnerBeliefRecord = {
    id,
    attemptId: input.attemptId,
    lessonId: input.lessonId,
    variant: input.variant,
    key: input.belief.key,
    summary: input.belief.summary.slice(0, 500),
    extractedAt,
    persistence: "confirmed",
  }
  const key = teachBeliefKey(input.attemptId)
  const payload = JSON.stringify(body)

  try {
    await withTimeout(async () => {
      const ok = await redis.set(key, payload, { ex: TEACH_TTL_SECONDS, nx: true })
      if (ok !== "OK") throw new Error("Belief key exists")
      const verified = await redis.get(key)
      if (!redisPayloadMatches(verified, payload)) throw new Error("Belief redis verify mismatch")
    }, beliefWriteTimeoutMs())
    return { beliefId: id, persistence: "confirmed" }
  } catch {
    return { beliefId: id, persistence: "failed" }
  }
}

export type BeliefRecall = {
  belief: LearnerBeliefRecord
  persistence: RecordPersistenceStatus
}

export async function loadBeliefForAttempt(attemptId: string): Promise<BeliefRecall | null> {
  if (!/^[a-f0-9]{16}$/.test(attemptId)) return null
  if (!redisConfigured()) return null
  const redis = getRedisClient()
  if (!redis) return null

  try {
    const raw = await redis.get<string>(teachBeliefKey(attemptId))
    if (!raw) return null
    const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as LearnerBeliefRecord
    if (parsed.attemptId !== attemptId) return null
    return { belief: parsed, persistence: "confirmed" }
  } catch {
    return null
  }
}

async function withTimeout(work: () => Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("belief write timeout")), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function beliefRecallQuestion(belief: LearnerBeliefRecord): string {
  if (belief.key === "separate_battles") {
    return `Earlier you wrote that simultaneous blows stay separate. After this resolve, does that still hold?`
  }
  if (belief.key === "more_troops_stronger_attack") {
    return `You suggested a bigger stack always hits harder. Does the engine preview on each launch province still support that?`
  }
  if (belief.key === "supply_irrelevant") {
    return `You treated supply as irrelevant. Open Supply on the map — does the trade-off still look the same?`
  }
  return `You wrote: “${belief.summary}” — does that still match what you see in the Orders tab?`
}
