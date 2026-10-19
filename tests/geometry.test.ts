import { describe, expect, it } from "vitest"
import { CATALOG, PROVINCE_COUNT } from "@/lib/data/catalog"
import { BACKDROP_REGIONS, buildTheater, neighborsFromPolygons } from "@/lib/data/geometry"
import theaterData from "@/lib/data/theater-geometry.json"
import { createInitialState } from "@/lib/data/scenario"
import * as turf from "@turf/turf"

type ValidationMeta = {
  theaterLandAreaKm2: number
  playableAreaKm2: number
  minProvinceAreaKm2: number
}

describe("theater geometry", () => {
  const theater = buildTheater()
  const validation = (theaterData as { validation?: ValidationMeta }).validation

  it("has one polygon per catalog province", () => {
    expect(Object.keys(theater.polygons)).toHaveLength(PROVINCE_COUNT)
    for (const province of CATALOG) {
      expect(theater.polygons[province.id]?.length ?? 0).toBeGreaterThanOrEqual(4)
    }
  })

  it("keeps playable area close to theater land and provinces above minimum size", () => {
    expect(validation).toBeDefined()
    const { theaterLandAreaKm2, playableAreaKm2, minProvinceAreaKm2 } = validation!
    const ratio = playableAreaKm2 / theaterLandAreaKm2
    expect(ratio).toBeGreaterThan(0.9)
    expect(ratio).toBeLessThan(1.08)
    expect(minProvinceAreaKm2).toBeGreaterThan(4_000)

    let summed = 0
    for (const province of CATALOG) {
      const ring = theater.polygons[province.id]
      const areaKm2 = turf.area(turf.polygon([ring])) / 1e6
      summed += areaKm2
      expect(areaKm2).toBeGreaterThan(4_000)
    }
    expect(Math.abs(summed - playableAreaKm2)).toBeLessThan(theaterLandAreaKm2 * 0.02)
  })

  it("places each centroid inside its province polygon", () => {
    for (const province of CATALOG) {
      const ring = theater.polygons[province.id]
      const centroid = theater.centroids[province.id]
      expect(turf.booleanPointInPolygon(turf.point(centroid), turf.polygon([ring]))).toBe(true)
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

  it("matches polygon-derived adjacency from stored neighbors", () => {
    const derived = neighborsFromPolygons(theater.polygons)
    for (const province of CATALOG) {
      expect(derived[province.id].sort()).toEqual(theater.neighbors[province.id].sort())
    }
  })
})

describe("opening map counters", () => {
  it("gives every province with formations a positive strength total", () => {
    const state = createInitialState()
    for (const province of state.provinces) {
      const strength = province.units.reduce((sum, unit) => sum + unit.strength, 0)
      if (province.units.length > 0) {
        expect(strength).toBeGreaterThan(0)
      }
    }
    const withUnits = state.provinces.filter((province) => province.units.length > 0)
    expect(withUnits.length).toBeGreaterThanOrEqual(36)
  })
})
