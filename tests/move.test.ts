import { describe, expect, it } from "vitest"
import { resolveTurn } from "@/lib/engine/turn"
import type { Faction, GameState, GMTurn, Province, Unit } from "@/lib/types"

function unit(id: string, faction: Faction = "central"): Unit {
  return {
    id,
    name: id,
    faction,
    strength: 40,
    morale: 70,
    kind: "infantry",
  }
}

function province(partial: Partial<Province> & Pick<Province, "id">): Province {
  return {
    name: partial.name ?? partial.id,
    terrain: "plains",
    neighbors: [],
    rail: [],
    owner: "central",
    controller: "central",
    supply: 0,
    unrest: 0,
    fort: 0,
    units: [],
    supplyModifier: 0,
    ...partial,
  }
}

function quiet(proposals: GMTurn["proposals"] = []): GMTurn {
  return { narration: "", proposals, events: [], diplomacy: [] }
}

function front(): GameState {
  return {
    version: 1,
    turn: 3,
    date: "30 July 1915",
    seed: 7,
    provinces: [
      province({
        id: "depot",
        name: "Kraków",
        terrain: "urban",
        neighbors: ["near"],
        rail: ["near"],
        depot: "central",
        units: [unit("garrison")],
      }),
      province({
        id: "near",
        name: "Tarnów",
        neighbors: ["depot", "far", "enemy"],
        rail: ["depot"],
        units: [unit("beskiden")],
      }),
      province({
        id: "far",
        name: "Rzeszów",
        neighbors: ["near"],
      }),
      province({
        id: "enemy",
        name: "Lemberg",
        owner: "russia",
        controller: "russia",
        neighbors: ["near"],
        units: [unit("eighth", "russia")],
      }),
      province({
        id: "island",
        name: "Pinsk",
        neighbors: ["island2"],
        units: [unit("stuck")],
      }),
      province({
        id: "island2",
        name: "Kovel",
        neighbors: ["island"],
      }),
    ],
  }
}

describe("move legality", () => {
  it("moves along a friendly border when supply is at least 30", () => {
    const game = front()
    const { state, record } = resolveTurn(
      game,
      quiet([{ type: "move", unit: "beskiden", to: "far" }]),
    )
    const far = state.provinces.find((item) => item.id === "far")!
    const near = state.provinces.find((item) => item.id === "near")!
    expect(record.resolutions[0].status).toBe("applied")
    expect(far.units.map((item) => item.id)).toEqual(["beskiden"])
    expect(near.units).toHaveLength(0)
    expect(game.provinces.find((item) => item.id === "near")!.units).toHaveLength(1)
  })

  it("rejects a move that leaves the rail network, crosses a gap, or enters an enemy province", () => {
    const starved = resolveTurn(
      front(),
      quiet([{ type: "move", unit: "stuck", to: "island2" }]),
    )
    expect(starved.record.resolutions[0].status).toBe("rejected")
    expect(starved.record.resolutions[0].summary).toMatch(/supply is 0 \(need 30\)/)

    const gap = resolveTurn(
      front(),
      quiet([{ type: "move", unit: "garrison", to: "far" }]),
    )
    expect(gap.record.resolutions[0].status).toBe("rejected")
    expect(gap.record.resolutions[0].summary).toMatch(/do not share a border/)

    const hostile = resolveTurn(
      front(),
      quiet([{ type: "move", unit: "beskiden", to: "enemy" }]),
    )
    expect(hostile.record.resolutions[0].status).toBe("rejected")
    expect(hostile.record.resolutions[0].summary).toMatch(/Attack instead/)
  })

  it("lets a formation receive only one order a fortnight", () => {
    const { record, state } = resolveTurn(
      front(),
      quiet([
        { type: "move", unit: "beskiden", to: "far" },
        { type: "move", unit: "beskiden", to: "near" },
      ]),
    )
    expect(record.resolutions[0].status).toBe("applied")
    expect(record.resolutions[1].status).toBe("rejected")
    expect(record.resolutions[1].summary).toMatch(/already has orders/)
    expect(
      state.provinces.find((item) => item.id === "far")!.units.map((item) => item.id),
    ).toEqual(["beskiden"])
  })
})
