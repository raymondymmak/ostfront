import { describe, expect, it } from "vitest"
import { CATALOG_BY_ID } from "@/lib/data/catalog"
import { outerRing, routeBetweenProvinces, ringsShareBorder } from "@/lib/map/shared-border"

describe("shared border routing", () => {
  it("finds a shared edge between neighbors", () => {
    const krakow = CATALOG_BY_ID.krakow.polygon
    const stanislawow = CATALOG_BY_ID.stanislawow.polygon
    expect(ringsShareBorder(krakow, stanislawow)).toBe(true)
    expect(outerRing(krakow)?.length).toBeGreaterThan(3)
  })

  it("routes krakow–stanislawow rails through one border gate, not a straight chord", () => {
    const start = CATALOG_BY_ID.krakow.centroid
    const end = CATALOG_BY_ID.stanislawow.centroid
    const path = routeBetweenProvinces(CATALOG_BY_ID.krakow.polygon, CATALOG_BY_ID.stanislawow.polygon, start, end)
    expect(path).toHaveLength(3)
    expect(path[0]).not.toEqual(start)
    expect(path[path.length - 1]).not.toEqual(end)
  })

  it("does not zigzag through every shared edge midpoint", () => {
    const start = CATALOG_BY_ID.wolyn.centroid
    const end = CATALOG_BY_ID.polesie.centroid
    const path = routeBetweenProvinces(CATALOG_BY_ID.wolyn.polygon, CATALOG_BY_ID.polesie.polygon, start, end)
    expect(path).toHaveLength(3)
  })
})