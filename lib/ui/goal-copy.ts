import { CATALOG_BY_ID } from "@/lib/data/catalog"
import { scenarioSpec } from "@/lib/data/objectives"
import { easternObjectives, homeObjectives } from "@/lib/engine/victory"
import { scenarioDate } from "@/lib/format"
import type { ScenarioId } from "@/lib/types"

/** One-line campaign objective for the HUD and pre-game goal bar. */
export function campaignGoalLine(scenario: ScenarioId = "gorlice"): string {
  const spec = scenarioSpec(scenario)
  const eastern = easternObjectives(spec)
    .filter((item) => item.parTurn !== undefined)
    .sort((a, b) => a.parTurn! - b.parTurn!)
  const takes = eastern.map((objective) => {
    const name = CATALOG_BY_ID[objective.id]?.name ?? objective.id
    const date = scenarioDate(scenario, objective.parTurn!)
    return `Take ${name} by ${date.replace(/ 1915$/, "")}`
  })
  const homes = homeObjectives(spec).map((objective) => {
    const name = CATALOG_BY_ID[objective.id]?.name ?? objective.id
    return `never lose ${name}`
  })
  if (!takes.length) return `${homes.join("; ")}.`.replace(/^./, (c) => c.toUpperCase())
  const home = homes.length ? ` ${homes.join("; ").replace(/^./, (c) => c.toUpperCase())}.` : ""
  if (takes.length === 1) return `${takes[0]}.${home}`
  const rest = takes
    .slice(1)
    .map((line) => line.replace(/^Take /, ""))
    .join("; ")
  return `${takes[0]}; ${rest}.${home}`
}