import { describe, expect, it } from "vitest"
import { resolveCombat } from "@/lib/engine/combat"
import { applyAttack } from "@/lib/engine/turn"
import type { GameState, Province, Unit } from "@/lib/types"

function unit(partial: Partial<Unit> & Pick<Unit, "id">): Unit {
  return {
    name: partial.id,
    faction: "central",
    strength: 50,
    morale: 80,
    kind: "infantry",
    ...partial,
  }
}

function province(partial: Partial<Province> & Pick<Province, "id">): Province {
  return {
    name: partial.id,
    terrain: "plains",
    neighbors: [],
    rail: [],
    owner: "russia",
    controller: "russia",
    supply: 100,
    unrest: 0,
    fort: 0,
    units: [],
    supplyModifier: 0,
    ...partial,
  }
}

function state(provinces: Province[]): GameState {
  return {
    version: 1,
    turn: 0,
    date: "4 June 1915",
    seed: 1,
    provinces,
  }
}

describe("combat resolution", () => {
  it("lets a strong attack with a high roll beat a weak plain", () => {
    const outcome = resolveCombat(90, 30, 6)
    expect(outcome.roll).toBe(6)
    expect(outcome.ratio).toBeCloseTo((90 * 1.17) / 30, 5)
    expect(outcome.attackerWins).toBe(true)
    expect(outcome.defenderLossFraction).toBeGreaterThan(outcome.attackerLossFraction)
  })

  it("lets a mountain fortress hold against a weak low roll", () => {
    const outcome = resolveCombat(4, 200, 1)
    expect(outcome.attackerWins).toBe(false)
    expect(outcome.ratio).toBeLessThan(1)
    expect(outcome.attackerLossFraction).toBeGreaterThan(outcome.defenderLossFraction)
  })

  it("flips control, moves the attackers in, and retreats survivors", () => {
    const attacker = unit({
      id: "guard",
      name: "Guard Corps",
      strength: 90,
      morale: 100,
    })
    const defender = unit({
      id: "screen",
      name: "Screen",
      faction: "russia",
      strength: 30,
      morale: 100,
    })
    const game = state([
      province({
        id: "przemysl",
        name: "Przemyśl",
        controller: "central",
        owner: "central",
        neighbors: ["lemberg"],
        units: [attacker],
      }),
      province({
        id: "lemberg",
        name: "Lemberg",
        neighbors: ["przemysl", "tarnopol"],
        units: [defender],
      }),
      province({
        id: "tarnopol",
        name: "Tarnopol",
        neighbors: ["lemberg"],
      }),
    ])

    const result = applyAttack(
      game,
      { type: "attack", from: "przemysl", target: "lemberg", units: ["guard"] },
      new Set(),
      6,
    )

    expect(result.status).toBe("applied")
    expect(result.summary).toMatch(/passes to the Central Powers/)
    expect(result.summary).toMatch(/Tarnopol/)
    const lemberg = game.provinces.find((item) => item.id === "lemberg")!
    const tarnopol = game.provinces.find((item) => item.id === "tarnopol")!
    expect(lemberg.controller).toBe("central")
    expect(lemberg.units.map((item) => item.id)).toEqual(["guard"])
    expect(tarnopol.units.map((item) => item.id)).toContain("screen")
    expect(lemberg.units[0].strength).toBeLessThan(90)
  })

  it("leaves the defender in place when the attack fails", () => {
    const game = state([
      province({
        id: "rzeszow",
        name: "Rzeszów",
        controller: "central",
        owner: "central",
        supply: 40,
        neighbors: ["lemberg"],
        units: [
          unit({ id: "weak", strength: 20, morale: 50, faction: "central" }),
        ],
      }),
      province({
        id: "lemberg",
        name: "Lemberg",
        terrain: "mountain",
        fort: 3,
        neighbors: ["rzeszow"],
        units: [
          unit({ id: "wall", faction: "russia", strength: 80, morale: 100 }),
        ],
      }),
    ])

    const result = applyAttack(
      game,
      { type: "attack", from: "rzeszow", target: "lemberg", units: ["weak"] },
      new Set(),
      1,
    )

    expect(result.status).toBe("applied")
    expect(result.summary).toMatch(/fails/)
    const lemberg = game.provinces.find((item) => item.id === "lemberg")!
    const rzeszow = game.provinces.find((item) => item.id === "rzeszow")!
    expect(lemberg.controller).toBe("russia")
    expect(lemberg.units.map((item) => item.id)).toEqual(["wall"])
    expect(rzeszow.units.map((item) => item.id)).toEqual(["weak"])
    expect(rzeszow.units[0].strength).toBeLessThan(20)
  })

  it("occupies an empty province without battering the attackers", () => {
    const game = state([
      province({
        id: "tarnow",
        name: "Tarnów",
        controller: "central",
        owner: "central",
        neighbors: ["kielce"],
        units: [unit({ id: "guard", strength: 80, morale: 80 })],
      }),
      province({
        id: "kielce",
        name: "Kielce",
        neighbors: ["tarnow"],
      }),
    ])

    const result = applyAttack(
      game,
      { type: "attack", from: "tarnow", target: "kielce", units: ["guard"] },
      new Set(),
      3,
    )

    expect(result.status).toBe("applied")
    expect(result.summary).toMatch(/empty/)
    const kielce = game.provinces.find((item) => item.id === "kielce")!
    expect(kielce.controller).toBe("central")
    expect(kielce.units[0].strength).toBe(80)
  })

  it("rejects an attack that is out of supply", () => {
    const game = state([
      province({
        id: "pinsk",
        name: "Pinsk",
        controller: "central",
        owner: "central",
        supply: 12,
        neighbors: ["brest"],
        units: [unit({ id: "u", strength: 40, morale: 70 })],
      }),
      province({ id: "brest", name: "Brest-Litovsk", neighbors: ["pinsk"] }),
    ])

    const result = applyAttack(
      game,
      { type: "attack", from: "pinsk", target: "brest", units: ["u"] },
      new Set(),
      6,
    )
    expect(result.status).toBe("rejected")
    expect(result.summary).toMatch(/supply is 12/)
  })
})
