import { independentFormations } from "@/lib/engine/echelon"
import { findProvince } from "@/lib/engine/turn"
import type { GameState } from "@/lib/types"

/** Central-held provinces with units and a single friendly neighbor exit, flanked by Russia. */
export function centralEncirclementRiskIds(map: GameState): string[] {
  const risks: string[] = []
  for (const province of map.provinces) {
    if (province.controller !== "central") continue
    const formations = independentFormations(province.units.filter((unit) => unit.faction === "central"))
    if (!formations.length) continue
    const friendly = province.neighbors.filter(
      (id) => findProvince(map, id)?.controller === "central",
    )
    const hostile = province.neighbors.filter(
      (id) => findProvince(map, id)?.controller === "russia",
    )
    if (friendly.length !== 1 || hostile.length < 2) continue
    if (province.supply < 40) risks.push(province.id)
  }
  return [...new Set(risks)]
}