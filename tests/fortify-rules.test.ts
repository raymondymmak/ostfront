import { describe, expect, it } from "vitest"
import { createInitialState } from "@/lib/data/scenario"
import { FORTIFY_IP_COST } from "@/lib/engine/economy"
import { applyFortify, resolveTurn } from "@/lib/engine/turn"

function orders(proposals: Parameters<typeof resolveTurn>[1]["proposals"]) {
  return { narration: "", diplomacy: [], proposals, events: [] }
}

describe("fortify rules", () => {
  it("costs industry, consumes the garrison, and completes next fortnight", () => {
    const state = createInitialState("normal")
    const krakow = state.provinces.find((p) => p.id === "krakow")!
    const ipBefore = state.treasury.central.ip
    const fortified = new Set<string>()
    const used = new Set<string>()
    const resolution = applyFortify(
      state,
      { type: "fortify", province: "krakow" },
      fortified,
      used,
    )
    expect(resolution.status).toBe("applied")
    expect(state.treasury.central.ip).toBe(ipBefore - FORTIFY_IP_COST)
    const fortBefore = krakow.fort
    expect(krakow.fortPending).toBe(1)
    expect(krakow.fort).toBe(fortBefore)
    expect(used.size).toBeGreaterThan(0)

    const next = resolveTurn(state, orders([]))
    expect(next.state.provinces.find((p) => p.id === "krakow")!.fort).toBeGreaterThan(krakow.fort)
  })

  it("reduces fort level by one when captured", () => {
    const state = createInitialState("easy")
    const kielce = state.provinces.find((p) => p.id === "kielce")!
    kielce.fort = 2
    const centralUnit = state.provinces.find((p) => p.id === "krakow")!.units[0]
    const played = resolveTurn(
      state,
      orders([{ type: "attack", from: "krakow", target: "kielce", units: [centralUnit.id] }]),
      { rng: () => 0.99 },
    )
    const taken = played.state.provinces.find((p) => p.id === "kielce")!
    if (taken.controller === "central" && played.record.resolutions.some((r) => /succeeds/i.test(r.summary))) {
      expect(taken.fort).toBe(1)
    }
  })
})
