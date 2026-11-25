import { describe, expect, it } from "vitest"
import { freshGame } from "@/lib/storage"
import { legalTargetHoverNote, legalTargets, mapProvinceHoverNote } from "@/lib/ui/legal-targets"
import { cursorHoverText, cursorTipPosition, provinceHoverBase, provinceHoverNote } from "@/lib/ui/map-hover"

function mapTargetHoverNote(targets: ReturnType<typeof legalTargets>) {
  return (id: string, base: string) => {
    const extra = mapProvinceHoverNote(targets, id)
    return extra ? `${base}\n${extra}` : base
  }
}

describe("svg map province hover", () => {
  it("appends blocked-target copy used for <title> and the visible tooltip", () => {
    const game = freshGame()
    const krakow = game.state.provinces.find((item) => item.id === "krakow")
    const kielce = game.state.provinces.find((item) => item.id === "kielce")
    if (!krakow || !kielce) throw new Error("scenario provinces missing")
    krakow.supply = 20
    const targets = legalTargets(game.state, "krakow", [])
    const hoverNote = mapTargetHoverNote(targets)

    const neighborTip = provinceHoverNote(kielce, hoverNote)
    expect(neighborTip).toBe(provinceHoverBase(kielce))
    expect(neighborTip).not.toMatch(/supply 30/)
    expect(cursorHoverText(kielce, hoverNote)).toBeNull()

    const selfTip = provinceHoverNote(krakow, hoverNote)
    expect(selfTip).toContain("Supply 20 < 30")
    expect(selfTip).toContain("Kraków")
    const selfCursor = cursorHoverText(krakow, hoverNote)
    expect(selfCursor).toBe("Supply 20 < 30")
    expect(selfCursor).not.toContain("Total unit strength")
    expect(legalTargetHoverNote(targets, "kielce")).toBe("Supply 20 < 30")
  })

  it("keeps a no-formation refusal on the origin, not on a neighbor", () => {
    const game = freshGame()
    const krakow = game.state.provinces.find((item) => item.id === "krakow")
    if (!krakow) throw new Error("krakow missing")
    const claimed = krakow.units
      .filter((unit) => unit.faction === "central")
      .map((unit) => unit.id)
    const queue = [
      {
        id: "q1",
        kind: "attack" as const,
        from: "konigsberg",
        to: "ermland_masuren",
        unitIds: claimed,
      },
    ]
    const targets = legalTargets(game.state, "krakow", queue)
    const hoverNote = mapTargetHoverNote(targets)
    const kielce = game.state.provinces.find((item) => item.id === "kielce")
    if (!kielce) throw new Error("kielce missing")
    expect(provinceHoverNote(kielce, hoverNote)).not.toMatch(/no unassigned formation/)
    expect(cursorHoverText(kielce, hoverNote)).toBeNull()
    const self = cursorHoverText(krakow, hoverNote)
    expect(self).toBe("Already ordered")
    expect(self).not.toContain("Total unit strength")
  })

  it("places the cursor tip inside the map frame", () => {
    expect(cursorTipPosition(20, 30, 800, 600)).toEqual({ x: 34, y: 46 })
    const edge = cursorTipPosition(790, 580, 800, 600)
    expect(edge.x).toBeLessThanOrEqual(800 - 176 - 8)
    expect(edge.y).toBeLessThanOrEqual(600 - 52 - 8)
    expect(cursorHoverText(kielceQuiet(), undefined)).toBeNull()
  })
})

function kielceQuiet() {
  const game = freshGame()
  const kielce = game.state.provinces.find((item) => item.id === "kielce")
  if (!kielce) throw new Error("kielce missing")
  return kielce
}