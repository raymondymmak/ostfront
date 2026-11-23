import { describe, expect, it } from "vitest"
import { stavkaTurn } from "@/lib/ai/stavka"
import { createInitialState } from "@/lib/data/scenario"
import { resolveTurn } from "@/lib/engine/turn"
import { independentFormations } from "@/lib/engine/echelon"
import { leaveDepotGarrison, provinceActionState, type QueuedOrder } from "@/lib/orders"
import { legalTargets } from "@/lib/ui/legal-targets"

/**
 * QA flag: fortnights 3–6 sometimes looked like Province Attack/Fortify were broken.
 * Assert the orders + legality layer still allows both with an empty queue after
 * several Stavka-only fortnights (same path the Province panel uses).
 */
describe("late-fortnight province Attack/Fortify", () => {
  it("still allows Fortify and Attack from Kraków after fortnights 3–6", () => {
    let state = createInitialState("normal", 1915)
    for (let turn = 0; turn < 4; turn++) {
      expect(state.result).toBeFalsy()
      const gm = stavkaTurn(state, [])
      state = resolveTurn(state, gm, { rng: () => 0.5 }).state
    }
    expect(state.turn).toBeGreaterThanOrEqual(3)

    const krakow = state.provinces.find((province) => province.id === "krakow")
    expect(krakow?.controller).toBe("central")

    const queue: QueuedOrder[] = []
    const action = provinceActionState(state, "krakow", queue, state.treasury.central)
    expect(action.fortify.disabled).toBe(false)

    const targets = legalTargets(state, "krakow", queue)
    expect(targets.canOrder).toBe(true)
    expect(targets.attack.length).toBeGreaterThan(0)

    const available = independentFormations(
      krakow!.units.filter((unit) => unit.faction === "central"),
    )
    expect(available.length).toBeGreaterThan(0)
    const chosen = leaveDepotGarrison(available, krakow!.depot === "central", false)
    expect(chosen.length).toBeGreaterThan(0)

    const attackTarget = targets.attack[0]!
    const nextQueue: QueuedOrder[] = [
      {
        id: "fortify-test",
        kind: "fortify",
        from: "krakow",
        unitIds: [],
      },
      {
        id: "attack-test",
        kind: "attack",
        from: "krakow",
        to: attackTarget,
        unitIds: chosen.map((unit) => unit.id),
      },
    ]
    expect(nextQueue).toHaveLength(2)
    expect(provinceActionState(state, "krakow", nextQueue, state.treasury.central).fortify.queued).toBe(
      true,
    )
  })
})
