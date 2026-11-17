import { describe, expect, it } from "vitest"
import { freshGame } from "@/lib/storage"
import { legalTargets } from "@/lib/ui/legal-targets"

describe("legalTargets", () => {
  it("lists friendly neighbors as move and hostile as attack from Kraków", () => {
    const { state } = freshGame()
    const targets = legalTargets(state, "krakow", [])
    expect(targets.from).toBe("krakow")
    expect(targets.move).toContain("katowice")
    expect(targets.attack).toContain("kielce")
    expect(targets.blocked).toEqual([])
  })

  it("blocks every neighbor when supply is under 30", () => {
    const game = freshGame()
    const province = game.state.provinces.find((item) => item.id === "krakow")!
    province.supply = 20
    const targets = legalTargets(game.state, "krakow", [])
    expect(targets.move).toEqual([])
    expect(targets.attack).toEqual([])
    expect(targets.blocked.length).toBeGreaterThan(0)
    expect(targets.blocked[0]?.reason).toMatch(/supply 30/)
  })

  it("rejects arrows that start in Russian-held provinces", () => {
    const game = freshGame()
    const targets = legalTargets(game.state, "lwow", [])
    expect(targets.move).toEqual([])
    expect(targets.attack).toEqual([])
    expect(targets.blocked[0]?.reason).toMatch(/Central Powers/)
  })
})