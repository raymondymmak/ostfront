import { describe, expect, it } from "vitest"
import { baseFill, liftFill, reachFill, roleFor } from "@/lib/map/province-paint"
import { MAP_FACTION_FILL } from "@/lib/ui/map-target-style"

describe("province paint", () => {
  const central = { controller: "central" as const, supply: 72, unrest: 12 }

  it("matches faction base fills", () => {
    expect(baseFill(central, "none")).toBe(MAP_FACTION_FILL.central)
    expect(baseFill({ ...central, controller: "russia" }, "none")).toBe(MAP_FACTION_FILL.russia)
  })

  it("ramps supply and unrest like the map overlays", () => {
    expect(baseFill({ ...central, supply: 0 }, "supply")).toBe("rgb(122 46 42)")
    expect(baseFill({ ...central, supply: 100 }, "supply")).toBe("rgb(45 106 69)")
    expect(baseFill({ ...central, unrest: 50 }, "unrest")).toBe("rgb(212 162 76)")
  })

  it("lifts hex fills toward white", () => {
    expect(liftFill("#000000", 0)).toBe("#000000")
    expect(liftFill("#000000", 1)).toBe("#ffffff")
    expect(liftFill(MAP_FACTION_FILL.central, 0.5)).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it("reach uses a lifted control color", () => {
    expect(reachFill(central)).toBe(liftFill(MAP_FACTION_FILL.central, 0.28))
  })

  it("assigns move, attack, reach, and dim roles", () => {
    expect(roleFor("katowice", { move: ["katowice"], attack: [], canOrder: true }, "krakow")).toBe("move")
    expect(roleFor("kielce", { move: [], attack: ["kielce"], canOrder: true }, "krakow")).toBe("attack")
    expect(roleFor("katowice", { move: ["katowice"], attack: [], canOrder: false }, "krakow")).toBe("reach")
    expect(roleFor("poznan", { move: ["katowice"], attack: [], canOrder: true }, "krakow")).toBe("dim")
    expect(roleFor("krakow", { move: ["katowice"], attack: [], canOrder: true }, "krakow")).toBe("none")
  })
})