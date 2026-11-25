import { describe, expect, it } from "vitest"
import { createInitialState } from "@/lib/data/scenario"
import { assessManeuvers } from "@/lib/engine/simultaneous"
import { maneuverReservations } from "@/lib/engine/turn"
import { marchPreviewLine, previewMarch } from "@/lib/ui/legal-targets"

describe("assessManeuvers", () => {
  it("names supply, a missing border, the wrong order, and a busy formation before release", () => {
    const state = createInitialState()
    const krakow = state.provinces.find((province) => province.id === "krakow")!
    krakow.supply = 22

    const starved = assessManeuvers(state, [
      { type: "attack", from: "krakow", target: "kielce", units: ["g-kra-11"] },
    ])
    expect(starved).toEqual({
      ok: false,
      summary: "The attack from Kraków cannot march: supply is 22 (need 30).",
      hover: "Supply 22 < 30",
    })

    krakow.supply = 60
    const gap = assessManeuvers(state, [{ type: "move", unit: "g-kra-11", to: "warszawa" }])
    expect(gap.ok).toBe(false)
    if (!gap.ok) {
      expect(gap.hover).toBe("No shared border")
      expect(gap.summary).toMatch(/do not share a border/)
    }

    const attackInstead = assessManeuvers(state, [{ type: "move", unit: "g-kra-11", to: "kielce" }])
    expect(attackInstead.ok).toBe(false)
    if (!attackInstead.ok) expect(attackInstead.hover).toBe("Attack instead")

    const moveInstead = assessManeuvers(state, [
      { type: "attack", from: "krakow", target: "katowice", units: ["g-kra-11"] },
    ])
    expect(moveInstead.ok).toBe(false)
    if (!moveInstead.ok) expect(moveInstead.hover).toBe("Move instead")

    const busy = assessManeuvers(
      state,
      [{ type: "move", unit: "g-kra-11", to: "katowice" }],
      new Set(),
      new Set(["g-kra-11"]),
    )
    expect(busy.ok).toBe(false)
    if (!busy.ok) {
      expect(busy.hover).toBe("Already ordered")
      expect(busy.summary).toMatch(/already has orders this fortnight/)
    }
  })

  it("treats a fortify that will apply as digging in", () => {
    const state = createInitialState()
    state.treasury.central.ip = 8
    const reserved = maneuverReservations(state, [{ type: "fortify", province: "krakow" }])
    expect(reserved.has("g-kra-11")).toBe(true)
    const digging = assessManeuvers(
      state,
      [{ type: "move", unit: "g-kra-11", to: "katowice" }],
      reserved,
    )
    expect(digging.ok).toBe(false)
    if (!digging.ok) expect(digging.hover).toBe("Digging in")
  })
})

describe("previewMarch", () => {
  it("blocks a drag onto a starved neighbour and does not invent an arrow", () => {
    const state = createInitialState()
    state.provinces.find((province) => province.id === "krakow")!.supply = 22
    const verdict = previewMarch(state, [], "krakow", "kielce", { unitId: "g-kra-11" })
    expect(verdict).toEqual({ ok: false, hover: "Supply 22 < 30" })
    expect(marchPreviewLine([-0.02, -0.63], [-0.11, -0.38], verdict)).toBeNull()
  })

  it("blocks a non-neighbour, a formation that is already ordered, and a garrison that is digging in", () => {
    const state = createInitialState()
    expect(previewMarch(state, [], "krakow", "warszawa", { unitId: "g-kra-11" }).ok).toBe(false)
    const gap = previewMarch(state, [], "krakow", "warszawa", { unitId: "g-kra-11" })
    expect(gap).toMatchObject({ ok: false, hover: "No shared border" })

    const queued = previewMarch(
      state,
      [{ id: "busy", kind: "attack", from: "krakow", to: "lwow", unitIds: ["g-kra-11"] }],
      "krakow",
      "kielce",
      { unitId: "g-kra-x" },
    )
    expect(queued.ok).toBe(true)

    const same = previewMarch(
      state,
      [{ id: "busy", kind: "attack", from: "krakow", to: "lwow", unitIds: ["g-kra-11"] }],
      "krakow",
      "kielce",
      { unitId: "g-kra-11" },
    )
    expect(same.ok).toBe(true)

    const everyone = state.provinces
      .find((province) => province.id === "krakow")!
      .units.filter((unit) => unit.faction === "central")
      .map((unit) => unit.id)
    const held = previewMarch(
      state,
      [{ id: "busy", kind: "attack", from: "krakow", to: "lwow", unitIds: everyone }],
      "krakow",
      "katowice",
    )
    expect(held.ok).toBe(false)
    if (!held.ok) expect(held.hover).toBe("Already ordered")

    state.treasury.central.ip = 8
    const digging = previewMarch(
      state,
      [{ id: "dig", kind: "fortify", from: "krakow", unitIds: [] }],
      "krakow",
      "katowice",
      { unitId: "g-kra-11" },
    )
    expect(digging).toEqual({ ok: false, hover: "Digging in" })
  })

  it("returns a line only when the drop is legal", () => {
    const state = createInitialState()
    const verdict = previewMarch(state, [], "krakow", "kielce", { unitId: "g-kra-11" })
    expect(verdict.ok).toBe(true)
    expect(marchPreviewLine([1, 2], [3, 4], verdict)).toEqual([
      [1, 2],
      [3, 4],
    ])
  })
})
