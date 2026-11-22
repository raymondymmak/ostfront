import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  LIFT_REACH,
  LIFT_TARGET,
  baseFill,
  liftFill,
  provincePaintProperties,
  reachFill,
  resolvedFill,
  roleFor,
} from "@/lib/map/province-paint"
import { MAP_FACTION_FILL } from "@/lib/ui/map-target-style"

describe("province paint", () => {
  const central = { controller: "central" as const, supply: 72, unrest: 12 }

  it("matches faction base fills", () => {
    expect(baseFill(central, "none")).toBe(MAP_FACTION_FILL.central)
    expect(baseFill({ ...central, controller: "russia" }, "none")).toBe(MAP_FACTION_FILL.russia)
  })

  it("ramps supply and unrest as hex so lift stays valid", () => {
    expect(baseFill({ ...central, supply: 0 }, "supply")).toMatch(/^#[0-9a-f]{6}$/i)
    expect(baseFill({ ...central, supply: 100 }, "supply")).toMatch(/^#[0-9a-f]{6}$/i)
    expect(baseFill({ ...central, unrest: 50 }, "unrest")).toMatch(/^#[0-9a-f]{6}$/i)
    const paint = provincePaintProperties({ ...central, supply: 40 }, "supply", "move")
    expect(paint.lift).not.toBe(paint.fill)
    expect(paint.liftSoft).not.toBe(paint.fill)
  })

  it("lifts hex fills toward white", () => {
    expect(liftFill("#000000", 0)).toBe("#000000")
    expect(liftFill("#000000", 1)).toBe("#ffffff")
    expect(liftFill(MAP_FACTION_FILL.central, 0.5)).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it("writes clearly lighter lift / liftSoft than the base fill", () => {
    const paint = provincePaintProperties(central, "none", "move")
    expect(paint.role).toBe("move")
    expect(paint.lift).toBe(liftFill(paint.fill, LIFT_TARGET))
    expect(paint.liftSoft).toBe(liftFill(paint.fill, LIFT_REACH))
    expect(paint.lift).not.toBe(paint.fill)
    expect(paint.liftSoft).not.toBe(paint.fill)
    expect(LIFT_TARGET).toBeGreaterThan(LIFT_REACH)
    expect(resolvedFill(paint, "move")).toBe(paint.lift)
    expect(resolvedFill(paint, "reach")).toBe(paint.liftSoft)
    expect(resolvedFill(paint, "none")).toBe(paint.fill)
  })

  it("reach uses a lifted control color", () => {
    expect(reachFill(central)).toBe(liftFill(MAP_FACTION_FILL.central, LIFT_REACH))
  })

  it("assigns move, attack, and reach roles; non-targets stay none", () => {
    expect(roleFor("katowice", { move: ["katowice"], attack: [], canOrder: true }, "krakow")).toBe("move")
    expect(roleFor("kielce", { move: [], attack: ["kielce"], canOrder: true }, "krakow")).toBe("attack")
    expect(roleFor("katowice", { move: ["katowice"], attack: [], canOrder: false }, "krakow")).toBe("reach")
    expect(roleFor("poznan", { move: ["katowice"], attack: [], canOrder: true }, "krakow")).toBe("none")
    expect(roleFor("krakow", { move: ["katowice"], attack: [], canOrder: true }, "krakow")).toBe("none")
  })

  it("never resolves non-targets to a navy dim fill", () => {
    const paint = provincePaintProperties(central, "none", "none")
    expect(resolvedFill(paint, "none")).toBe(paint.fill)
    expect(resolvedFill(paint, "none")).not.toBe("#0c0a12")
    const source = readFileSync("lib/map/province-paint.ts", "utf8")
    expect(source).not.toMatch(/"dim"/)
    expect(source).not.toContain("#0c0a12")
  })

  it("keeps base fill on provinces; lifts use feature-state role on target-fill", () => {
    const layers = readFileSync("lib/map/war-map-layers.ts", "utf8")
    const map = readFileSync("components/war-map.tsx", "utf8")
    expect(layers).toContain('["get", "fill"]')
    expect(layers).toContain('["get", "lift"]')
    expect(layers).toContain('["get", "liftSoft"]')
    expect(layers).toContain('["feature-state", "role"]')
    expect(layers).not.toContain('"dim"')
    expect(map).toContain("provincePaintProperties(")
    expect(map).toContain("applyProvinceRoleStates")
    expect(map).toContain('promoteId: "id"')
  })
})