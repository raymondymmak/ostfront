import { describe, expect, it } from "vitest"
import { createInitialState, createScenario } from "@/lib/data/scenario"
import {
  CENTRAL_INDUSTRY_MULTIPLIER,
  DIFFICULTY_INCOME,
  INCOME_SUPPLY_FLOOR,
  POINTS_PER_MP,
  RUSSIAN_IP_SCALE,
  RUSSIAN_MP_SCALE,
  describeProvinceIncome,
  explainIncome,
  explainRefit,
  projectIncome,
  provinceIncome,
  provinceIncomeDetail,
  provinceResourceYield,
  RECRUIT,
  recruitmentYard,
  reinforcementCost,
} from "@/lib/engine/economy"
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

  it("explains yield as base × (1 − unrest/100), halved if occupied, and 0 under supply 30", () => {
    const state = createInitialState()
    const silesia = state.provinces.find((province) => province.id === "oberschlesien")!
    const home = provinceIncomeDetail(silesia)
    expect(home.starved).toBe(false)
    expect(home.occupied).toBe(false)
    expect(home.factor).toBeCloseTo(1 - silesia.unrest / 100)
    expect(home.mp).toBeCloseTo(home.baseMp * home.factor)
    expect(home.ip).toBeCloseTo(home.baseIp * home.factor)
    expect(provinceIncome(silesia)).toEqual({ mp: home.mp, ip: home.ip })
    expect(describeProvinceIncome(home)).toContain("× (1 −")

    silesia.supply = INCOME_SUPPLY_FLOOR - 1
    const starved = provinceIncomeDetail(silesia)
    expect(starved.mp).toBe(0)
    expect(starved.ip).toBe(0)
    expect(starved.factor).toBe(0)
    expect(provinceResourceYield(silesia)).toBe(0)
    expect(describeProvinceIncome(starved)).toContain(`under ${INCOME_SUPPLY_FLOOR}`)

    silesia.supply = 80
    silesia.unrest = 0
    silesia.controller = "russia"
    const occupied = provinceIncomeDetail(silesia)
    expect(occupied.occupied).toBe(true)
    expect(occupied.factor).toBeCloseTo(0.5)
    expect(occupied.mp).toBeCloseTo(occupied.baseMp * 0.5)
    expect(occupied.ip).toBeCloseTo(occupied.baseIp * 0.5)
    expect(describeProvinceIncome(occupied)).toContain("halved because it is occupied")

    silesia.unrest = 50
    const uneasyOccupied = provinceIncomeDetail(silesia)
    expect(uneasyOccupied.factor).toBeCloseTo(0.25)
    expect(uneasyOccupied.ip).toBeCloseTo(uneasyOccupied.baseIp * 0.25)
  })

  it("rounds Central Powers industry after ×1.3 and matches projectIncome", () => {
    const state = createInitialState()
    const explained = explainIncome(state, "central")
    expect(explained.industryMultiplier).toBe(CENTRAL_INDUSTRY_MULTIPLIER)
    expect(explained.manpowerMultiplier).toBe(1)
    expect(explained.difficultyMultiplier).toBe(1)
    expect(explained.income).toEqual(projectIncome(state, "central"))
    expect(explained.income.mp).toBe(Math.max(0, Math.round(explained.rawMp)))
    expect(explained.income.ip).toBe(Math.max(0, Math.round(explained.rawIp * CENTRAL_INDUSTRY_MULTIPLIER)))

    const russia = explainIncome(state, "russia")
    expect(russia.income).toEqual(projectIncome(state, "russia"))
    expect(russia.manpowerMultiplier).toBe(RUSSIAN_MP_SCALE)
    expect(russia.industryMultiplier).toBe(RUSSIAN_IP_SCALE)
    expect(russia.difficultyMultiplier).toBe(DIFFICULTY_INCOME.normal)
    expect(russia.income.mp).toBe(
      Math.max(0, Math.round(russia.rawMp * RUSSIAN_MP_SCALE * DIFFICULTY_INCOME.normal)),
    )
    expect(russia.income.ip).toBe(
      Math.max(0, Math.round(russia.rawIp * RUSSIAN_IP_SCALE * DIFFICULTY_INCOME.normal)),
    )
  })

  it("bills refit at 1 manpower per 4 strength and skips attacks", () => {
    const state = createInitialState()
    const unit = state.provinces.flatMap((province) => province.units).find((item) => item.id === "g-kra-11")!
    unit.strength = 20
    unit.maxStrength = 36
    const bill = explainRefit(state, "central", new Set())
    const line = bill.lines.find((item) => item.unitId === "g-kra-11")!
    expect(POINTS_PER_MP).toBe(4)
    expect(line.need).toBe(8)
    expect(line.mp).toBe(Math.ceil(line.need / POINTS_PER_MP))
    expect(bill.mp).toBe(reinforcementCost(state, "central", new Set()))
    const skipped = explainRefit(state, "central", new Set(["g-kra-11"]))
    expect(skipped.lines.some((item) => item.unitId === "g-kra-11")).toBe(false)
    expect(skipped.mp).toBe(reinforcementCost(state, "central", new Set(["g-kra-11"])))
    expect(bill.mp - skipped.mp).toBe(line.mp)
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
    const unit = state.provinces.flatMap((province) => province.units).find((item) => item.id === "g-kra-11")!
    unit.strength = 20
    unit.maxStrength = 36
    state.treasury.central.mp = 4
    const played = resolveTurn(state, { narration: "", proposals: [], events: [], diplomacy: [] })
    const after = played.state.provinces.flatMap((province) => province.units).find((item) => item.id === "g-kra-11")!
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

  it("keeps Katowice, Stanislav and Bukovina with the Central Powers and Lemberg Austrian-owned", () => {
    const state = createScenario("gorlice")
    for (const id of ["katowice", "stanislawow", "bucovina"] as const) {
      const province = state.provinces.find((item) => item.id === id)!
      expect(province.controller).toBe("central")
      expect(province.owner).toBe("central")
    }
    const lemberg = state.provinces.find((province) => province.id === "lwow")!
    expect(lemberg.owner).toBe("central")
    expect(lemberg.controller).toBe("russia")
    expect(lemberg.depot).toBe("central")
  })
})
