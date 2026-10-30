import { describe, expect, it } from "vitest"
import { blankCampaign } from "@/lib/data/campaign"
import { applySupply, createInitialState } from "@/lib/data/scenario"
import { buildStaffTurn } from "@/lib/gm/cascade"
import { combinedEngagementOdds, resolveTurn } from "@/lib/engine/turn"
import type { Faction, GameEvent, GameState, GMTurn, Proposal, Province, Unit } from "@/lib/types"

function unit(id: string, faction: Faction, strength: number): Unit {
  return { id, name: id, faction, strength, morale: 70, kind: "infantry" }
}

function province(partial: Partial<Province> & Pick<Province, "id">): Province {
  return {
    name: partial.name ?? partial.id,
    terrain: "plains",
    neighbors: [],
    rail: [],
    owner: "central",
    controller: "central",
    supply: 100,
    unrest: 0,
    fort: 0,
    units: [],
    supplyModifier: 0,
    ...partial,
  }
}

function game(provinces: Province[]): GameState {
  return {
    ...blankCampaign(),
    version: 1,
    turn: 2,
    date: "30 May 1915",
    seed: 1,
    provinces,
  }
}

function turn(partial: Partial<GMTurn> & Pick<GMTurn, "events" | "proposals">): GMTurn {
  return { narration: "", diplomacy: [], ...partial }
}

function snapshot(state: GameState, id: string) {
  const province = state.provinces.find((item) => item.id === id)!
  return {
    unrest: province.unrest,
    supply: province.supply,
    supplyModifier: province.supplyModifier,
    units: province.units.map((item) => ({
      id: item.id,
      strength: item.strength,
      morale: item.morale,
    })),
  }
}

const blocked: GameEvent[] = [
  { type: "partisans", province: "krakow" },
  { type: "epidemic", province: "krakow" },
  { type: "strike", province: "katowice" },
  { type: "breakthrough", province: "krakow" },
]

describe("event gate", () => {
  it("rejects events on Central Powers home soil and leaves the provinces unchanged", () => {
    const opening = createInitialState("normal")
    const quiet = resolveTurn(structuredClone(opening), turn({ proposals: [], events: [] }))
    const played = resolveTurn(structuredClone(opening), turn({ proposals: [], events: blocked }))

    expect(played.record.events.map((item) => item.status)).toEqual([
      "rejected",
      "rejected",
      "rejected",
      "rejected",
    ])
    expect(played.record.events.every((item) => item.summary.includes("Central Powers home soil"))).toBe(
      true,
    )
    expect(snapshot(played.state, "krakow")).toEqual(snapshot(quiet.state, "krakow"))
    expect(snapshot(played.state, "katowice")).toEqual(snapshot(quiet.state, "katowice"))
    expect(played.state.cpStrengthLost).toBe(opening.cpStrengthLost)
    expect(played.state.cpStrengthLost).toBe(quiet.state.cpStrengthLost)
  })

  it("keeps engine-rejected game-master events on the turn, marked rejected", () => {
    const state = createInitialState("normal")
    const interpreted = { proposals: [] as Proposal[], notes: [] as string[] }
    const gm = buildStaffTurn(
      state,
      turn({ proposals: [], events: blocked }),
      interpreted,
    )
    expect(gm.events).toEqual(blocked.slice(0, 3))
    expect(interpreted.notes).toEqual([])
    const played = resolveTurn(structuredClone(state), gm)
    expect(played.record.events.map((item) => item.status)).toEqual(["rejected", "rejected", "rejected"])
    expect(played.record.events.every((item) => item.summary.includes("Central Powers home soil"))).toBe(
      true,
    )
  })

  it("still applies partisans in an occupied province with unrest of 60", () => {
    const board = () => {
      const state = createInitialState("normal")
      const kielce = state.provinces.find((item) => item.id === "kielce")!
      kielce.controller = "central"
      kielce.unrest = 60
      kielce.units = [unit("weak", "central", 20), unit("strong", "central", 50)]
      return state
    }
    const quiet = resolveTurn(board(), turn({ proposals: [], events: [] }))
    const played = resolveTurn(
      board(),
      turn({ proposals: [], events: [{ type: "partisans", province: "kielce" }] }),
    )
    const event = played.record.events[0]
    expect(event.status).toBe("applied")
    expect(event.summary).toMatch(/Unrest is now 75/)
    expect(event.summary).toMatch(/strong loses 8 strength/)
    const after = played.state.provinces.find((item) => item.id === "kielce")!
    const before = quiet.state.provinces.find((item) => item.id === "kielce")!
    expect(after.unrest - before.unrest).toBe(15)
    expect(after.units.find((item) => item.id === "strong")!.strength).toBe(
      before.units.find((item) => item.id === "strong")!.strength - 8,
    )
  })

  it("counts partisans against the unrest budget and still hits the garrison", () => {
    const board = () => {
      const state = createInitialState("normal")
      const kielce = state.provinces.find((item) => item.id === "kielce")!
      kielce.controller = "central"
      kielce.unrest = 40
      kielce.units = [unit("strong", "central", 50)]
      return state
    }
    const modify: Proposal = {
      type: "modify",
      province: "kielce",
      field: "unrest",
      delta: 20,
      reason: "agitation",
    }
    const quiet = resolveTurn(board(), turn({ proposals: [modify], events: [] }))
    const played = resolveTurn(
      board(),
      turn({ proposals: [modify], events: [{ type: "partisans", province: "kielce" }] }),
    )
    const after = played.state.provinces.find((item) => item.id === "kielce")!
    const before = quiet.state.provinces.find((item) => item.id === "kielce")!
    expect(after.unrest).toBe(before.unrest)
    expect(after.unrest - 40).toBe(25)
    expect(after.unrest - 5).toBe(60)
    expect(played.record.events[0].summary).toMatch(/fortnight's limit/)
    expect(after.units.find((item) => item.id === "strong")!.strength).toBe(
      before.units.find((item) => item.id === "strong")!.strength - 8,
    )
  })

  it("applies a strike before the battle so the defender fights at the lower supply", () => {
    const board = game([
      province({
        id: "base",
        name: "Base",
        neighbors: ["town"],
        depot: "central",
        units: [unit("guns", "central", 70)],
      }),
      province({
        id: "town",
        name: "Town",
        owner: "russia",
        controller: "russia",
        neighbors: ["base"],
        depot: "russia",
        units: [unit("wall", "russia", 40)],
      }),
    ])
    applySupply(board)
    const struck = structuredClone(board)
    struck.provinces.find((item) => item.id === "town")!.supplyModifier -= 15
    applySupply(struck)
    const preview = combinedEngagementOdds(struck, "town", [{ fromId: "base", unitIds: ["guns"] }])
    const untouched = combinedEngagementOdds(board, "town", [{ fromId: "base", unitIds: ["guns"] }])
    const played = resolveTurn(
      structuredClone(board),
      turn({
        proposals: [{ type: "attack", from: "base", target: "town", units: ["guns"] }],
        events: [{ type: "strike", province: "town" }],
      }),
      { rng: () => 0 },
    )
    const attack = played.record.resolutions.find((item) => item.proposal.type === "attack")!
    expect(played.record.events[0].status).toBe("applied")
    expect(preview).not.toBeNull()
    expect(untouched).not.toBeNull()
    expect(preview!.ratio).toBeGreaterThan(untouched!.ratio)
    expect(attack.summary).toContain(`odds ${(preview!.ratio * 0.82).toFixed(2)}`)
    expect(attack.summary).not.toContain(`odds ${(untouched!.ratio * 0.82).toFixed(2)}`)
  })
})
