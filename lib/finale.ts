import { gradeLabel } from "@/lib/engine/victory"
import type { CampaignGrade } from "@/lib/types"

export const SEE_RESULT_LABEL = "Campaign over — see the result"
export const FINAL_POSITIONS_LABEL = "Final positions"
export const BACK_TO_MAP_LABEL = "Back to the map"

const CAMPAIGN_ENDS_LINE = "The campaign ends:"

export type FinalePhase = "playing" | "map" | "result"

/**
 * A finished campaign stays on the map until the player asks for the result.
 * `resultOpen` is session UI only, so a reload (closed) lands on the map.
 */
export function finalePhase(hasResult: boolean, resultOpen: boolean): FinalePhase {
  if (!hasResult) return "playing"
  return resultOpen ? "result" : "map"
}

export function ordersLocked(hasResult: boolean): boolean {
  return hasResult
}

/** Standing grade while the war is open. Once it is over, the map chrome does not name the grade. */
export function statusLabel(hasResult: boolean, grade: CampaignGrade): string {
  if (hasResult) return FINAL_POSITIONS_LABEL
  return gradeLabel(grade)
}

/**
 * The engine records the grade on the closing logistics line. Hold that sentence
 * on the final map; the result screen is where the grade, score, and reason appear.
 */
export function logisticsForPhase(lines: string[], phase: FinalePhase): string[] {
  if (phase !== "map") return lines
  return lines.filter((line) => !line.startsWith(CAMPAIGN_ENDS_LINE))
}
