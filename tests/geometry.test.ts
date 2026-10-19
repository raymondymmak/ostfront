import { describe, expect, it } from "vitest"
import { CATALOG, PROVINCE_COUNT } from "@/lib/data/catalog"
import {
  BACKDROP_REGIONS,
  GEOMETRY_SOURCE,
  LAND_POLYGONS,
  buildTheater,
  neighborsFromPolygons,
} from "@/lib/data/geometry"
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
      expect(theater.polygons[province.id]?.[0]?.length ?? 0).toBeGreaterThanOrEqual(4)
    }
  })

  it("keeps playable area close to theater land and provinces above minimum size", () => {
    expect(validation).toBeDefined()
    const { theaterLandAreaKm2, playableAreaKm2, minProvinceAreaKm2 } = validation!
    const ratio = playableAreaKm2 / theaterLandAreaKm2
    expect(ratio).toBeGreaterThan(0.9)
    expect(ratio).toBeLessThan(1.08)
    expect(minProvinceAreaKm2).toBeGreaterThan(2_400)

    for (const province of CATALOG) {
      const rings = theater.polygons[province.id]
      const parts = rings.filter((ring) => ring.length >= 4).map((ring) => turf.polygon([ring]))
      const areaKm2 =
        parts.length === 1
          ? turf.area(parts[0]) / 1e6
          : turf.area(turf.union(turf.featureCollection(parts))!) / 1e6
      expect(areaKm2).toBeGreaterThan(2_400)
    }
  })

  it("places each centroid inside its province polygon", () => {
    for (const province of CATALOG) {
      const rings = theater.polygons[province.id]
      const centroid = theater.centroids[province.id]
      expect(turf.booleanPointInPolygon(turf.point(centroid), turf.polygon(rings))).toBe(true)
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
    if (/hoi4|kaiserreich/i.test(GEOMETRY_SOURCE)) return

    const features = CATALOG.map((province) => {
      const rings = theater.polygons[province.id]
      const parts = rings.filter((ring) => ring.length >= 4).map((ring) => turf.polygon([ring]))
      const merged =
        parts.length === 1
          ? parts[0]
          : turf.union(turf.featureCollection(parts)) ?? parts[0]
      return turf.feature(merged.geometry, { id: province.id })
    })
    for (let i = 0; i < features.length; i++) {
      for (let j = i + 1; j < features.length; j++) {
        const overlap = turf.intersect(turf.featureCollection([features[i], features[j]]))
        if (!overlap) continue
        expect(turf.area(overlap)).toBeLessThan(1e-6)
      }
    }
  })

  it("includes extended land backdrop for the viewport", () => {
    expect(LAND_POLYGONS.length).toBeGreaterThan(0)
    let minLon = Infinity
    for (const ring of LAND_POLYGONS) {
      for (const [lon] of ring) minLon = Math.min(minLon, lon)
    }
    expect(minLon).toBeLessThan(14)
  })

  it("does not put backdrop regions in the playable adjacency graph", () => {
    const playable = new Set(CATALOG.map((province) => province.id))
    for (const region of BACKDROP_REGIONS) {
      expect(playable.has(region.id)).toBe(false)
    }
  })

  it("gives adjacent provinces a shared border segment", () => {
    const fromHoi4 =
      /hoi4|kaiserreich/i.test(theater.source) ||
      Boolean((theater as { hoi4MapSource?: string }).hoi4MapSource)
    if (!fromHoi4) return

    const derived = neighborsFromPolygons(theater.polygons)
    for (const province of CATALOG) {
      for (const other of derived[province.id]) {
        const a = turf.polygon(theater.polygons[province.id])
        const b = turf.polygon(theater.polygons[other])
        const line = turf.lineIntersect(a, b)
        let km = 0
        for (const f of line.features) {
          if (f.geometry.type === "LineString") km += turf.length(f, { units: "kilometers" })
        }
        expect(km).toBeGreaterThan(0.25)
      }
    }
  })

  it("matches polygon-derived adjacency from stored neighbors", () => {
    const derived = neighborsFromPolygons(theater.polygons)
    for (const province of CATALOG) {
      for (const other of derived[province.id]) {
        expect(theater.neighbors[province.id]).toContain(other)
      }
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
