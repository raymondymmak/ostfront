import { describe, expect, it } from "vitest"
import { createInitialState } from "@/lib/data/scenario"
import { staffMap } from "@/lib/gm/advisor"
import { playerOrdersToQueued } from "@/lib/orders"
import {
  provinceIdsThatWouldEmptyDepot,
  provinceIdsWithThinDepotGarrison,
  queuedOrderRiskNotes,
} from "@/lib/ui/order-warnings"
import type { PlayerOrder } from "@/lib/types"

function attackOrder(from: string, target: string, unitIds: string[]): PlayerOrder {
  return { type: "attack", from, target, unitIds }
}

describe("order warnings", () => {
  it("flags thin depot garrison after partial march", () => {
    const map = staffMap(createInitialState())
    const krakow = map.provinces.find((province) => province.id === "krakow")
    if (!krakow || krakow.depot !== "central") return
    const units = krakow.units.filter((unit) => unit.faction === "central")
    if (units.length < 2) return
    const target =
      krakow.neighbors.find((id) => map.provinces.find((item) => item.id === id)?.controller !== "central") ??
      "kielce"
    const departing = units.slice(0, Math.max(1, units.length - 1)).map((unit) => unit.id)
    const queue = playerOrdersToQueued([attackOrder("krakow", target, departing)])
    const thin = provinceIdsWithThinDepotGarrison(map, queue)
    const empty = provinceIdsThatWouldEmptyDepot(map, queue)
    expect(empty).not.toContain("krakow")
    if (thin.includes("krakow")) {
      const notes = queuedOrderRiskNotes(map, queue[0]!)
      expect(notes.some((note) => note.toLowerCase().includes("thin garrison"))).toBe(true)
    }
  })
})