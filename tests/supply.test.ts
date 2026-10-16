import { describe, expect, it } from "vitest"
import { computeSupply, type SupplyLink, type SupplyNode } from "@/lib/engine/supply"
import type { Faction, Terrain } from "@/lib/types"

function node(
  id: string,
  controller: Faction,
  terrain: Terrain,
  depot: Faction | null = null,
  supplyModifier = 0,
): SupplyNode {
  return { id, controller, terrain, depot, supplyModifier }
}

describe("supply pathing", () => {
  it("keeps a rail hop cheaper than a road, and a longer rail cheaper than a short road", () => {
    const nodes = [
      node("depot", "central", "urban", "central"),
      node("railTown", "central", "plains"),
      node("railFar", "central", "plains"),
      node("roadTown", "central", "plains"),
    ]
    const links: SupplyLink[] = [
      { a: "depot", b: "railTown", rail: true },
      { a: "railTown", b: "railFar", rail: true },
      { a: "depot", b: "roadTown", rail: false },
    ]
    const supply = computeSupply(nodes, links)

    expect(supply.depot).toBe(100)
    expect(supply.railTown).toBe(89)
    expect(supply.railFar).toBe(78)
    expect(supply.roadTown).toBe(67)
    expect(supply.railFar).toBeGreaterThan(supply.roadTown)
  })

  it("does not trace supply through an enemy province or an enemy depot", () => {
    const nodes = [
      node("depot", "central", "urban", "central"),
      node("gate", "russia", "plains", "russia"),
      node("behind", "central", "plains"),
      node("beside", "central", "plains"),
    ]
    const links: SupplyLink[] = [
      { a: "depot", b: "gate", rail: true },
      { a: "gate", b: "behind", rail: true },
      { a: "depot", b: "beside", rail: false },
    ]
    const supply = computeSupply(nodes, links)

    expect(supply.behind).toBe(0)
    expect(supply.gate).toBe(100)
    expect(supply.beside).toBe(67)
    expect(supply.depot).toBe(100)
  })

  it("applies the stockpile modifier and clamps the result to 0–100", () => {
    const nodes = [
      node("depot", "central", "urban", "central", 40),
      node("cut", "central", "marsh", null, -15),
    ]
    const supply = computeSupply(nodes, [])
    expect(supply.depot).toBe(100)
    expect(supply.cut).toBe(0)
  })

  it("charges marsh more than plains when both are one road hop from a depot", () => {
    const nodes = [
      node("depot", "central", "urban", "central"),
      node("dry", "central", "plains"),
      node("wet", "central", "marsh"),
    ]
    const links: SupplyLink[] = [
      { a: "depot", b: "dry", rail: false },
      { a: "depot", b: "wet", rail: false },
    ]
    const supply = computeSupply(nodes, links)
    expect(supply.dry).toBe(67)
    expect(supply.wet).toBe(34)
  })
})
