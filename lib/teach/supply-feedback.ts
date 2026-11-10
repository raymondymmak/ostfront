import { CATALOG_BY_ID } from "@/lib/data/catalog"
import type { LessonMeta, TeachVariant } from "@/lib/teach/lessons"
import type { RecordPersistenceStatus } from "@/lib/teach/record"
import type { TurnRecord } from "@/lib/types"
import type { SupplyPlanAnalysis } from "@/lib/teach/supply-plan"

import type { FeedbackKind } from "@/lib/teach/feedback"

export type SupplyTeachFeedback = {
  kind: FeedbackKind
  headline: string
  paragraphs: string[]
  evidence: string[]
  pointers: Array<{ provinceId?: string; uiId?: string }>
}

function battleOnTarget(record: TurnRecord, targetId: string): { summary: string; won: boolean } | null {
  const targetName = CATALOG_BY_ID[targetId]?.name ?? targetId
  for (const item of record.resolutions) {
    if (item.proposal.type !== "attack") continue
    if (item.proposal.target !== targetId && !item.summary.includes(targetName)) continue
    if (item.status === "applied" || item.status === "rejected") {
      const won = /succeeds/i.test(item.summary)
      return { summary: item.summary, won }
    }
  }
  return null
}

export function buildSupplyTeachFeedback(
  meta: LessonMeta,
  variant: TeachVariant,
  supplyPlan: SupplyPlanAnalysis,
  record: TurnRecord,
): SupplyTeachFeedback {
  const battle = battleOnTarget(record, meta.targetProvinceId)
  const { heavyFromId, fedFromId } = supplyPlan
  const choseHeavy =
    supplyPlan.chosenFrom === heavyFromId && !supplyPlan.allInConvergence
  const choseFed = supplyPlan.chosenFrom === fedFromId && !supplyPlan.allInConvergence
  const engineFavorsFed = supplyPlan.fedPreview.ratio > supplyPlan.heavyPreview.ratio
  const combinedWorseThanLean =
    supplyPlan.combinedPreview !== null &&
    supplyPlan.combinedPreview.ratio < supplyPlan.fedPreview.ratio

  const attackTargetsTarget = record.resolutions.some(
    (item) =>
      item.proposal.type === "attack" &&
      item.proposal.target === meta.targetProvinceId &&
      (item.proposal.from === heavyFromId || item.proposal.from === fedFromId),
  )

  let kind: FeedbackKind = "other"
  if (!supplyPlan.chosenFrom && !supplyPlan.allInConvergence) {
    kind = "supply_no_attack"
  } else if (!attackTargetsTarget) {
    kind = "supply_wrong_target"
  } else if (supplyPlan.allInConvergence) {
    kind = "supply_all_in_convergence"
  } else if (choseHeavy) {
    kind = "supply_chose_starved_stack"
  } else if (choseFed && engineFavorsFed) {
    kind = "supply_sound_fed_column"
  } else if (choseFed) {
    kind = "supply_sound_fed_column"
  }

  const evidence = [...supplyPlan.engineLines]
  if (battle) {
    evidence.push(`Resolved battle: ${battle.summary.replace(/\s+/g, " ").trim()}`)
  }

  const paragraphs: string[] = []
  let headline = "Supply trade-off"

  if (kind === "supply_no_attack") {
    headline = "No attack queued"
    paragraphs.push(
      "Queue exactly one assault on the objective from either launch province. Compare the engine preview lines — supply scales attack power at max(0.15, supply÷100).",
    )
  } else if (kind === "supply_all_in_convergence") {
    headline = "All-in does not fix supply"
    paragraphs.push(
      "Sending both columns converges into one battle and pools the overstacked Katowice garrison with the lean Kraków column. Convergence multiplies headcount; it does not erase the low supply factor on the heavy stack.",
    )
    if (combinedWorseThanLean) {
      paragraphs.push(
        `Engine previews before the die: lean Kraków column ratio ${supplyPlan.fedPreview.ratio.toFixed(2)} vs all-in convergence ${supplyPlan.combinedPreview!.ratio.toFixed(2)}. More arrows is not always more attack power when a prong is over capacity.`,
      )
    } else if (supplyPlan.combinedPreview) {
      paragraphs.push(
        `Even when convergence looks potent on paper (ratio ${supplyPlan.combinedPreview.ratio.toFixed(2)}), the starved prong dragged the pooled attack below what a single well-supplied column would deliver — read the per-province supply and capacity lines above.`,
      )
    }
    if (battle?.won) {
      paragraphs.push(
        "The resolver may still succeed on variance — that does not validate piling an overstacked column into the same battle.",
      )
    }
  } else if (kind === "supply_chose_starved_stack") {
    headline = "Headcount is not attack power"
    paragraphs.push(
      "The heavier column marched from the lower-supply province. The engine already showed weaker attack power than the lean, well-supplied column before the die.",
    )
    if (engineFavorsFed) {
      paragraphs.push(
        "This is the intended trade-off: bigger on paper, weaker after the supply factor. Toggle Supply on the map to see why.",
      )
    }
  } else if (kind === "supply_sound_fed_column") {
    headline = "Supply favoured the lean column"
    paragraphs.push(
      "You struck from the better-supplied province. The preview attack/defence numbers come from the resolver inputs, not coach prose.",
    )
    if (battle?.won) {
      paragraphs.push("The lean column carried the assault in the resolver summary.")
    } else if (battle) {
      paragraphs.push(
        "The plan matched the engine preview; if the battle failed, compare the fixed teaching die to the pooled odds line.",
      )
    }
  } else if (kind === "supply_wrong_target") {
    headline = "Wrong objective"
    paragraphs.push(`The lesson expects an attack on ${meta.targetName} from ${heavyFromId} or ${fedFromId}.`)
  }

  if (variant === "guided" && kind === "supply_chose_starved_stack") {
    paragraphs.push(
      "Reasonable plan with an unlucky roll is still possible — check whether the resolver summary blamed supply or the die.",
    )
  }

  const pointers: SupplyTeachFeedback["pointers"] = [
    { provinceId: meta.targetProvinceId, uiId: "tab-province" },
    { provinceId: heavyFromId, uiId: "map-mode-supply" },
    { provinceId: fedFromId, uiId: "map-mode-supply" },
    { uiId: "tab-orders" },
  ]

  return { kind, headline, paragraphs, evidence, pointers }
}

export function mergeSupplyFeedbackShell(
  shell: SupplyTeachFeedback,
  extras: {
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
  },
) {
  return {
    kind: shell.kind,
    headline: shell.headline,
    paragraphs: [...extras.predictionParagraphs, ...shell.paragraphs],
    evidence: shell.evidence,
    pointers: shell.pointers,
    coachReply: extras.coachReply,
    coachStance: extras.coachStance,
    coachSource: extras.coachSource,
    coachFallbackReason: extras.coachFallbackReason,
    followUp: extras.followUp,
    attemptId: extras.attemptId,
    recordPersistence: extras.recordPersistence,
    recordPersistenceMessage: extras.recordPersistenceMessage,
    beliefSummary: extras.beliefSummary,
    beliefPersistence: extras.beliefPersistence,
  }
}
