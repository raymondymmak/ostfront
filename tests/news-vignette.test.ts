import { describe, expect, it } from "vitest"
import { vignettePaths, vignetteProvinceIds } from "@/lib/map/svg-geometry"

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