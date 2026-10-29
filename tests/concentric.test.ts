import { describe, expect, it } from "vitest"
import { stavkaTurn } from "@/lib/ai/stavka"
import { blankCampaign } from "@/lib/data/campaign"
import { flankMultiplier } from "@/lib/engine/combat"
import { combinedEngagementOdds, resolveTurn } from "@/lib/engine/turn"
import type { GameState, Province, Unit } from "@/lib/types"

function unit(partial: Partial<Unit> & Pick<Unit, "id">): Unit {
  return {
    name: partial.id,
    faction: "central",
    strength: 50,
    morale: 100,
    kind: "infantry",
    ...partial,
  }
}

function province(partial: Partial<Province> & Pick<Province, "id">): Province {
  return {
    name: partial.name ?? partial.id,
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

function state(provinces: Province[], difficulty: GameState["difficulty"] = "normal"): GameState {
  return {
    ...blankCampaign(difficulty),
    version: 1,
    turn: 1,
    date: "18 June 1915",
    seed: 1,
    provinces,
    treasury: {
      central: { mp: 0, ip: 0 },
      russia: { mp: 0, ip: 0 },
    },
  }
}

function highRoll(): () => number {
  return () => 0.99
}

describe("concentric attacks", () => {
  it("scales the flank bonus and then stops growing", () => {
    expect(flankMultiplier(1)).toBe(1)
    expect(flankMultiplier(2)).toBe(1.12)
    expect(flankMultiplier(3)).toBe(1.22)
    expect(flankMultiplier(5)).toBe(1.3)
  })

  it("fights two provinces as one battle and previews the combined odds", () => {
    const game = state([
      province({
        id: "krakow",
        name: "Kraków",
        controller: "central",
        owner: "central",
        neighbors: ["lublin"],
        depot: "central",
        units: [unit({ id: "eleventh", name: "11th Army", strength: 70 })],
      }),
      province({
        id: "kielce",
        name: "Kielce",
        controller: "central",
        owner: "central",
        neighbors: ["lublin"],
        depot: "central",
        units: [unit({ id: "guard", name: "Guard", strength: 60 })],
      }),
      province({
        id: "lublin",
        name: "Lublin",
        neighbors: ["krakow", "kielce", "wolyn"],
        depot: "russia",
        units: [unit({ id: "third", name: "3rd Army", faction: "russia", strength: 80 })],
      }),
      province({
        id: "wolyn",
        name: "Volhynia",
        neighbors: ["lublin"],
      }),
    ])
    const alone = combinedEngagementOdds(game, "lublin", [
      { fromId: "krakow", unitIds: ["eleventh"] },
    ])
    const both = combinedEngagementOdds(game, "lublin", [
      { fromId: "krakow", unitIds: ["eleventh"] },
      { fromId: "kielce", unitIds: ["guard"] },
    ])
    expect(both).not.toBeNull()
    expect(both!.origins).toBe(2)
    expect(both!.multiplier).toBe(1.12)
    expect(both!.encircled).toBe(false)
    expect(both!.ratio).toBeGreaterThan(alone!.ratio)
    expect(both!.ratio).toBeCloseTo(((70 + 60) * 1.12) / 80, 5)

    const first = resolveTurn(
      game,
      {
        narration: "",
        proposals: [
          { type: "attack", from: "krakow", target: "lublin", units: ["eleventh"] },
          { type: "move", unit: "ignored", to: "lublin" },
          { type: "attack", from: "kielce", target: "lublin", units: ["guard"] },
        ],
        events: [],
        diplomacy: [],
      },
      { rng: highRoll() },
    )
    const attacks = first.record.resolutions.filter((item) => item.proposal.type === "attack")
    expect(attacks).toHaveLength(1)
    expect(attacks[0].summary).toMatch(/Two-pronged attack from (Kraków and Kielce|Kielce and Kraków) into Lublin/)
    expect(attacks[0].summary).toMatch(/Volhynia/)
    const lublin = first.state.provinces.find((item) => item.id === "lublin")!
    expect(lublin.controller).toBe("central")
    expect(lublin.units.map((item) => item.id).sort()).toEqual(["eleventh", "guard"])
    expect(lublin.units.every((item) => item.strength < (item.id === "eleventh" ? 70 : 60))).toBe(true)
    const again = resolveTurn(
      game,
      {
        narration: "",
        proposals: [
          { type: "attack", from: "krakow", target: "lublin", units: ["eleventh"] },
          { type: "attack", from: "kielce", target: "lublin", units: ["guard"] },
        ],
        events: [],
        diplomacy: [],
      },
      { rng: highRoll() },
    )
    expect(again.record.resolutions.find((item) => item.proposal.type === "attack")?.summary).toBe(
      attacks[0].summary,
    )
  })

  it("does not let Russia attack a province it still holds when the fortnight opens", () => {
    const game = state([
      province({
        id: "krakow",
        name: "Kraków",
        controller: "central",
        owner: "central",
        neighbors: ["kielce"],
        depot: "central",
        units: [unit({ id: "eleventh", name: "11th Army", strength: 90 })],
      }),
      province({
        id: "kielce",
        name: "Kielce",
        neighbors: ["krakow", "warszawa"],
        depot: "russia",
        units: [unit({ id: "screen", name: "Screen", faction: "russia", strength: 20 })],
      }),
      province({
        id: "warszawa",
        name: "Warsaw",
        neighbors: ["kielce"],
        depot: "russia",
        units: [unit({ id: "garrison", name: "Garrison", faction: "russia", strength: 40 })],
      }),
    ])
    const played = resolveTurn(
      game,
      {
        narration: "",
        proposals: [
          { type: "attack", from: "krakow", target: "kielce", units: ["eleventh"] },
          { type: "attack", from: "warszawa", target: "kielce", units: ["garrison"] },
        ],
        events: [],
        diplomacy: [],
      },
      { rng: highRoll() },
    )
    const summaries = played.record.resolutions
      .filter((item) => item.proposal.type === "attack")
      .map((item) => item.summary)
    expect(summaries.some((line) => line.startsWith("Two-pronged"))).toBe(false)
    expect(summaries.some((line) => line.includes("Attack from Kraków"))).toBe(true)
    expect(summaries.some((line) => /already held by your side/.test(line))).toBe(true)
    expect(played.state.provinces.find((item) => item.id === "warszawa")!.units.map((item) => item.id)).toEqual([
      "garrison",
    ])
  })

  it("destroys a surrounded garrison and hurts it more than a garrison with an exit", () => {
    function field(exit: boolean): GameState {
      return state([
        province({
          id: "north",
          name: "North",
          controller: "central",
          owner: "central",
          neighbors: ["pocket"],
          depot: "central",
          units: [unit({ id: "north-corps", strength: 80 })],
        }),
        province({
          id: "south",
          name: "South",
          controller: "central",
          owner: "central",
          neighbors: ["pocket"],
          depot: "central",
          units: [unit({ id: "south-corps", strength: 80 })],
        }),
        province({
          id: "pocket",
          name: "Pocket",
          neighbors: exit ? ["north", "south", "rear"] : ["north", "south"],
          depot: "russia",
          units: [unit({ id: "trapped", name: "Trapped", faction: "russia", strength: 40 })],
        }),
        province({ id: "rear", name: "Rear", neighbors: ["pocket"] }),
      ])
    }
    const proposals = [
      { type: "attack" as const, from: "north", target: "pocket", units: ["north-corps"] },
      { type: "attack" as const, from: "south", target: "pocket", units: ["south-corps"] },
    ]
    const open = resolveTurn(field(true), { narration: "", proposals, events: [], diplomacy: [] }, { rng: highRoll() })
    const shut = resolveTurn(field(false), { narration: "", proposals, events: [], diplomacy: [] }, { rng: highRoll() })
    const openLine = open.record.resolutions.find((item) => item.proposal.type === "attack")!.summary
    const shutLine = shut.record.resolutions.find((item) => item.proposal.type === "attack")!.summary
    expect(openLine).toMatch(/retreat to Rear/)
    expect(shutLine).toMatch(/surrounded/)
    expect(shutLine).toMatch(/remnants are lost|garrison is destroyed/)
    const loss = (line: string) => Number(line.match(/defenders (\d+)/)?.[1])
    expect(loss(shutLine)).toBeGreaterThan(loss(openLine))
    expect(shut.state.provinces.find((item) => item.id === "pocket")!.units.map((item) => item.id).sort()).toEqual([
      "north-corps",
      "south-corps",
    ])
    expect(shut.state.provinces.some((item) => item.units.some((unit) => unit.id === "trapped"))).toBe(false)
  })

  it("lets a supplied prong fight alone when the other cannot march", () => {
    const game = state([
      province({
        id: "krakow",
        name: "Kraków",
        controller: "central",
        owner: "central",
        neighbors: ["lublin"],
        supplyModifier: 20,
        units: [unit({ id: "guns", strength: 40 })],
      }),
      province({
        id: "kielce",
        name: "Kielce",
        controller: "central",
        owner: "central",
        neighbors: ["lublin"],
        depot: "central",
        units: [unit({ id: "guard", strength: 90 })],
      }),
      province({
        id: "lublin",
        name: "Lublin",
        neighbors: ["krakow", "kielce"],
        depot: "russia",
        units: [unit({ id: "third", faction: "russia", strength: 30 })],
      }),
    ])
    const played = resolveTurn(
      game,
      {
        narration: "",
        proposals: [
          { type: "attack", from: "krakow", target: "lublin", units: ["guns"] },
          { type: "attack", from: "kielce", target: "lublin", units: ["guard"] },
        ],
        events: [],
        diplomacy: [],
      },
      { rng: highRoll() },
    )
    const lines = played.record.resolutions.filter((item) => item.proposal.type === "attack")
    expect(lines.map((item) => item.status).sort()).toEqual(["applied", "rejected"])
    expect(lines.find((item) => item.status === "rejected")!.summary).toMatch(/supply is 10/)
    expect(lines.find((item) => item.status === "applied")!.summary).toMatch(/^Attack from Kielce/)
  })

  it("has Stavka pinch a salient on Normal and stay quiet on Easy", () => {
    const provinces = [
      province({
        id: "north",
        name: "North",
        neighbors: ["salient"],
        depot: "russia",
        units: [
          unit({ id: "n-strong", name: "North Corps", faction: "russia", strength: 70 }),
          unit({ id: "n-weak", name: "North Garrison", faction: "russia", strength: 20 }),
        ],
      }),
      province({
        id: "south",
        name: "South",
        neighbors: ["salient"],
        depot: "russia",
        units: [
          unit({ id: "s-strong", name: "South Corps", faction: "russia", strength: 60 }),
          unit({ id: "s-weak", name: "South Garrison", faction: "russia", strength: 20 }),
        ],
      }),
      province({
        id: "salient",
        name: "Salient",
        owner: "russia",
        controller: "central",
        neighbors: ["north", "south"],
        depot: "central",
        units: [unit({ id: "hold", name: "Holding Corps", faction: "central", strength: 80 })],
      }),
    ]
    const normal = stavkaTurn(state(provinces, "normal"), [])
    const attacks = normal.proposals.filter((item) => item.type === "attack")
    expect(attacks.map((item) => (item.type === "attack" ? item.from : ""))).toEqual(["north", "south"])
    expect(normal.narration).toMatch(/two-pronged attack at Salient/)
    const easy = stavkaTurn(state(provinces, "easy"), [])
    expect(easy.proposals.filter((item) => item.type === "attack")).toHaveLength(0)
  })
})
