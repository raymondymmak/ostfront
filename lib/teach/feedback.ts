import { CATALOG_BY_ID } from "@/lib/data/catalog"
import type { PlanAnalysis } from "@/lib/teach/plan"
import type { LessonMeta, TeachVariant } from "@/lib/teach/lessons"
import type { RecordPersistenceStatus, TeachRecordResult } from "@/lib/teach/record"
import type { TurnRecord } from "@/lib/types"

export type FeedbackKind =
  | "sound_converging_unlucky"
  | "sound_converging_success"
  | "reasonable_single_prong"
  | "missed_convergence"
  | "no_attack"
  | "supply_sound_fed_column"
  | "supply_chose_starved_stack"
  | "supply_no_attack"
  | "supply_wrong_target"
  | "other"

export type TeachFeedback = {
  kind: FeedbackKind
  headline: string
  paragraphs: string[]
  evidence: string[]
  pointers: Array<{ provinceId?: string; uiId?: string }>
  coachReply: string
  coachStance: string
  coachSource: "llm" | "rules" | "fallback"
  coachFallbackReason?: string
  followUp: string | null
  attemptId: string | null
  recordPersistence: RecordPersistenceStatus
  recordPersistenceMessage: string | null
  predictionParagraphs: string[]
  beliefSummary: string | null
  beliefPersistence: RecordPersistenceStatus | null
}

function parseRoll(summary: string): number | null {
  const match = summary.match(/\(roll\s+(\d+)\)/i)
  return match ? Number(match[1]) : null
}

function parseRatio(summary: string): number | null {
  const match = summary.match(/,\s*odds\s+([\d.]+)\s+\(roll/i)
  return match ? Number(match[1]) : null
}

function battleOnTarget(record: TurnRecord, targetId: string): { summary: string; applied: boolean } | null {
  const targetName = CATALOG_BY_ID[targetId]?.name ?? targetId
  for (const item of record.resolutions) {
    if (item.proposal.type !== "attack") continue
    if (item.proposal.target !== targetId && !item.summary.includes(targetName)) continue
    return { summary: item.summary, applied: item.status === "applied" }
  }
  return null
}

export function buildTeachFeedback(
  meta: LessonMeta,
  variant: TeachVariant,
  plan: PlanAnalysis,
  record: TurnRecord,
): TeachFeedback {
  const battle = battleOnTarget(record, meta.targetProvinceId)
  const roll = battle ? parseRoll(battle.summary) : null
  const ratio = battle ? parseRatio(battle.summary) : null
  const convergedExpected =
    plan.convergingOnTarget === meta.targetProvinceId &&
    meta.prongProvinceIds.every((id) =>
      plan.attackProngs.some((p) => p.fromId === id && p.targetId === meta.targetProvinceId),
    )

  let kind: FeedbackKind = "other"
  if (!plan.attackProngs.length) {
    kind = "no_attack"
  } else if (convergedExpected && battle) {
    const won = battle.summary.includes("succeeds") || battle.summary.includes("breaks the line")
    kind = won ? "sound_converging_success" : "sound_converging_unlucky"
  } else if (plan.singleProngOnTarget) {
    kind = "reasonable_single_prong"
  } else if (plan.attackProngs.length && !plan.convergingOnTarget) {
    kind = "missed_convergence"
  }

  const evidence = [...plan.engineLines]
  if (battle) {
    if (ratio !== null && roll !== null) {
      evidence.push(`Resolved battle: odds ${ratio.toFixed(2)} on die roll ${roll} (engine summary).`)
    } else {
      evidence.push(`Resolved battle: ${battle.summary.replace(/\s+/g, " ").trim()}`)
    }
  }

  const paragraphs: string[] = []
  let headline = "Review"

  if (kind === "no_attack") {
    headline = "No attack queued"
    paragraphs.push(
      "The drill expects at least one attack order on the map. Converging attacks combine only when several provinces strike the same target in one fortnight.",
    )
  } else if (kind === "sound_converging_unlucky") {
    headline = "Sound plan, harsh die"
    paragraphs.push(
      "You combined two directions into one battle, which is what the rules reward. The pooled odds preview was in your favour before variance.",
    )
    paragraphs.push(
      "The resolver still rolled poorly. That is variance, not proof that convergence was wrong.",
    )
  } else if (kind === "sound_converging_success") {
    headline = "Convergence paid off"
    paragraphs.push(
      "The same-target attacks merged into one battle with the flank multiplier. The numbers in the summary are from the resolver, not narration.",
    )
  } else if (kind === "missed_convergence") {
    headline = "Separate blows"
    paragraphs.push(
      "Your orders did not merge into one converging battle on the objective. Two arrows at the same province in one fortnight pool strength and gain the direction bonus.",
    )
    if (plan.combinedPreview && plan.bestSinglePreview) {
      paragraphs.push(
        `Engine preview: combined ratio ${plan.combinedPreview.ratio.toFixed(2)} vs best single prong ${plan.bestSinglePreview.ratio.toFixed(2)}.`,
      )
    }
  } else if (kind === "reasonable_single_prong") {
    headline = "One prong only"
    paragraphs.push(
      "A single attack can be reasonable when supply or garrisons forbid a second column, but here two friendly provinces could reach the same target.",
    )
    paragraphs.push("Weigh the pooled odds line in the Orders tab against attacking from one province alone.")
  }

  const pointers: TeachFeedback["pointers"] = [{ provinceId: meta.targetProvinceId, uiId: "tab-orders" }]
  if (plan.convergingOnTarget) {
    for (const prong of plan.attackProngs) {
      pointers.push({ provinceId: prong.fromId })
    }
  }

  return {
    kind,
    headline,
    paragraphs,
    evidence,
    pointers,
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
}

export function attachCoachToFeedback(
  mechanical: TeachFeedback,
  coach: {
    reply: string
    stance: string
    source: "llm" | "rules" | "fallback"
    fallbackReason?: string
    followUp: string | null
  },
  record: TeachRecordResult,
  variant: TeachVariant,
  persistenceMessage: string,
): TeachFeedback {
  const paragraphs = [...mechanical.paragraphs]
  if (variant === "silent") {
    paragraphs.push(persistenceMessage)
  }
  return {
    ...mechanical,
    paragraphs,
    coachReply: coach.reply,
    coachStance: coach.stance,
    coachSource: coach.source,
    coachFallbackReason: coach.fallbackReason,
    followUp: coach.followUp,
    attemptId: record.attemptId,
    recordPersistence: record.persistence,
    recordPersistenceMessage: persistenceMessage,
    predictionParagraphs: mechanical.predictionParagraphs,
    beliefSummary: mechanical.beliefSummary,
    beliefPersistence: mechanical.beliefPersistence,
  }
}

export function attachPredictionToFeedback(
  mechanical: TeachFeedback,
  predictionParagraphs: string[],
): TeachFeedback {
  return { ...mechanical, predictionParagraphs: [...predictionParagraphs, ...mechanical.predictionParagraphs] }
}
