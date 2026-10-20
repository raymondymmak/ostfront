import { describe, expect, it } from "vitest"
import { createInitialState, createScenario } from "@/lib/data/scenario"
import { projectIncome, RECRUIT, recruitmentYard } from "@/lib/engine/economy"
import { resolveTurn } from "@/lib/engine/turn"
import { leaveDepotGarrison } from "@/lib/orders"

describe("economy", () => {
  it("pays less for unrest and half for occupation", () => {
    const state = createInitialState()
    const home = projectIncome(state, "central")
    const silesia = state.provinces.find((province) => province.id === "oberschlesien")!
    silesia.unrest = 50
    const uneasy = projectIncome(state, "central")
    expect(uneasy.ip).toBeLessThan(home.ip)

    silesia.unrest = 0
    silesia.controller = "russia"
    const lost = projectIncome(state, "central")
    expect(lost.ip).toBeLessThan(home.ip)
    const occupied = projectIncome(
      { ...state, provinces: state.provinces.map((province) => ({ ...province })) },
      "russia",
    )
    const warsaw = state.provinces.find((province) => province.id === "warszawa")!
    warsaw.controller = "central"
    warsaw.unrest = 0
    const captured = projectIncome(state, "central").mp
    warsaw.controller = "russia"
    const restored = projectIncome(state, "central").mp
    expect(captured).toBeGreaterThan(restored)
    expect(occupied.mp).toBeGreaterThan(0)
  })

  it("raises an infantry corps at a supplied depot and not in a field", () => {
    const state = createInitialState()
    const krakow = state.provinces.find((province) => province.id === "krakow")!
    const kielce = state.provinces.find((province) => province.id === "kielce")!
    expect(recruitmentYard(krakow, "central")).toBe(true)
    expect(recruitmentYard(kielce, "central")).toBe(false)
    state.treasury.central = { mp: RECRUIT.infantry.mp, ip: RECRUIT.infantry.ip }
    const played = resolveTurn(state, {
      narration: "",
      proposals: [{ type: "recruit", faction: "central", province: "krakow", kind: "infantry" }],
      events: [],
      diplomacy: [],
    })
    const arrived = played.state.provinces
      .find((province) => province.id === "krakow")!
      .units.some((unit) => unit.name.includes("Kraków"))
    expect(arrived).toBe(true)
    expect(played.state.treasury.central.mp).toBeGreaterThanOrEqual(0)
    expect(played.record.resolutions.some((item) => item.proposal.type === "recruit" && item.status === "applied")).toBe(true)
  })

  it("refits a formation that did not attack and bills manpower", () => {
    const state = createInitialState()
    const unit = state.provinces.flatMap((province) => province.units).find((item) => item.id === "cp-kra-inf")!
    unit.strength = 20
    unit.maxStrength = 36
    state.treasury.central.mp = 4
    const played = resolveTurn(state, { narration: "", proposals: [], events: [], diplomacy: [] })
    const after = played.state.provinces.flatMap((province) => province.units).find((item) => item.id === "cp-kra-inf")!
    expect(after.strength).toBe(28)
    expect(played.state.treasury.central.mp).toBeLessThan(4 + projectIncome(state, "central").mp)
  })

  it("keeps a garrison when an arrow leaves a depot", () => {
    const chosen = leaveDepotGarrison(
      [
        { id: "a", strength: 40 },
        { id: "b", strength: 10 },
      ],
      true,
      false,
    )
    expect(chosen.map((unit) => unit.id)).toEqual(["a"])
    expect(leaveDepotGarrison([{ id: "a", strength: 40 }], true, false)).toHaveLength(1)
    expect(leaveDepotGarrison(
      [
        { id: "a", strength: 40 },
        { id: "b", strength: 10 },
      ],
      true,
      true,
    )).toHaveLength(2)
  })

  it("keeps Lemberg with the Central Powers in both scenarios", () => {
    for (const scenario of ["campaign-1915", "gorlice"] as const) {
      const lemberg = createScenario(scenario).provinces.find((province) => province.id === "lwow")!
      expect(lemberg.controller).toBe("central")
      expect(lemberg.owner).toBe("central")
      expect(lemberg.depot).toBe("central")
    }
  })
})
