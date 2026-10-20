import type { ScenarioId } from "@/lib/types"

export type ObjectiveSide = "eastern" | "home"

export type Objective = {
  id: string
  vp: number
  side: ObjectiveSide
  /** Turn index by which an eastern objective must already be held for a Brilliant. */
  parTurn?: number
}

export type ScenarioSpec = {
  id: ScenarioId
  name: string
  kicker: string
  summary: string
  length: number
  /** Grades read captured eastern victory points. */
  decisive: number
  victory: number
  marginal: number
  objectives: Objective[]
}

/**
 * Gorlice–Tarnów, six fortnights from 2 May 1915 through 11 July.
 * The Dunajec blow is inside the Kraków province. Lemberg starts Russian
 * (held since 3 September 1914) and is the prize: historically retaken 22 June,
 * inside the fortnight of 13 June. Kielce is the northern shoulder, Lublin the
 * pursuit toward the Bug. Rovno counts toward a Brilliant only when already
 * held by the fortnight of 27 June.
 * Kraków is the home city. Przemyśl fell on 3 June but sits inside Kraków,
 * which was never Russian, so it is not its own objective.
 */
const GORLICE: ScenarioSpec = {
  id: "gorlice",
  name: "Gorlice–Tarnów",
  kicker: "2 May – 11 July 1915",
  summary:
    "Six fortnights. The 11th Army and the Austro-Hungarian 4th Army are concentrated at Kraków. Radko Dimitriev's 3rd Army holds Lemberg. Take the city, then Lublin and Rovno. Hold Kraków.",
  length: 6,
  decisive: 7,
  victory: 4,
  marginal: 2,
  objectives: [
    { id: "lwow", vp: 4, side: "eastern", parTurn: 3 },
    { id: "lublin", vp: 2, side: "eastern", parTurn: 5 },
    { id: "wolyn", vp: 3, side: "eastern", parTurn: 4 },
    { id: "krakow", vp: 2, side: "home" },
  ],
}

export const SCENARIOS: Record<ScenarioId, ScenarioSpec> = {
  gorlice: GORLICE,
}

export function scenarioSpec(id: ScenarioId | undefined): ScenarioSpec {
  return SCENARIOS[id ?? "gorlice"]
}

export function objectiveValue(id: ScenarioId | undefined, provinceId: string): number {
  return scenarioSpec(id).objectives.find((item) => item.id === provinceId)?.vp ?? 0
}
