import { describe, expect, it } from "vitest"
import { blankCampaign } from "@/lib/data/campaign"
import { lossesLine, battleForProvince } from "@/lib/news/battle"
import { selectNewsEvents } from "@/lib/news/select"
import { BattleFactsSchema, ResolutionSchema, TurnRecordSchema } from "@/lib/schema"
import { resolveTurn } from "@/lib/engine/turn"
import type { GameState, GMTurn, Province, Resolution, TurnRecord, Unit } from "@/lib/types"

function unit(id: string, faction: "central" | "russia" = "central", strength = 60): Unit {
  return { id, name: id, faction, strength, morale: 100, kind: "infantry" }
}

function province(partial: Partial<Province> & Pick<Province, "id">): Province {
  return {
    name: partial.name ?? partial.id,
    terrain: "plains",
    neighbors: [],
    rail: [],
    owner: partial.controller ?? "russia",
    controller: partial.controller ?? "russia",
    supply: 100,
    unrest: 0,
    fort: 0,
    units: [],
    supplyModifier: 0,
    ...partial,
  }
}

function board(provinces: Province[], seed = 42): GameState {
  return {
    ...blankCampaign(),
    version: 1,
    turn: 2,
    date: "30 May 1915",
    seed,
    provinces,
  }
}

function gm(proposals: GMTurn["proposals"]): GMTurn {
  return { narration: "Test fortnight.", proposals, events: [], diplomacy: [] }
}

function highRoll(): () => number {
  return () => 0.99
}

function stripBattle(resolutions: Resolution[]) {
  return resolutions.map((item) => ({
    proposal: item.proposal,
    status: item.status,
    summary: item.summary,
  }))
}

function recordSnapshot(record: TurnRecord) {
  return {
    summaries: record.resolutions.map((item) => item.summary).sort(),
    resolutions: stripBattle(record.resolutions),
    control: record.controlChanges,
  }
}

describe("battle facts on resolutions", () => {
  it("keeps engine summaries identical before and after battle metadata", () => {
    const field = board([
      province({
        id: "west",
        name: "West",
        controller: "central",
        owner: "central",
        neighbors: ["hub"],
        depot: "central",
        supply: 100,
        units: [unit("colA", "central", 70)],
      }),
      province({
        id: "east",
        name: "East",
        controller: "central",
        owner: "central",
        neighbors: ["hub"],
        depot: "central",
        supply: 100,
        units: [unit("colB", "central", 65)],
      }),
      province({
        id: "hub",
        name: "Hub",
        neighbors: ["west", "east"],
        supply: 100,
        units: [unit("garrison", "russia", 50)],
      }),
    ])
    const proposals = [
      { type: "attack" as const, from: "west", target: "hub", units: ["colA"] },
      { type: "attack" as const, from: "east", target: "hub", units: ["colB"] },
    ]
    const baseline = resolveTurn(structuredClone(field), gm(proposals), { rng: highRoll() })
    const replay = resolveTurn(structuredClone(field), gm([...proposals].reverse()), { rng: highRoll() })
    expect(recordSnapshot(replay.record)).toEqual(recordSnapshot(baseline.record))
    const battle = baseline.record.resolutions.find((item) => item.battle?.kind === "assault")?.battle
    expect(battle?.encircled).toBe(true)
    expect(battle?.prongs).toBe(2)
  })

  it("records exactly one BattleFacts for a multi-prong assault", () => {
    const field = board([
      province({
        id: "west",
        name: "West",
        controller: "central",
        owner: "central",
        neighbors: ["hub"],
        depot: "central",
        supply: 100,
        units: [unit("colA", "central", 70)],
      }),
      province({
        id: "east",
        name: "East",
        controller: "central",
        owner: "central",
        neighbors: ["hub"],
        depot: "central",
        supply: 100,
        units: [unit("colB", "central", 65)],
      }),
      province({
        id: "hub",
        name: "Hub",
        neighbors: ["west", "east"],
        supply: 100,
        units: [unit("garrison", "russia", 40)],
      }),
    ])
    const played = resolveTurn(
      structuredClone(field),
      gm([
        { type: "attack", from: "west", target: "hub", units: ["colA"] },
        { type: "attack", from: "east", target: "hub", units: ["colB"] },
      ]),
      { rng: highRoll() },
    )
    const battles = played.record.resolutions.filter((item) => item.battle?.targetId === "hub")
    expect(battles).toHaveLength(1)
    expect(battles[0]!.battle!.prongs).toBe(2)
  })

  it("attaches meeting engagement battle facts with losses", () => {
    const field = board([
      province({
        id: "krakow",
        name: "Kraków",
        controller: "central",
        owner: "central",
        neighbors: ["kielce"],
        depot: "central",
        supply: 100,
        units: [unit("eleventh", "central", 70)],
      }),
      province({
        id: "kielce",
        name: "Kielce",
        neighbors: ["krakow"],
        depot: "russia",
        supply: 100,
        units: [unit("corps", "russia", 55)],
      }),
    ])
    const played = resolveTurn(
      structuredClone(field),
      gm([
        { type: "attack", from: "kielce", target: "krakow", units: ["corps"] },
        { type: "attack", from: "krakow", target: "kielce", units: ["eleventh"] },
      ]),
      { rng: highRoll() },
    )
    const meeting = played.record.resolutions.find((item) => item.battle?.kind === "meeting")
    expect(meeting?.battle).toMatchObject({ kind: "meeting", encircled: false, prongs: 1 })
    expect(meeting!.battle!.attackerLoss).toBeGreaterThanOrEqual(0)
    expect(meeting!.battle!.defenderLoss).toBeGreaterThanOrEqual(0)
  })

  it("reproduces the same end state for a fixed seed and orders", () => {
    const field = board(
      [
        province({
          id: "west",
          name: "West",
          controller: "central",
          owner: "central",
          neighbors: ["hub"],
          depot: "central",
          supply: 100,
          units: [unit("colA", "central", 70)],
        }),
        province({
          id: "east",
          name: "East",
          controller: "central",
          owner: "central",
          neighbors: ["hub"],
          depot: "central",
          supply: 100,
          units: [unit("colB", "central", 65)],
        }),
        province({
          id: "hub",
          name: "Hub",
          neighbors: ["west", "east"],
          supply: 100,
          units: [unit("garrison", "russia", 50)],
        }),
      ],
      7,
    )
    const orders = gm([
      { type: "attack", from: "west", target: "hub", units: ["colA"] },
      { type: "attack", from: "east", target: "hub", units: ["colB"] },
    ])
    const first = resolveTurn(structuredClone(field), orders, { rng: () => 0.5 })
    const second = resolveTurn(structuredClone(field), orders, { rng: () => 0.5 })
    expect(second.state).toEqual(first.state)
    expect(second.record.resolutions.map((item) => item.summary)).toEqual(
      first.record.resolutions.map((item) => item.summary),
    )
  })
})

describe("schema acceptance for battle metadata", () => {
  it("accepts resolutions with battle and legacy records without it", () => {
    const withBattle = ResolutionSchema.safeParse({
      proposal: { type: "attack", from: "a", target: "b", units: ["u1"] },
      status: "applied",
      summary: "Fight.",
      battle: {
        targetId: "b",
        attacker: "central",
        defender: "russia",
        kind: "assault",
        prongs: 2,
        attackerLoss: 4,
        defenderLoss: 22,
        encircled: true,
        attackerWon: true,
      },
    })
    const legacy = ResolutionSchema.safeParse({
      proposal: { type: "move", unit: "u1", to: "b" },
      status: "applied",
      summary: "March.",
    })
    expect(withBattle.success).toBe(true)
    expect(legacy.success).toBe(true)
    expect(BattleFactsSchema.safeParse(withBattle.data?.battle).success).toBe(true)
  })

  it("accepts TurnRecord snapshots with optional battle fields", () => {
    const ok = TurnRecordSchema.safeParse({
      turn: 0,
      date: "2 May 1915",
      narration: "Quiet.",
      diplomacy: [],
      resolutions: [
        {
          proposal: { type: "move", unit: "x", to: "y" },
          status: "applied",
          summary: "Moved.",
        },
      ],
      events: [],
      controlChanges: [],
      logistics: [],
      notes: [],
      gmSource: "mock",
    })
    expect(ok.success).toBe(true)
  })
})

describe("news encirclement and losses perspective", () => {
  it("prefers encirclement over city when both apply", () => {
    const prev = board([
      province({
        id: "hub",
        name: "Hub",
        terrain: "urban",
        neighbors: ["west", "east"],
        units: [unit("garrison", "russia", 10)],
      }),
      province({ id: "west", neighbors: ["hub"], controller: "central", owner: "central" }),
      province({ id: "east", neighbors: ["hub"], controller: "central", owner: "central" }),
    ])
    const next = structuredClone(prev)
    const hub = next.provinces.find((p) => p.id === "hub")!
    hub.controller = "central"
    const record: TurnRecord = {
      turn: 2,
      date: "30 May 1915",
      narration: "",
      diplomacy: [],
      resolutions: [
        {
          proposal: { type: "attack", from: "west", target: "hub", units: ["colA"] },
          status: "applied",
          summary:
            "Two-pronged attack from East and West into Hub succeeds, odds 1.50 (roll 5). Hub passes to the Central Powers. The defenders are surrounded. The garrison is destroyed. Losses — attackers 5, defenders 12.",
          battle: {
            targetId: "hub",
            attacker: "central",
            defender: "russia",
            kind: "assault",
            prongs: 2,
            attackerLoss: 5,
            defenderLoss: 12,
            encircled: true,
            attackerWon: true,
          },
        },
      ],
      events: [],
      controlChanges: [{ provinceId: "hub", name: "Hub", from: "russia", to: "central" }],
      logistics: [],
      notes: [],
      gmSource: "mock",
    }
    const events = selectNewsEvents(prev, next, record)
    expect(events).toHaveLength(1)
    expect(events[0]?.kind).toBe("encirclement")
    expect(events[0]?.lossesLine).toBe("Ours −5 · Theirs −12")
  })

  it("formats losses from the Central Powers perspective", () => {
    const line = lossesLine({
      targetId: "b",
      attacker: "central",
      defender: "russia",
      kind: "assault",
      prongs: 1,
      attackerLoss: 12,
      defenderLoss: 37,
      encircled: false,
      attackerWon: true,
    })
    expect(line).toBe("Ours −12 · Theirs −37")
    const defenderView = lossesLine(
      {
        targetId: "b",
        attacker: "central",
        defender: "russia",
        kind: "assault",
        prongs: 1,
        attackerLoss: 12,
        defenderLoss: 37,
        encircled: false,
        attackerWon: true,
      },
      "russia",
    )
    expect(defenderView).toBe("Ours −37 · Theirs −12")
  })

  it("reads battle facts for a province from the turn record", () => {
    const record: TurnRecord = {
      turn: 1,
      date: "x",
      narration: "",
      diplomacy: [],
      resolutions: [
        {
          proposal: { type: "attack", from: "a", target: "hub", units: ["u"] },
          status: "applied",
          summary: "Fight",
          battle: {
            targetId: "hub",
            attacker: "central",
            defender: "russia",
            kind: "assault",
            prongs: 2,
            attackerLoss: 1,
            defenderLoss: 9,
            encircled: true,
            attackerWon: true,
          },
        },
      ],
      events: [],
      controlChanges: [],
      logistics: [],
      notes: [],
      gmSource: "mock",
    }
    expect(battleForProvince(record, "hub")?.encircled).toBe(true)
    expect(battleForProvince(record, "other")).toBeUndefined()
  })
})