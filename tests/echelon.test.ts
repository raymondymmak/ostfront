import { describe, expect, it } from "vitest"
import { createScenario } from "@/lib/data/scenario"
import { attackerPower } from "@/lib/engine/combat"
import {
  echelonOf,
  fightingUnits,
  independentFormations,
  listedStrength,
  standingUnits,
} from "@/lib/engine/echelon"
import { applyMove, engagementOdds } from "@/lib/engine/turn"
import { UnitSchema } from "@/lib/schema"
import type { GameState, Unit } from "@/lib/types"
import { blankCampaign } from "@/lib/data/campaign"

function unit(partial: Partial<Unit> & Pick<Unit, "id">): Unit {
  return {
    name: partial.id,
    faction: "central",
    strength: 40,
    morale: 80,
    kind: "infantry",
    ...partial,
  }
}

function state(): GameState {
  return {
    ...blankCampaign(),
    version: 1,
    turn: 0,
    date: "4 June 1915",
    seed: 1,
    provinces: [
      {
        id: "krakow",
        name: "Kraków",
        terrain: "plains",
        neighbors: ["kielce"],
        rail: [],
        owner: "central",
        controller: "central",
        supply: 100,
        unrest: 0,
        fort: 0,
        supplyModifier: 0,
        units: [
          unit({ id: "army", name: "German 11th Army (Mackensen)", strength: 50, echelon: "army" }),
          unit({ id: "corps", name: "X Corps", strength: 30, echelon: "corps", parentId: "army" }),
        ],
      },
      {
        id: "kielce",
        name: "Kielce",
        terrain: "plains",
        neighbors: ["krakow"],
        rail: [],
        owner: "russia",
        controller: "russia",
        supply: 80,
        unrest: 0,
        fort: 0,
        supplyModifier: 0,
        units: [unit({ id: "screen", name: "Screen", faction: "russia", strength: 20 })],
      },
    ],
  }
}

describe("echelon", () => {
  it("treats today's formations as armies and keeps the Mackensen name", () => {
    const campaign = createScenario("campaign-1915")
    expect(campaign.provinces.every((province) => province.units.every((item) => item.echelon === "army" && !item.parentId))).toBe(true)
    const gorlice = createScenario("gorlice")
    const eleventh = gorlice.provinces.flatMap((province) => province.units).find((item) => item.id === "g-kra-11")
    expect(eleventh?.name).toBe("German 11th Army (Mackensen)")
    expect(eleventh?.echelon).toBe("army")
    expect(echelonOf(unit({ id: "old" }))).toBe("army")
  })

  it("does not count a child as a second formation while its parent is present", () => {
    const game = state()
    const stacked = game.provinces[0].units
    expect(independentFormations(stacked).map((item) => item.id)).toEqual(["army"])
    expect(fightingUnits(stacked).map((item) => item.id)).toEqual(["corps"])
    expect(listedStrength(stacked)).toBe(30)
    expect(listedStrength(stacked.filter((item) => item.id === "corps"))).toBe(30)

    const odds = engagementOdds(game, "krakow", "kielce", ["army"])
    const childOnly = attackerPower(
      [stacked[1]],
      game.provinces[0].supply,
      "plains",
    )
    const both = attackerPower(stacked, game.provinces[0].supply, "plains")
    expect(odds?.attack).toBeCloseTo(childOnly)
    expect(odds?.attack).toBeLessThan(both)
  })

  it("lets a detached child fight, and moves subordinates with the parent", () => {
    const detached = [unit({ id: "corps", echelon: "corps", parentId: "army", strength: 22 })]
    expect(independentFormations(detached).map((item) => item.id)).toEqual(["corps"])
    expect(fightingUnits(detached)[0].strength).toBe(22)

    const game = state()
    const kielce = game.provinces.find((province) => province.id === "kielce")!
    kielce.controller = "central"
    kielce.units = []
    const played = applyMove(game, { type: "move", unit: "army", to: "kielce" }, new Set())
    expect(played.status).toBe("applied")
    const krakow = game.provinces.find((province) => province.id === "krakow")!
    expect(kielce.units.map((item) => item.id).sort()).toEqual(["army", "corps"])
    expect(krakow.units).toHaveLength(0)
  })

  it("keeps a command node that still has children, and accepts an old unit as an army", () => {
    const parent = unit({ id: "army", strength: 0, morale: 0, echelon: "army" })
    const child = unit({ id: "div", echelon: "division", parentId: "army", strength: 12 })
    expect(standingUnits([parent, child]).map((item) => item.id)).toEqual(["army", "div"])
    expect(standingUnits([parent]).map((item) => item.id)).toEqual([])
    const parsed = UnitSchema.parse({
      id: "legacy",
      name: "Guard",
      faction: "central",
      strength: 10,
      morale: 70,
      kind: "infantry",
    })
    expect(parsed.echelon).toBe("army")
    expect(parsed.parentId).toBeUndefined()
  })
})
