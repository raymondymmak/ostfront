import { describe, expect, it } from "vitest"
import { vignettePaths, vignetteProvinceIds } from "@/lib/map/svg-geometry"
import { MAP_FACTION_FILL, newsVignetteTargetFill } from "@/lib/ui/map-target-style"

describe("news map vignette geometry", () => {
  it("includes target and neighbor path data for Lemberg", () => {
    const ids = vignetteProvinceIds("lwow", ["krakow", "kielce"])
    expect(ids).toContain("lwow")
    expect(ids).toContain("krakow")
    const paths = vignettePaths(ids)
    expect(paths.length).toBeGreaterThanOrEqual(ids.length - 1)
    for (const id of ["lwow", "krakow"]) {
      const entry = paths.find((p) => p.id === id)
      expect(entry?.d).toMatch(/^M/)
      expect(entry?.d.length).toBeGreaterThan(20)
    }
  })
})

describe("news map vignette faction fill", () => {
  it("uses MAP_FACTION_FILL for the new controller", () => {
    expect(newsVignetteTargetFill("central")).toBe(MAP_FACTION_FILL.central)
    expect(newsVignetteTargetFill("russia")).toBe(MAP_FACTION_FILL.russia)
  })
})