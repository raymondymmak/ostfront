import { describe, expect, it } from "vitest"
import { CATALOG, PROVINCE_COUNT } from "@/lib/data/catalog"
import {
  BACKDROP_REGIONS,
  GEOMETRY_SOURCE,
  LAND_POLYGONS,
  buildTheater,
  neighborsFromPolygons,
  sharedBorderKm,
} from "@/lib/data/geometry"
import theaterData from "@/lib/data/theater-geometry.json"
import { createInitialState } from "@/lib/data/scenario"
import type { Feature, MultiPolygon, Polygon } from "geojson"
import * as turf from "@turf/turf"

type ValidationMeta = {
  theaterLandAreaKm2: number
  playableAreaKm2: number
  minProvinceAreaKm2: number
  georefMaxResidualKm?: number
}

const MAX_PROVINCE_STRETCH = 4.1
const MAX_PROVINCE_ASPECT = 4.5
const MAX_PROVINCE_DIAGONAL_KM = 580

function provinceFeature(rings: [number, number][][]): Feature<Polygon | MultiPolygon> {
  if (rings.length <= 1) return turf.polygon(rings)
  return turf.multiPolygon(rings.map((ring) => [ring]))
}

function provinceShapeMetrics(rings: [number, number][][]) {
  const feat = provinceFeature(rings)
  const areaKm2 = turf.area(feat) / 1e6
  const [minLon, minLat, maxLon, maxLat] = turf.bbox(feat)
  const sw = turf.point([minLon, minLat])
  const diagonalKm = turf.distance(sw, turf.point([maxLon, maxLat]), { units: "kilometers" })
  const equivDiameterKm = 2 * Math.sqrt(areaKm2 / Math.PI)
  const stretch = diagonalKm / Math.max(equivDiameterKm, 1)
  const widthKm = turf.distance(sw, turf.point([maxLon, minLat]), { units: "kilometers" })
  const heightKm = turf.distance(sw, turf.point([minLon, maxLat]), { units: "kilometers" })
  const aspect = Math.max(widthKm, heightKm) / Math.max(1e-6, Math.min(widthKm, heightKm))
  return { diagonalKm, stretch, aspect, areaKm2 }
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

  it("rejects spiky province bounding boxes", () => {
    for (const province of CATALOG) {
      const rings = theater.polygons[province.id]
      const { diagonalKm, stretch, aspect } = provinceShapeMetrics(rings)
      expect(diagonalKm).toBeLessThan(MAX_PROVINCE_DIAGONAL_KM)
      expect(stretch).toBeLessThan(MAX_PROVINCE_STRETCH)
      expect(aspect).toBeLessThan(MAX_PROVINCE_ASPECT)
    }
  })

  it("keeps playable area close to theater land and provinces above minimum size", () => {
    expect(validation).toBeDefined()
    const { theaterLandAreaKm2, playableAreaKm2, minProvinceAreaKm2 } = validation!
    const ratio = playableAreaKm2 / theaterLandAreaKm2
    expect(ratio).toBeGreaterThan(0.9)
    expect(ratio).toBeLessThan(1.08)
    expect(minProvinceAreaKm2).toBeGreaterThan(2_000)

    for (const province of CATALOG) {
      const rings = theater.polygons[province.id]
      const parts = rings.filter((ring) => ring.length >= 4).map((ring) => turf.polygon([ring]))
      const areaKm2 =
        parts.length === 1
          ? turf.area(parts[0]) / 1e6
          : turf.area(turf.union(turf.featureCollection(parts))!) / 1e6
      expect(areaKm2).toBeGreaterThan(2_000)
    }
  })

  it("places each centroid inside its province polygon", () => {
    for (const province of CATALOG) {
      const rings = theater.polygons[province.id]
      const centroid = theater.centroids[province.id]
      expect(turf.booleanPointInPolygon(turf.point(centroid), provinceFeature(rings) as Feature<Polygon>)).toBe(true)
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
    if (!/worldos/i.test(GEOMETRY_SOURCE)) return

    for (const province of CATALOG) {
      for (const other of theater.neighbors[province.id]) {
        const a = provinceFeature(theater.polygons[province.id])
        const b = provinceFeature(theater.polygons[other])
        expect(sharedBorderKm(a, b)).toBeGreaterThan(0.25)
      }
    }
  })

  it("covers the playable front in one piece without interior holes", () => {
    const features = CATALOG.map((province) => provinceFeature(theater.polygons[province.id])) as Feature<Polygon>[]
    const union = turf.union(turf.featureCollection(features))
    expect(union).toBeTruthy()
    const polygons =
      union!.geometry.type === "Polygon" ? [union!.geometry.coordinates] : union!.geometry.coordinates
    expect(polygons).toHaveLength(1)
    let holeKm2 = 0
    for (const polygon of polygons) {
      for (let index = 1; index < polygon.length; index++) {
        holeKm2 += turf.area(turf.polygon([polygon[index]])) / 1e6
      }
    }
    expect(holeKm2).toBeLessThan(1)
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
