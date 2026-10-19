import { describe, expect, it } from "vitest"
import { CATALOG, PROVINCE_COUNT } from "@/lib/data/catalog"
import { BACKDROP_REGIONS, buildTheater, neighborsFromPolygons } from "@/lib/data/geometry"
import * as turf from "@turf/turf"

describe("theater geometry", () => {
  const theater = buildTheater()

  it("has one polygon per catalog province", () => {
    expect(Object.keys(theater.polygons)).toHaveLength(PROVINCE_COUNT)
    for (const province of CATALOG) {
      expect(theater.polygons[province.id]?.length ?? 0).toBeGreaterThanOrEqual(4)
    }
  })

  it("keeps adjacency symmetric", () => {
    for (const province of CATALOG) {
      for (const other of theater.neighbors[province.id]) {
        expect(theater.neighbors[other]).toContain(province.id)
      }
    }
  })

  it("avoids overlapping playable provinces", () => {
    const features = CATALOG.map((province) =>
      turf.polygon([theater.polygons[province.id]], { id: province.id }),
    )
    for (let i = 0; i < features.length; i++) {
      for (let j = i + 1; j < features.length; j++) {
        const overlap = turf.intersect(turf.featureCollection([features[i], features[j]]))
        if (!overlap) continue
        expect(turf.area(overlap)).toBeLessThan(1e-6)
      }
    }
  })

  it("does not put backdrop regions in the playable adjacency graph", () => {
    const playable = new Set(CATALOG.map((province) => province.id))
    for (const region of BACKDROP_REGIONS) {
      expect(playable.has(region.id)).toBe(false)
    }
  })
})
