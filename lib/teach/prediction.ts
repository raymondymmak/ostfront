import type { TeachFeedback } from "@/lib/teach/feedback"
import type { LessonMeta } from "@/lib/teach/lessons"
import type { PlanAnalysis } from "@/lib/teach/plan"
import type { SupplyPlanAnalysis } from "@/lib/teach/supply-plan"

export const MIN_PREDICTION_LENGTH = 12
export const MAX_PREDICTION_LENGTH = 800

export type PredictionValidation =
  | { ok: true; prediction: string }
  | { ok: false; error: string }

export function validatePrediction(raw: string): PredictionValidation {
  const prediction = raw.trim()
  if (prediction.length < MIN_PREDICTION_LENGTH) {
    return {
      ok: false,
      error: `A short prediction is required before resolve (at least ${MIN_PREDICTION_LENGTH} characters: what will happen and why).`,
    }
  }
  if (prediction.length > MAX_PREDICTION_LENGTH) {
    return { ok: false, error: `Prediction is too long (max ${MAX_PREDICTION_LENGTH} characters).` }
  }
  return { ok: true, prediction }
}

export type PredictionComparison = {
  headline: string
  paragraphs: string[]
  stance: "aligned" | "partial" | "misaligned" | "unclear"
}

export function comparePredictionConverging(
  prediction: string,
  plan: PlanAnalysis,
  meta: LessonMeta,
  feedback: TeachFeedback,
): PredictionComparison {
  const text = prediction.toLowerCase()
  const expectsConverge = /\b(combine|converge|one battle|merge|pooled|together|same target)\b/.test(text)
  const expectsSeparate = /\b(separate|two battles|independent|split)\b/.test(text)
  const expectsWin = /\b(break|take|win|seize|succeed|capture|push)\b/.test(text)
  const expectsLose = /\b(fail|stall|repulse|hold|lose)\b/.test(text)

  const converged = plan.convergingOnTarget === meta.targetProvinceId
  const won =
    feedback.kind === "sound_converging_success" ||
    (feedback.evidence.some((line) => /succeeds|breaks the line/i.test(line)) &&
      feedback.kind !== "sound_converging_unlucky")

  const paragraphs: string[] = [
    `Your prediction: “${prediction.trim().slice(0, 220)}${prediction.length > 220 ? "…" : ""}”`,
  ]

  if (expectsSeparate && converged) {
    paragraphs.push(
      "You expected separate fights, but the queued orders merge into one battle on the objective. That is a reasoning mismatch even when the die is unkind.",
    )
    return { headline: "Prediction vs plan", paragraphs, stance: "misaligned" }
  }

  if (expectsConverge && !converged && plan.attackProngs.length) {
    paragraphs.push(
      "You predicted a combined battle, but the orders did not converge on one target this fortnight.",
    )
    return { headline: "Prediction vs plan", paragraphs, stance: "misaligned" }
  }

  if (expectsWin && feedback.kind === "sound_converging_unlucky") {
    paragraphs.push(
      "You expected success; the merged battle still lost on the fixed teaching die. That can be sound planning with harsh variance — compare the pooled odds line to the resolver summary.",
    )
    return { headline: "Prediction vs outcome", paragraphs, stance: "partial" }
  }

  if (expectsLose && won) {
    paragraphs.push("You expected failure, but the converging assault succeeded in the resolver.")
    return { headline: "Prediction vs outcome", paragraphs, stance: "misaligned" }
  }

  if (expectsConverge && converged) {
    paragraphs.push(
      won
        ? "Your prediction matched convergence and the resolver agreed."
        : "Your prediction matched convergence; the resolver still rolled against you — check whether that was odds or a faulty plan.",
    )
    return { headline: "Prediction vs outcome", paragraphs, stance: won ? "aligned" : "partial" }
  }

  paragraphs.push("Compare your stated expectation to the engine evidence and feedback kind below.")
  return { headline: "Prediction vs outcome", paragraphs, stance: "unclear" }
}

export function comparePredictionSupply(
  prediction: string,
  supplyPlan: SupplyPlanAnalysis,
  feedback: TeachFeedback,
): PredictionComparison {
  const text = prediction.toLowerCase()
  const favorsHeavy =
    /\b(katowice|heavy|bigger|larger|more troops|mass|headcount)\b/.test(text) &&
    !/\b(krakow|fed|lean|smaller|well.?supplied)\b/.test(text)
  const favorsFed =
    /\b(krakow|fed|lean|smaller|well.?supplied)\b/.test(text) &&
    !/\b(katowice|heavy|bigger|mass)\b/.test(text)

  const paragraphs: string[] = [
    `Your prediction: “${prediction.trim().slice(0, 220)}${prediction.length > 220 ? "…" : ""}”`,
  ]

  const choseHeavy = supplyPlan.chosenFrom === supplyPlan.heavyFromId
  const engineFavorsFed = supplyPlan.fedPreview.ratio > supplyPlan.heavyPreview.ratio

  if (favorsHeavy && engineFavorsFed && !choseHeavy) {
    paragraphs.push(
      "You leaned toward the heavy column, but the engine preview already favoured the lean, well-supplied launch. Supply scales attack power — headcount alone did not win the preview.",
    )
    return { headline: "Prediction vs engine", paragraphs, stance: "misaligned" }
  }

  if (favorsHeavy && choseHeavy && feedback.kind === "supply_chose_starved_stack") {
    paragraphs.push(
      "You predicted the heavy stack would carry the assault; the resolver used that province’s low supply factor, so the lean column would have been stronger before the die.",
    )
    return { headline: "Prediction vs outcome", paragraphs, stance: "partial" }
  }

  if (favorsFed && choseHeavy) {
    paragraphs.push("You predicted the fed column would do better, but the queued attack marched from the starved province.")
    return { headline: "Prediction vs plan", paragraphs, stance: "misaligned" }
  }

  if (favorsFed && !choseHeavy && feedback.kind.startsWith("supply_sound")) {
    paragraphs.push("Your prediction matched the engine trade-off: the well-supplied column hits harder per strength.")
    return { headline: "Prediction vs outcome", paragraphs, stance: "aligned" }
  }

  paragraphs.push(
    "Weigh your prediction against the attack/defence preview lines in Orders (engine-rendered, not narration).",
  )
  return { headline: "Prediction vs outcome", paragraphs, stance: "unclear" }
}
