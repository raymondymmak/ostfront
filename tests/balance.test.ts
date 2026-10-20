import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it } from "vitest"
import { createInitialState, createScenario } from "@/lib/data/scenario"
import { projectIncome, spendable } from "@/lib/engine/economy"
import { engagementOdds } from "@/lib/engine/turn"
import { playTurn } from "@/lib/gm"
import { scenarioSpec } from "@/lib/data/objectives"
import type { GameState, PlayerOrder } from "@/lib/types"

beforeEach(() => {
  delete process.env.LLM_API_KEY
})

async function sit(state: GameState, turns: number) {
  let current = state
  let attacks = 0
  for (let turn = 0; turn < turns && !current.result; turn += 1) {
    const played = await playTurn(current, [])
    attacks += played.record.resolutions.filter(
      (item) => item.status === "applied" && item.proposal.type === "attack",
    ).length
    current = played.state
  }
  return { state: current, attacks }
}

function cpProvinces(state: GameState): number {
  return state.provinces.filter((province) => province.controller === "central").length
}

function cpStrength(state: GameState): number {
  return state.provinces.reduce(
    (sum, province) =>
      sum + province.units.filter((unit) => unit.faction === "central").reduce((inner, unit) => inner + unit.strength, 0),
    0,
  )
}

describe("balance", () => {
  it("presses an idle player and attacks within eight fortnights", async () => {
    const start = createInitialState("normal")
    const idle = await sit(start, 8)
    expect(idle.attacks).toBeGreaterThan(0)
    const pressured = cpProvinces(idle.state) < cpProvinces(start) || cpStrength(idle.state) < cpStrength(start) - 30
    expect(pressured).toBe(true)
  })

  it("keeps income inside a fixed ceiling for a whole campaign", async () => {
    const start = createInitialState()
    expect(projectIncome(start, "central").mp).toBeLessThan(80)
    expect(projectIncome(start, "central").ip).toBeLessThan(80)
    expect(projectIncome(start, "russia").mp).toBeLessThan(80)
    const easy = projectIncome(createInitialState("easy"), "russia")
    const normal = projectIncome(createInitialState("normal"), "russia")
    const hard = projectIncome(createInitialState("hard"), "russia")
    expect(easy.mp).toBeLessThan(normal.mp)
    expect(normal.mp).toBeLessThan(hard.mp)
    const idle = await sit(start, scenarioSpec("campaign-1915").length)
    expect(idle.state.treasury.central.mp).toBeLessThan(2000)
    expect(idle.state.treasury.russia.mp).toBeLessThan(2000)
    expect(idle.state.result).not.toBeNull()
  })

  it("lets a prepared Gorlice offensive finish ahead", async () => {
    let state = createScenario("gorlice", "normal")
    const script: PlayerOrder[][] = [
      [{ type: "attack", from: "krakow", target: "kielce", unitIds: ["g-kra-11", "g-kra-grd", "g-kra-art"] }],
      [
        { type: "attack", from: "kielce", target: "lublin", unitIds: ["g-kra-11", "g-kra-art"] },
        { type: "recruit", provinceId: "krakow", unitKind: "infantry" },
      ],
    ]
    for (const orders of script) state = (await playTurn(state, orders)).state
    expect(state.provinces.find((province) => province.id === "kielce")?.controller).toBe("central")
    expect(state.provinces.find((province) => province.id === "lublin")?.controller).toBe("central")
    while (!state.result) {
      state = (await playTurn(state, [{ type: "recruit", provinceId: "krakow", unitKind: "infantry" }])).state
    }
    expect(state.result?.grade === "marginal" || state.result?.grade === "victory" || state.result?.grade === "decisive" || state.result?.grade === "brilliant").toBe(true)
    expect(state.result?.captured).toBeGreaterThanOrEqual(2)
  })

  it("can take Łódź in the long campaign without giving up the home depots", async () => {
    let state = createInitialState("normal")
    state = (await playTurn(state, [{ type: "move", unitId: "cp-obs-inf", to: "katowice" }])).state
    const ids = state.provinces
      .find((province) => province.id === "katowice")!
      .units.filter((unit) => unit.faction === "central" && unit.kind !== "artillery")
      .map((unit) => unit.id)
    state = (await playTurn(state, [{ type: "attack", from: "katowice", target: "lodz", unitIds: ids }])).state
    expect(state.provinces.find((province) => province.id === "lodz")?.controller).toBe("central")
    for (const id of ["krakow", "lwow", "konigsberg"]) {
      expect(state.provinces.find((province) => province.id === id)?.controller).toBe("central")
    }
  })

  it("makes Easy kinder than Hard for a player who attacks the nearest battle", async () => {
    const rank: Record<string, number> = {
      defeat: 0,
      draw: 1,
      marginal: 2,
      victory: 3,
      decisive: 4,
      brilliant: 5,
    }
    async function grade(difficulty: "easy" | "hard", seed: number) {
      let state = createInitialState(difficulty)
      state.seed = seed
      while (!state.result) {
        const orders: PlayerOrder[] = []
        const used = new Set<string>()
        const options: { from: string; to: string; ids: string[]; ratio: number }[] = []
        for (const province of state.provinces) {
          if (province.controller !== "central" || province.supply < 30) continue
          const units = province.units.filter((unit) => unit.faction === "central" && !used.has(unit.id))
          const spare =
            province.depot === "central" && units.length > 1
              ? [...units].sort((a, b) => a.strength - b.strength).slice(1)
              : units
          if (!spare.length || (province.depot === "central" && spare.length >= units.length)) continue
          let best: { to: string; ratio: number } | null = null
          for (const neighbor of province.neighbors) {
            const target = state.provinces.find((item) => item.id === neighbor)
            if (!target || target.controller === "central") continue
            const odds = engagementOdds(state, province.id, target.id, spare.map((unit) => unit.id))
            if (!odds || odds.empty || odds.ratio < 1.15) continue
            if (!best || odds.ratio > best.ratio) best = { to: target.id, ratio: odds.ratio }
          }
          if (best) options.push({ from: province.id, to: best.to, ids: spare.map((unit) => unit.id), ratio: best.ratio })
        }
        options.sort((a, b) => b.ratio - a.ratio)
        for (const option of options.slice(0, 2)) {
          orders.push({ type: "attack", from: option.from, target: option.to, unitIds: option.ids })
          for (const id of option.ids) used.add(id)
        }
        const budget = spendable(state, "central", used)
        if (budget.mp >= 6 && budget.ip >= 3) {
          const yard = state.provinces.find(
            (province) => province.controller === "central" && province.depot === "central" && province.supply >= 60,
          )
          if (yard) orders.push({ type: "recruit", provinceId: yard.id, unitKind: "infantry" })
        }
        state = (await playTurn(state, orders)).state
      }
      return state.result?.grade ?? "draw"
    }
    const seeds = [1000, 1017, 1034, 1051]
    const easy = await Promise.all(seeds.map((seed) => grade("easy", seed)))
    const hard = await Promise.all(seeds.map((seed) => grade("hard", seed)))
    const total = (grades: string[]) => grades.reduce((sum, grade) => sum + (rank[grade] ?? 0), 0)
    const wins = (grades: string[]) => grades.filter((item) => (rank[item] ?? 0) >= 2).length
    expect(total(easy)).toBeGreaterThan(total(hard))
    expect(wins(easy)).toBeGreaterThan(wins(hard))
    expect(hard.some((item) => item === "defeat" || item === "draw")).toBe(true)
  })

  it("does not let the model choose Russian moves", () => {
    const source = readFileSync("lib/gm/index.ts", "utf8")
    expect(source).toContain("const staff = mockAiTurn")
    expect(source).not.toContain("buildStaffTurn(rebound, fetched.turn")
  })

  it("leaves a garrison on Russian victory cities", async () => {
    let state = createInitialState("normal")
    for (let turn = 0; turn < 4 && !state.result; turn += 1) {
      state = (await playTurn(state, [])).state
      for (const id of ["warszawa", "lublin", "wilno", "lodz", "bialystok", "wolyn"]) {
        const province = state.provinces.find((item) => item.id === id)!
        if (province.controller !== "russia") continue
        if (province.depot === "russia" || scenarioSpec(state.scenario).objectives.some((item) => item.id === id)) {
          expect(province.units.some((unit) => unit.faction === "russia")).toBe(true)
        }
      }
    }
  })
})
