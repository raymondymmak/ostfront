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
 * Full campaign, 4 June through the 31 December 1915 fortnight (16 turns).
 * Lemberg, Kraków and Königsberg start in Central Powers hands.
 */
const CAMPAIGN: ScenarioSpec = {
  id: "campaign-1915",
  name: "1915 Campaign",
  kicker: "4 June – 31 December 1915",
  summary:
    "Sixteen fortnights to take the Russian victory cities. Warsaw is the prize. Lemberg, Kraków and Königsberg must be held.",
  length: 16,
  decisive: 10,
  victory: 7,
  marginal: 4,
  objectives: [
    { id: "warszawa", vp: 4, side: "eastern", parTurn: 5 },
    { id: "lublin", vp: 3, side: "eastern", parTurn: 6 },
    { id: "kaunas", vp: 2, side: "eastern", parTurn: 6 },
    { id: "bialystok", vp: 1, side: "eastern", parTurn: 7 },
    { id: "wilno", vp: 2, side: "eastern", parTurn: 8 },
    { id: "lodz", vp: 1, side: "eastern" },
    { id: "lwow", vp: 2, side: "home" },
    { id: "krakow", vp: 2, side: "home" },
    { id: "konigsberg", vp: 2, side: "home" },
  ],
}

/**
 * Gorlice–Tarnów, six fortnights from 2 May 1915.
 * Lemberg stays a Central Powers depot. Mackensen's mass is at Kraków,
 * which on this map also holds Tarnów and the San gateway at Przemyśl.
 * The thin Russian 3rd Army covers Kielce and Lublin; Rovno is the rail behind them.
 */
const GORLICE: ScenarioSpec = {
  id: "gorlice",
  name: "Gorlice–Tarnów",
  kicker: "2 May – 11 July 1915",
  summary:
    "Six fortnights. The 11th Army is concentrated at Kraków. Break the 3rd Army at Kielce, reach Lublin on the San, and take Rovno in Volhynia. Hold Lemberg and Kraków.",
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
  "campaign-1915": CAMPAIGN,
  gorlice: GORLICE,
}

export function scenarioSpec(id: ScenarioId | undefined): ScenarioSpec {
  return SCENARIOS[id ?? "campaign-1915"]
}

export function objectiveValue(id: ScenarioId | undefined, provinceId: string): number {
  return scenarioSpec(id).objectives.find((item) => item.id === provinceId)?.vp ?? 0
}
