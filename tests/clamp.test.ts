import { describe, expect, it } from "vitest"
import { blankCampaign } from "@/lib/data/campaign"
import { applyModify, resolveTurn } from "@/lib/engine/turn"
import type { GameState, ModifyProposal, Province } from "@/lib/types"

function warsaw(unrest: number): Province {
  return {
    id: "warsaw",
    name: "Warsaw",
    terrain: "urban",
    neighbors: [],
    rail: [],
    owner: "central",
    controller: "central",
    supply: 100,
    unrest,
    fort: 1,
    units: [],
    depot: "central",
    supplyModifier: 0,
  }
}

function game(unrest: number): GameState {
  return {
    ...blankCampaign(),
    version: 1,
    turn: 0,
    date: "2 May 1915",
    seed: 1,
    provinces: [warsaw(unrest)],
  }
}

describe("modify clamping", () => {
  it("clamps a single unrest delta to ±20 and the field to 0–100", () => {
    const high = game(90)
    const up: ModifyProposal = {
      type: "modify",
      province: "warsaw",
      field: "unrest",
      delta: 50,
      reason: "rumor",
    }
    const raised = applyModify(high, up, {
      unrest: new Map(),
      supply: new Map(),
    })
    expect(raised.status).toBe("applied")
    expect(raised.summary).toMatch(/clamped to \+20/)
    expect(high.provinces[0].unrest).toBe(100)

    const low = game(5)
    const down: ModifyProposal = {
      type: "modify",
      province: "warsaw",
      field: "unrest",
      delta: -80,
      reason: "patrols",
    }
    const lowered = applyModify(low, down, {
      unrest: new Map(),
      supply: new Map(),
    })
    expect(lowered.status).toBe("applied")
    expect(lowered.summary).toMatch(/clamped to -20/)
    expect(low.provinces[0].unrest).toBe(0)
  })

  it("refuses a further change once the ±20 turn budget is spent", () => {
    const board = game(40)
    const spent = { unrest: new Map([["warsaw", 20]]), supply: new Map() }
    const result = applyModify(
      board,
      {
        type: "modify",
        province: "warsaw",
        field: "unrest",
        delta: 5,
        reason: "again",
      },
      spent,
    )
    expect(result.status).toBe("rejected")
    expect(result.summary).toMatch(/\+20/)
    expect(board.provinces[0].unrest).toBe(40)
  })

  it("treats +50 and +20 as the same turn inside the full resolution", () => {
    const big = resolveTurn(game(40), {
      narration: "",
      proposals: [
        {
          type: "modify",
          province: "warsaw",
          field: "unrest",
          delta: 50,
          reason: "overasked",
        },
      ],
      events: [],
      diplomacy: [],
    })
    const exact = resolveTurn(game(40), {
      narration: "",
      proposals: [
        {
          type: "modify",
          province: "warsaw",
          field: "unrest",
          delta: 20,
          reason: "exact",
        },
      ],
      events: [],
      diplomacy: [],
    })
    expect(big.record.resolutions[0].summary).toMatch(/clamped to \+20/)
    expect(big.state.provinces[0].unrest).toBe(exact.state.provinces[0].unrest)
    expect(big.state.provinces[0].unrest).toBeLessThanOrEqual(60)
    expect(big.state.provinces[0].unrest).toBeGreaterThanOrEqual(0)
  })

  it("clamps a supply shock to ±20 of stockpile, not a free rewrite of the railway", () => {
    const board = game(0)
    const result = applyModify(
      board,
      {
        type: "modify",
        province: "warsaw",
        field: "supply",
        delta: -50,
        reason: "strike",
      },
      { unrest: new Map(), supply: new Map() },
    )
    expect(result.status).toBe("applied")
    expect(result.summary).toMatch(/clamped to -20/)
    expect(board.provinces[0].supplyModifier).toBe(-20)
    expect(board.provinces[0].supply).toBe(80)
  })
})
