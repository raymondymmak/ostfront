import { describe, expect, it } from "vitest"
import { freshGame } from "@/lib/storage"
import { legalTargets } from "@/lib/ui/legal-targets"

describe("legalTargets", () => {
  it("lists friendly neighbors as move and hostile as attack from Kraków", () => {
    const { state } = freshGame()
    const targets = legalTargets(state, "krakow", [])
    expect(targets.from).toBe("krakow")
    expect(targets.canOrder).toBe(true)
    expect(targets.move).toContain("katowice")
    expect(targets.attack).toContain("kielce")
    expect(targets.reach.move).toContain("katowice")
    expect(targets.reach.attack).toContain("kielce")
    expect(targets.blocked).toEqual([])
  })

  it("blocks every neighbor when supply is under 30", () => {
    const game = freshGame()
    const province = game.state.provinces.find((item) => item.id === "krakow")!
    province.supply = 20
    const targets = legalTargets(game.state, "krakow", [])
    expect(targets.canOrder).toBe(false)
    expect(targets.move).toEqual([])
    expect(targets.attack).toEqual([])
    expect(targets.reach.move.length).toBeGreaterThan(0)
    expect(targets.blocked.length).toBeGreaterThan(0)
    expect(targets.blocked[0]?.reason).toMatch(/supply 30/)
  })

  it("shows reach from Russian-held provinces without order permission", () => {
    const game = freshGame()
    const targets = legalTargets(game.state, "lwow", [])
    expect(targets.canOrder).toBe(false)
    expect(targets.move).toEqual([])
    expect(targets.attack).toEqual([])
    expect(targets.blocked).toEqual([])
    expect(targets.reach.move.length + targets.reach.attack.length).toBeGreaterThan(0)
    const lwow = game.state.provinces.find((item) => item.id === "lwow")!
    for (const id of lwow.neighbors) {
      const neighbor = game.state.provinces.find((item) => item.id === id)!
      if (neighbor.controller === "russia") expect(targets.reach.move).toContain(id)
      else expect(targets.reach.attack).toContain(id)
    }
  })
})