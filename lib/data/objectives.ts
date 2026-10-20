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
 * The Dunajec blow is inside the Kraków province. The first Russian provinces
 * on the playable axis are Kielce, then Lublin (the pursuit toward the Bug),
 * then Rovno in Volhynia. Lemberg and Kraków start in Central Powers hands
 * and must be held.
 */
const GORLICE: ScenarioSpec = {
  id: "gorlice",
  name: "Gorlice–Tarnów",
  kicker: "2 May – 11 July 1915",
  summary:
    "Six fortnights. The 11th Army and the Austro-Hungarian 4th Army are concentrated at Kraków. Break Radko Dimitriev's 3rd Army at Kielce, reach Lublin, and take Rovno in Volhynia. Hold Lemberg and Kraków.",
  length: 6,
  decisive: 5,
  victory: 4,
  marginal: 2,
  objectives: [
    { id: "kielce", vp: 2, side: "eastern", parTurn: 2 },
    { id: "lublin", vp: 3, side: "eastern", parTurn: 4 },
    { id: "wolyn", vp: 2, side: "eastern", parTurn: 5 },
    { id: "lwow", vp: 2, side: "home" },
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
