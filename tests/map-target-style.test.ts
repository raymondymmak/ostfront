import { describe, expect, it } from "vitest"
import { MAP_TARGET_STYLE, mapTargetsActive } from "@/lib/ui/map-target-style"

describe("map target highlight style", () => {
  it("uses high-contrast outlines separate from controller fills", () => {
    expect(MAP_TARGET_STYLE.move.outlineWidth).toBeGreaterThanOrEqual(2.5)
    expect(MAP_TARGET_STYLE.attack.outlineWidth).toBeGreaterThanOrEqual(2.5)
    expect(MAP_TARGET_STYLE.move.fill).not.toBe("#4a6d90")
    expect(MAP_TARGET_STYLE.attack.fill).not.toBe("#a85b49")
  })

  it("detects when legal targets should drive dimming", () => {
    expect(mapTargetsActive(undefined)).toBe(false)
    expect(mapTargetsActive({ move: [], attack: [] })).toBe(false)
    expect(mapTargetsActive({ move: ["katowice"], attack: [] })).toBe(true)
  })
})