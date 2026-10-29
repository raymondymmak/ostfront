import { describe, expect, it } from "vitest"
import { stavkaTurn } from "@/lib/ai/stavka"
import { blankCampaign } from "@/lib/data/campaign"
import { createInitialState } from "@/lib/data/scenario"
import { applySupply } from "@/lib/data/scenario"
import { combinedEngagementOdds, engagementOdds, resolveTurn } from "@/lib/engine/turn"
import type { Faction, GameState, GMTurn, Proposal, Province, Unit } from "@/lib/types"

function unit(id: string, faction: Faction = "central", strength = 40): Unit {
  return { id, name: id, faction, strength, morale: 100, kind: "infantry" }
}

function province(partial: Partial<Province> & Pick<Province, "id">): Province {
  return {
    name: partial.name ?? partial.id,
    terrain: "plains",
    neighbors: [],
    rail: [],
    owner: partial.controller ?? "central",
    controller: "central",
    supply: 100,
    unrest: 0,
    fort: 0,
    units: [],
    supplyModifier: 0,
    ...partial,
  }
}

function game(provinces: Province[], seed = 1): GameState {
  return {
    ...blankCampaign(),
    version: 1,
    turn: 2,
    date: "30 May 1915",
    seed,
    provinces,
  }
}

function orders(proposals: Proposal[]): GMTurn {
  return { narration: "", proposals, events: [], diplomacy: [] }
}

function highRoll(): () => number {
  return () => 0.99
}

function place(state: GameState, id: string): string | undefined {
  return state.provinces.find((province) => province.units.some((unit) => unit.id === id))?.id
}

describe("simultaneous orders", () => {
  it("gives the same result when the proposal list is reversed", () => {
    const board = () =>
      game([
        province({
          id: "krakow",
          name: "Kraków",
          neighbors: ["lublin", "kielce"],
          depot: "central",
          units: [unit("eleventh", "central", 70), unit("guard", "central", 50)],
        }),
        province({
          id: "lublin",
          name: "Lublin",
          controller: "russia",
          owner: "russia",
          neighbors: ["krakow"],
          depot: "russia",
          units: [unit("third", "russia", 40)],
        }),
        province({
          id: "kielce",
          name: "Kielce",
          controller: "russia",
          owner: "russia",
          neighbors: ["krakow", "radom"],
          units: [unit("screen", "russia", 30)],
        }),
        province({
          id: "radom",
          name: "Radom",
          controller: "russia",
          owner: "russia",
          neighbors: ["kielce"],
          depot: "russia",
          units: [unit("reserve", "russia", 36)],
        }),
      ])
    const forward: Proposal[] = [
      { type: "attack", from: "krakow", target: "lublin", units: ["eleventh"] },
      { type: "move", unit: "guard", to: "krakow" },
      { type: "attack", from: "radom", target: "kielce", units: ["reserve"] },
      { type: "fortify", province: "lublin" },
    ]
    const backward = [...forward].reverse()
    const first = resolveTurn(board(), orders(forward), { rng: highRoll() })
    const second = resolveTurn(board(), orders(backward), { rng: highRoll() })
    expect(snapshot(second.state)).toEqual(snapshot(first.state))
    expect(second.record.resolutions.map((item) => item.summary).sort()).toEqual(
      first.record.resolutions.map((item) => item.summary).sort(),
    )
  })

  it("assigns dice by battle key, not by the order of the list", () => {
    const board = () =>
      game([
        province({
          id: "a",
          name: "Alpha",
          neighbors: ["b"],
          depot: "central",
          units: [unit("guns", "central", 80)],
        }),
        province({
          id: "b",
          name: "Beta",
          controller: "russia",
          owner: "russia",
          neighbors: ["a"],
          units: [unit("hold-b", "russia", 50)],
        }),
        province({
          id: "c",
          name: "Gamma",
          neighbors: ["d"],
          depot: "central",
          units: [unit("line", "central", 80)],
        }),
        province({
          id: "d",
          name: "Delta",
          controller: "russia",
          owner: "russia",
          neighbors: ["c"],
          depot: "russia",
          units: [unit("hold-d", "russia", 50)],
        }),
      ])
    const proposals: Proposal[] = [
      { type: "attack", from: "c", target: "d", units: ["line"] },
      { type: "attack", from: "a", target: "b", units: ["guns"] },
    ]
    const play = (list: Proposal[]) => {
      let n = 0
      return resolveTurn(board(), orders(list), {
        rng: () => {
          n += 1
          return n === 1 ? 0 : 0.99
        },
      })
    }
    const first = play(proposals)
    const second = play([...proposals].reverse())
    expect(second.record.resolutions.map((item) => item.summary).sort()).toEqual(
      first.record.resolutions.map((item) => item.summary).sort(),
    )
  })

  it("fights a meeting engagement when both sides attack across one border", () => {
    const played = resolveTurn(
      game([
        province({
          id: "krakow",
          name: "Kraków",
          neighbors: ["kielce"],
          depot: "central",
          units: [unit("eleventh", "central", 70)],
        }),
        province({
          id: "kielce",
          name: "Kielce",
          controller: "russia",
          owner: "russia",
          neighbors: ["krakow"],
          depot: "russia",
          units: [unit("corps", "russia", 55)],
        }),
      ]),
      orders([
        { type: "attack", from: "kielce", target: "krakow", units: ["corps"] },
        { type: "attack", from: "krakow", target: "kielce", units: ["eleventh"] },
      ]),
      { rng: highRoll() },
    )
    const line = played.record.resolutions.map((item) => item.summary).join(" ")
    expect(line).toMatch(/Meeting engagement/)
    expect(line).toMatch(/clash/)
    expect(line).toMatch(/both fall back/)
    expect(played.state.provinces.find((item) => item.id === "krakow")!.controller).toBe("central")
    expect(played.state.provinces.find((item) => item.id === "kielce")!.controller).toBe("russia")
    expect(place(played.state, "eleventh")).toBe("krakow")
    expect(place(played.state, "corps")).toBe("kielce")
    expect(played.state.provinces.flatMap((item) => item.units).every((item) => item.strength < 70)).toBe(true)
  })

  it("lets a column attack at full strength and still defend at half", () => {
    function field() {
      return game([
        province({
          id: "home",
          name: "Home",
          neighbors: ["target", "flank"],
          depot: "central",
          units: [unit("column", "central", 80)],
        }),
        province({
          id: "target",
          name: "Target",
          controller: "russia",
          owner: "russia",
          neighbors: ["home"],
          units: [unit("village", "russia", 20)],
        }),
        province({
          id: "flank",
          name: "Flank",
          controller: "russia",
          owner: "russia",
          neighbors: ["home"],
          depot: "russia",
          units: [unit("pincer", "russia", 50)],
        }),
      ])
    }
    const stayed = resolveTurn(
      field(),
      orders([{ type: "attack", from: "flank", target: "home", units: ["pincer"] }]),
      { rng: highRoll() },
    )
    const marched = resolveTurn(
      field(),
      orders([
        { type: "attack", from: "home", target: "target", units: ["column"] },
        { type: "attack", from: "flank", target: "home", units: ["pincer"] },
      ]),
      { rng: highRoll() },
    )
    expect(stayed.state.provinces.find((item) => item.id === "home")!.controller).toBe("central")
    expect(marched.record.resolutions.some((item) => /rear guard/i.test(item.summary))).toBe(true)
    expect(marched.state.provinces.find((item) => item.id === "home")!.controller).toBe("russia")
    expect(marched.state.provinces.find((item) => item.id === "target")!.controller).toBe("central")
    expect(place(marched.state, "column")).toBe("target")
  })

  it("occupies a province the garrison is leaving, and bounces when both sides enter an empty one", () => {
    const vacated = resolveTurn(
      game([
        province({
          id: "base",
          name: "Base",
          neighbors: ["field"],
          depot: "central",
          units: [unit("eleventh", "central", 40)],
        }),
        province({
          id: "field",
          name: "Field",
          controller: "russia",
          owner: "russia",
          neighbors: ["base", "rear"],
          units: [unit("screen", "russia", 30)],
        }),
        province({
          id: "rear",
          name: "Rear",
          controller: "russia",
          owner: "russia",
          neighbors: ["field"],
          depot: "russia",
          units: [],
        }),
      ]),
      orders([
        { type: "move", unit: "screen", to: "rear" },
        { type: "attack", from: "base", target: "field", units: ["eleventh"] },
      ]),
      { rng: highRoll() },
    )
    expect(vacated.record.resolutions.some((item) => /province was empty/i.test(item.summary))).toBe(true)
    expect(vacated.state.provinces.find((item) => item.id === "field")!.controller).toBe("central")
    expect(place(vacated.state, "screen")).toBe("rear")
    expect(place(vacated.state, "eleventh")).toBe("field")

    const bounced = resolveTurn(
      game([
        province({
          id: "base",
          name: "Base",
          neighbors: ["field"],
          depot: "central",
          units: [unit("eleventh", "central", 40)],
        }),
        province({
          id: "field",
          name: "Field",
          controller: "russia",
          owner: "russia",
          neighbors: ["base", "rear"],
          units: [],
        }),
        province({
          id: "rear",
          name: "Rear",
          controller: "russia",
          owner: "russia",
          neighbors: ["field"],
          depot: "russia",
          units: [unit("screen", "russia", 30)],
        }),
      ]),
      orders([
        { type: "attack", from: "base", target: "field", units: ["eleventh"] },
        { type: "move", unit: "screen", to: "field" },
      ]),
      { rng: highRoll() },
    )
    const text = bounced.record.resolutions.map((item) => item.summary).join(" ")
    expect(text).toMatch(/Bounce at Field/)
    expect(text).toMatch(/falls back/)
    expect(bounced.state.provinces.find((item) => item.id === "field")!.controller).toBe("russia")
    expect(bounced.state.provinces.find((item) => item.id === "field")!.units).toHaveLength(0)
    expect(place(bounced.state, "eleventh")).toBe("base")
    expect(place(bounced.state, "screen")).toBe("rear")
  })

  it("passes friendly columns that exchange provinces", () => {
    const played = resolveTurn(
      game([
        province({
          id: "krakow",
          name: "Kraków",
          neighbors: ["tarnow"],
          depot: "central",
          units: [unit("eleventh")],
        }),
        province({
          id: "tarnow",
          name: "Tarnów",
          neighbors: ["krakow"],
          units: [unit("guard")],
        }),
      ]),
      orders([
        { type: "move", unit: "guard", to: "krakow" },
        { type: "move", unit: "eleventh", to: "tarnow" },
      ]),
    )
    expect(place(played.state, "eleventh")).toBe("tarnow")
    expect(place(played.state, "guard")).toBe("krakow")
    expect(played.record.resolutions.some((item) => /passing/.test(item.summary))).toBe(true)
  })

  it("turns back a reinforcement when the province falls, and lets it enter when the province holds", () => {
    function field(garrison: number) {
      return game([
        province({
          id: "home",
          name: "Home",
          neighbors: ["flank", "reserve"],
          depot: "central",
          units: [unit("garrison", "central", garrison)],
        }),
        province({
          id: "reserve",
          name: "Reserve",
          neighbors: ["home"],
          units: [unit("relief", "central", 30)],
        }),
        province({
          id: "flank",
          name: "Flank",
          controller: "russia",
          owner: "russia",
          neighbors: ["home"],
          depot: "russia",
          units: [unit("pincer", "russia", 90)],
        }),
      ])
    }
    const fell = resolveTurn(
      field(20),
      orders([
        { type: "move", unit: "relief", to: "home" },
        { type: "attack", from: "flank", target: "home", units: ["pincer"] },
      ]),
      { rng: highRoll() },
    )
    expect(fell.state.provinces.find((item) => item.id === "home")!.controller).toBe("russia")
    expect(place(fell.state, "relief")).toBe("reserve")
    expect(fell.record.resolutions.some((item) => /falls this fortnight/.test(item.summary))).toBe(true)

    const held = resolveTurn(
      field(200),
      orders([
        { type: "move", unit: "relief", to: "home" },
        { type: "attack", from: "flank", target: "home", units: ["pincer"] },
      ]),
      { rng: () => 0 },
    )
    expect(held.state.provinces.find((item) => item.id === "home")!.controller).toBe("central")
    expect(place(held.state, "relief")).toBe("home")
  })

  it("fights with the supply from the start of the turn when a depot falls", () => {
    const board = game([
      province({
        id: "depot",
        name: "Depot",
        neighbors: ["near"],
        rail: ["near"],
        depot: "central",
        units: [unit("garrison", "central", 20)],
      }),
      province({
        id: "near",
        name: "Near",
        neighbors: ["depot", "enemy"],
        rail: ["depot"],
        units: [unit("column", "central", 80), unit("stay", "central", 20)],
      }),
      province({
        id: "enemy",
        name: "Enemy",
        controller: "russia",
        owner: "russia",
        neighbors: ["near"],
        units: [unit("screen", "russia", 20)],
      }),
      province({
        id: "wing",
        name: "Wing",
        controller: "russia",
        owner: "russia",
        neighbors: ["depot"],
        depot: "russia",
        units: [unit("strike", "russia", 90)],
      }),
    ])
    applySupply(board)
    const preview = engagementOdds(board, "near", "enemy", ["column"])
    const played = resolveTurn(
      structuredClone(board),
      orders([
        { type: "attack", from: "near", target: "enemy", units: ["column"] },
        { type: "attack", from: "wing", target: "depot", units: ["strike"] },
      ]),
      { rng: () => 0 },
    )
    const attack = played.record.resolutions.find((item) => item.summary.includes("Near"))
    expect(preview).not.toBeNull()
    expect(attack?.summary).toContain(((preview!.ratio * 0.82).toFixed(2)))
    expect(played.state.provinces.find((item) => item.id === "depot")!.controller).toBe("russia")
    expect(played.state.provinces.find((item) => item.id === "near")!.supply).toBeLessThan(30)
    expect(played.record.logistics.some((line) => /Near is cut off this fortnight/.test(line))).toBe(true)
  })

  it("digs before the battles, for both sides", () => {
    const board = () =>
      game([
        province({
          id: "home",
          name: "Home",
          neighbors: ["town"],
          depot: "central",
          units: [unit("guns", "central", 60)],
        }),
        province({
          id: "town",
          name: "Town",
          controller: "russia",
          owner: "russia",
          neighbors: ["home"],
          depot: "russia",
          fort: 0,
          units: [unit("wall", "russia", 70)],
        }),
      ])
    const bare = resolveTurn(board(), orders([{ type: "attack", from: "home", target: "town", units: ["guns"] }]), {
      rng: highRoll(),
    })
    const dug = resolveTurn(
      board(),
      orders([
        { type: "attack", from: "home", target: "town", units: ["guns"] },
        { type: "fortify", province: "town" },
      ]),
      { rng: highRoll() },
    )
    const odds = (summary: string) => Number(summary.match(/odds (\d+\.\d+)/)?.[1])
    expect(dug.state.provinces.find((item) => item.id === "town")!.fort).toBeGreaterThanOrEqual(1)
    expect(odds(dug.record.resolutions.find((item) => item.proposal.type === "attack")!.summary)).toBeLessThan(
      odds(bare.record.resolutions.find((item) => item.proposal.type === "attack")!.summary),
    )
  })

  it("keeps a pooled attack consistent with the odds preview", () => {
    const board = game([
      province({
        id: "krakow",
        name: "Kraków",
        neighbors: ["lublin"],
        depot: "central",
        units: [unit("eleventh", "central", 70)],
      }),
      province({
        id: "kielce",
        name: "Kielce",
        neighbors: ["lublin"],
        depot: "central",
        units: [unit("guard", "central", 60)],
      }),
      province({
        id: "lublin",
        name: "Lublin",
        controller: "russia",
        owner: "russia",
        neighbors: ["krakow", "kielce"],
        depot: "russia",
        units: [unit("third", "russia", 80)],
      }),
    ])
    const preview = combinedEngagementOdds(board, "lublin", [
      { fromId: "krakow", unitIds: ["eleventh"] },
      { fromId: "kielce", unitIds: ["guard"] },
    ])
    const played = resolveTurn(
      board,
      orders([
        { type: "attack", from: "kielce", target: "lublin", units: ["guard"] },
        { type: "attack", from: "krakow", target: "lublin", units: ["eleventh"] },
      ]),
      { rng: () => 0 },
    )
    const line = played.record.resolutions.find((item) => item.proposal.type === "attack")!.summary
    expect(line).toMatch(/Two-pronged attack/)
    expect(line).toContain((preview!.ratio * 0.82).toFixed(2))
    expect(played.record.resolutions.filter((item) => item.proposal.type === "attack")).toHaveLength(1)
  })

  it("plans Stavka from the opening map and ignores Central Powers orders", () => {
    const state = createInitialState("normal")
    state.turn = 2
    const blind = stavkaTurn(state, [])
    const shown = stavkaTurn(state, [
      { type: "attack", from: "krakow", target: "lwow", unitIds: ["g-kra-11", "g-kra-grd", "g-kra-art"] },
      { type: "text", text: "Abandon Kraków and throw the 11th Army at Lemberg." },
      { type: "move", unitId: "g-kra-x", to: "katowice" },
    ])
    expect(shown.proposals).toEqual(blind.proposals)
    expect(shown.narration).toEqual(blind.narration)
    expect(shown.events).toEqual(blind.events)
    expect(shown.diplomacy).toEqual(blind.diplomacy)
    expect(shown.narration).not.toMatch(/Abandon Kraków/)
    expect(shown.narration).toMatch(/not on that map/)
  })
})

function snapshot(state: GameState): unknown {
  return state.provinces
    .map((province) => ({
      id: province.id,
      controller: province.controller,
      fort: province.fort,
      units: province.units.map((unit) => ({ id: unit.id, strength: unit.strength, morale: unit.morale })),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}
