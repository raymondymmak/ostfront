import { describe, expect, it } from "vitest"
import { createInitialState } from "@/lib/data/scenario"
import { provinceActionState, type QueuedOrder } from "@/lib/orders"
import type { Purse } from "@/lib/types"

const rich: Purse = { mp: 30, ip: 30 }

function order(partial: Partial<QueuedOrder> & Pick<QueuedOrder, "kind">): QueuedOrder {
  return { id: partial.id ?? partial.kind, from: "krakow", unitIds: [], ...partial }
}

describe("provinceActionState", () => {
  it("enables fortify on Kraków with an empty queue", () => {
    const state = createInitialState("normal")
    expect(provinceActionState(state, "krakow", [], rich).fortify).toEqual({
      queued: false,
      disabled: false,
      reason: null,
    })
  })

  it("disables fortify once it is queued", () => {
    const state = createInitialState("normal")
    const action = provinceActionState(state, "krakow", [order({ kind: "fortify" })], rich)
    expect(action.fortify).toEqual({ queued: true, disabled: true, reason: "Fortify queued" })
  })

  it("disables fortify at level 3 and below supply 40", () => {
    const fortified = createInitialState("normal")
    fortified.provinces.find((province) => province.id === "krakow")!.fort = 3
    expect(provinceActionState(fortified, "krakow", [], rich).fortify.reason).toBe("Fortified to level 3")

    const hungry = createInitialState("normal")
    hungry.provinces.find((province) => province.id === "krakow")!.supply = 35
    expect(provinceActionState(hungry, "krakow", [], rich).fortify).toMatchObject({
      disabled: true,
      reason: "Supply 35, need 40 to dig",
    })
  })

  it("disables only the recruit kind that is already queued", () => {
    const state = createInitialState("normal")
    const action = provinceActionState(state, "krakow", [order({ kind: "recruit", unitKind: "infantry" })], rich)
    expect(action.recruit.infantry).toMatchObject({ queued: true, disabled: true, reason: "Queued" })
    expect(action.recruit.cavalry.disabled).toBe(false)
    expect(action.recruit.artillery.disabled).toBe(false)
  })

  it("fills the yards at two jobs, and a cancel frees a slot", () => {
    const state = createInitialState("normal")
    state.queue = [
      { id: "job-a", faction: "central", provinceId: "krakow", kind: "infantry", remaining: 1, name: "A" },
      { id: "job-b", faction: "central", provinceId: "krakow", kind: "cavalry", remaining: 1, name: "B" },
    ]
    const full = provinceActionState(state, "krakow", [], rich)
    expect(full.yardSlotsLeft).toBe(0)
    for (const kind of ["infantry", "cavalry", "artillery"] as const) {
      expect(full.recruit[kind]).toMatchObject({ disabled: true, reason: "Yards full (2 in progress)" })
    }

    state.queue = [
      { id: "job-a", faction: "central", provinceId: "krakow", kind: "infantry", remaining: 1, name: "A" },
    ]
    const held = provinceActionState(state, "krakow", [order({ kind: "recruit", unitKind: "cavalry" })], rich)
    expect(held.yardSlotsLeft).toBe(0)

    const freed = provinceActionState(
      state,
      "krakow",
      [
        order({ kind: "recruit", unitKind: "cavalry" }),
        order({ kind: "cancelRecruit", buildId: "job-a", from: "" }),
      ],
      rich,
    )
    expect(freed.yardSlotsLeft).toBe(1)
  })
})
