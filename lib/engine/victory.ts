import { scenarioDate } from "@/lib/format"
import { scenarioSpec, type Objective, type ScenarioSpec } from "@/lib/data/objectives"
import type { CampaignGrade, CampaignResult, GameState, Province } from "@/lib/types"

const GRADE_LABEL: Record<CampaignGrade, string> = {
  brilliant: "Brilliant",
  decisive: "Decisive",
  victory: "Victory",
  marginal: "Marginal",
  draw: "Draw",
  defeat: "Defeat",
}

export function gradeLabel(grade: CampaignGrade): string {
  return GRADE_LABEL[grade]
}

export function easternObjectives(spec: ScenarioSpec): Objective[] {
  return spec.objectives.filter((item) => item.side === "eastern")
}

export function homeObjectives(spec: ScenarioSpec): Objective[] {
  return spec.objectives.filter((item) => item.side === "home")
}

function provinceOf(state: GameState, id: string): Province | undefined {
  return state.provinces.find((province) => province.id === id)
}

export function capturedVictoryPoints(state: GameState): number {
  const spec = scenarioSpec(state.scenario)
  return easternObjectives(spec).reduce((sum, objective) => {
    const province = provinceOf(state, objective.id)
    return sum + (province?.controller === "central" ? objective.vp : 0)
  }, 0)
}

export function availableVictoryPoints(state: GameState): number {
  return easternObjectives(scenarioSpec(state.scenario)).reduce((sum, item) => sum + item.vp, 0)
}

export function homeCitiesHeldByRussia(state: GameState): Objective[] {
  return homeObjectives(scenarioSpec(state.scenario)).filter((objective) => {
    const province = provinceOf(state, objective.id)
    return province?.controller === "russia"
  })
}

export type Standing = {
  grade: CampaignGrade
  captured: number
  available: number
  next: { name: string; date: string; overdue: boolean } | null
}

/** The grade the campaign would earn if it ended this fortnight. */
export function standing(state: GameState): Standing {
  const spec = scenarioSpec(state.scenario)
  const captured = capturedVictoryPoints(state)
  const available = availableVictoryPoints(state)
  const homes = homeCitiesHeldByRussia(state)
  let grade: CampaignGrade
  if (homes.length >= 2 || (state.turn >= spec.length - 1 && homes.length >= 1)) {
    grade = "defeat"
  } else if (brilliant(state, spec)) {
    grade = "brilliant"
  } else if (captured >= spec.decisive && homes.length === 0) {
    grade = "decisive"
  } else if (captured >= spec.victory) {
    grade = "victory"
  } else if (captured >= spec.marginal) {
    grade = "marginal"
  } else {
    grade = "draw"
  }
  return { grade, captured, available, next: nextDeadline(state, spec) }
}

function brilliant(state: GameState, spec: ScenarioSpec): boolean {
  if (state.homeLost || homeCitiesHeldByRussia(state).length > 0) return false
  return easternObjectives(spec).every((objective) => {
    const province = provinceOf(state, objective.id)
    if (province?.controller !== "central") return false
    const taken = state.capturedOn[objective.id]
    if (objective.parTurn === undefined) return taken !== undefined
    return taken !== undefined && taken <= objective.parTurn
  })
}

function nextDeadline(
  state: GameState,
  spec: ScenarioSpec,
): Standing["next"] {
  const pending = easternObjectives(spec)
    .filter((objective) => objective.parTurn !== undefined)
    .filter((objective) => provinceOf(state, objective.id)?.controller !== "central")
    .sort((a, b) => a.parTurn! - b.parTurn!)
  const next = pending[0]
  if (!next || next.parTurn === undefined) return null
  const province = provinceOf(state, next.id)
  return {
    name: province?.name ?? next.id,
    date: scenarioDate(spec.id, next.parTurn),
    overdue: state.turn > next.parTurn,
  }
}

export function scoreResult(
  state: GameState,
  grade: CampaignGrade,
  captured: number,
): number {
  const spec = scenarioSpec(state.scenario)
  const spare = Math.max(0, spec.length - 1 - state.turn)
  const base = captured * 100 + spare * 50 - Math.round(state.cpStrengthLost / 10)
  return base + (grade === "brilliant" ? 400 : 0)
}

/**
 * Called at the end of a fortnight, before the turn index advances.
 * Sudden death and capitulation can end the war early.
 */
export function decideFortnight(state: GameState): CampaignResult | null {
  if (state.result) return state.result
  const spec = scenarioSpec(state.scenario)
  const captured = capturedVictoryPoints(state)
  const available = availableVictoryPoints(state)
  const homes = homeCitiesHeldByRussia(state)
  const allEastern = easternObjectives(spec).every(
    (objective) => provinceOf(state, objective.id)?.controller === "central",
  )

  if (homes.length >= 2) {
    return finish(state, "defeat", captured, available, true, "Austria-Hungary sues for peace. Russia holds two of the home cities.")
  }
  if (allEastern && homes.length === 0) {
    const grade = brilliant(state, spec) ? "brilliant" : "decisive"
    return finish(
      state,
      grade,
      captured,
      available,
      false,
      grade === "brilliant"
        ? "Every objective fell on time, and the home cities held."
        : "Russia has lost every eastern objective.",
    )
  }
  if (state.turn < spec.length - 1) return null
  if (homes.length >= 1) {
    const names = homes
      .map((objective) => provinceOf(state, objective.id)?.name ?? objective.id)
      .join(", ")
    return finish(state, "defeat", captured, available, false, `Russia holds ${names} when the campaign closes.`)
  }
  const now = standing(state)
  const reason =
    now.grade === "brilliant"
      ? "Every objective fell on time, and the home cities held."
      : now.grade === "decisive"
        ? `${captured} victory points, and the home cities held.`
        : now.grade === "victory"
          ? `${captured} victory points by the last fortnight.`
          : now.grade === "marginal"
            ? `${captured} victory points. The campaign is a marginal success.`
            : `${captured} victory points. Not enough for a victory.`
  return finish(state, now.grade, captured, available, false, reason)
}

function finish(
  state: GameState,
  grade: CampaignGrade,
  captured: number,
  available: number,
  sudden: boolean,
  reason: string,
): CampaignResult {
  return {
    grade,
    score: scoreResult(state, grade, captured),
    reason,
    captured,
    available,
    sudden,
  }
}

export function noteCaptures(state: GameState): void {
  const spec = scenarioSpec(state.scenario)
  for (const objective of easternObjectives(spec)) {
    const province = provinceOf(state, objective.id)
    if (province?.controller === "central" && state.capturedOn[objective.id] === undefined) {
      state.capturedOn[objective.id] = state.turn
    }
  }
  if (homeCitiesHeldByRussia(state).length > 0) state.homeLost = true
}
