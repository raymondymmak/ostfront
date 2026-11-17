import { describe, expect, it } from "vitest"
import { MAP_FACTION_FILL, MAP_TARGET_STYLE, mapTargetsActive } from "@/lib/ui/map-target-style"

describe("map target highlight style", () => {
  it("uses lighter faction-tinted fills and outlines", () => {
    expect(MAP_TARGET_STYLE.move.outlineWidth).toBeGreaterThanOrEqual(2.5)
    expect(MAP_TARGET_STYLE.attack.outlineWidth).toBeGreaterThanOrEqual(2.5)
    expect(MAP_TARGET_STYLE.move.fill).not.toBe(MAP_FACTION_FILL.central)
    expect(MAP_TARGET_STYLE.attack.fill).not.toBe(MAP_FACTION_FILL.russia)
    expect(MAP_TARGET_STYLE.move.fill.startsWith("#7")).toBe(true)
    expect(MAP_TARGET_STYLE.attack.fill.startsWith("#c")).toBe(true)
  })

  it("detects when legal targets should drive dimming", () => {
    expect(mapTargetsActive(undefined)).toBe(false)
    expect(mapTargetsActive({ move: [], attack: [] })).toBe(false)
    expect(mapTargetsActive({ move: ["katowice"], attack: [] })).toBe(true)
  })
})