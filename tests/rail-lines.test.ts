import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { CATALOG_BY_ID } from "@/lib/data/catalog"
import { createInitialState, linksOf } from "@/lib/data/scenario"
import {
  RAIL_FULL_ZOOM,
  RAIL_HIDDEN_ZOOM,
  RAIL_HOT_WIDTH_SCALE,
  railLineOpacity,
  railLines,
  type RailEnd,
} from "@/lib/map/rail-lines"
import { PROVINCE_LABEL_FULL_ZOOM, PROVINCE_LABEL_HIDDEN_ZOOM } from "@/lib/map/province-label-zoom"

const OPENING_ZOOM = 6.833576
const EUROPE_ZOOM = 5.3172

const ROUTE_FIXTURE = JSON.parse(readFileSync("tests/fixtures/rail-routes.json", "utf8")) as Array<{
  a: string
  b: string
  side: string
  pointCount: number
  coordinates: [number, number][]
  hotWidthScale: number
}>

function endsFrom(state = createInitialState()): RailEnd[] {
  return state.provinces.map((province) => ({
    id: province.id,
    neighbors: province.neighbors,
    rail: province.rail,
    controller: province.controller,
    anchor: CATALOG_BY_ID[province.id]?.centroid,
    polygon: CATALOG_BY_ID[province.id]?.polygon,
  }))
}

function pair(lines: ReturnType<typeof railLines>, a: string, b: string) {
  return lines.find((line) => (line.a === a && line.b === b) || (line.a === b && line.b === a))
}

function snapCoord([lon, lat]: [number, number]): [number, number] {
  return [Number(lon.toFixed(5)), Number(lat.toFixed(5))]
}

describe("rail lines", () => {
  it("draws exactly the rail edges linksOf gives the supply engine", () => {
    const state = createInitialState()
    const drawn = railLines(endsFrom(state))
    const engine = linksOf(state).filter((link) => link.rail)
    expect(drawn).toHaveLength(engine.length)
    expect(drawn.length).toBeGreaterThan(10)
    for (const link of engine) {
      expect(pair(drawn, link.a, link.b)).toBeDefined()
    }
  })

  it("keeps a line when both ends share a faction, and breaks it when they do not", () => {
    const lines = railLines(endsFrom())
    expect(pair(lines, "krakow", "stanislawow")?.side).toBe("central")
    expect(pair(lines, "warszawa", "lublin")?.side).toBe("russia")
    expect(pair(lines, "krakow", "lwow")?.side).toBe("cut")
    expect(pair(lines, "lwow", "stanislawow")?.side).toBe("cut")
  })

  it("follows control, so a captured city restores the line", () => {
    const provinces = endsFrom()
    const lemberg = provinces.find((province) => province.id === "lwow")
    expect(lemberg).toBeDefined()
    lemberg!.controller = "central"
    const lines = railLines(provinces)
    expect(pair(lines, "krakow", "lwow")?.side).toBe("central")
    expect(pair(lines, "lwow", "wolyn")?.side).toBe("cut")
  })

  it("matches stable routed coordinates for key pairs", () => {
    const lines = railLines(endsFrom())
    for (const sample of ROUTE_FIXTURE) {
      const line = pair(lines, sample.a, sample.b)
      expect(line).toBeDefined()
      expect(line!.coordinates.length).toBe(sample.pointCount)
      expect(line!.coordinates.map(snapCoord)).toEqual(sample.coordinates)
      expect(line!.hotWidthScale).toBe(sample.hotWidthScale)
    }
  })

  it("routes along the shared border instead of centroids", () => {
    const lines = railLines(endsFrom())
    const flank = pair(lines, "krakow", "stanislawow")
    expect(flank?.coordinates.length).toBeGreaterThan(2)
    expect(flank?.coordinates[0]).not.toEqual(CATALOG_BY_ID.krakow.centroid)
    const last = flank!.coordinates[flank!.coordinates.length - 1]
    expect(last).not.toEqual(CATALOG_BY_ID.stanislawow.centroid)

    const provinces = endsFrom().map((province) =>
      province.id === "krakow" ? { ...province, anchor: null } : province,
    )
    const fallback = pair(railLines(provinces), "krakow", "stanislawow")
    expect(fallback?.coordinates.length).toBeGreaterThan(2)
    const [lon, lat] = fallback!.coordinates[0]
    const ring = CATALOG_BY_ID.krakow.polygon.type === "Polygon"
      ? CATALOG_BY_ID.krakow.polygon.coordinates[0]
      : CATALOG_BY_ID.krakow.polygon.coordinates[0][0]
    const xs = ring.map((coord) => coord[0])
    const ys = ring.map((coord) => coord[1])
    expect(lon).toBeGreaterThan(Math.min(...xs))
    expect(lon).toBeLessThan(Math.max(...xs))
    expect(lat).toBeGreaterThan(Math.min(...ys))
    expect(lat).toBeLessThan(Math.max(...ys))
  })

  it("highlights only the rails that touch the selected province", () => {
    const lines = railLines(endsFrom(), "krakow")
    expect(pair(lines, "krakow", "lwow")?.hot).toBe(true)
    expect(pair(lines, "krakow", "stanislawow")?.hot).toBe(true)
    expect(pair(lines, "krakow", "stanislawow")?.hotWidthScale).toBe(RAIL_HOT_WIDTH_SCALE)
    expect(pair(lines, "warszawa", "lublin")?.hot).toBe(false)
    expect(railLines(endsFrom(), null).every((line) => !line.hot)).toBe(true)
  })

  it("keeps hot widening mild for selected-province rails", () => {
    expect(RAIL_HOT_WIDTH_SCALE).toBeGreaterThan(1)
    expect(RAIL_HOT_WIDTH_SCALE).toBeLessThanOrEqual(1.2)
  })

  it("fades with the province labels so a zoomed-out map stays readable", () => {
    expect(RAIL_FULL_ZOOM).toBe(PROVINCE_LABEL_FULL_ZOOM)
    expect(RAIL_HIDDEN_ZOOM).toBe(PROVINCE_LABEL_HIDDEN_ZOOM)
    expect(railLineOpacity(OPENING_ZOOM)).toBe(1)
    expect(railLineOpacity(EUROPE_ZOOM)).toBe(0)
    expect(railLineOpacity(OPENING_ZOOM, "cut")).toBe(1)
    expect(railLineOpacity(EUROPE_ZOOM, "cut")).toBe(0)
    const mid = (RAIL_FULL_ZOOM + RAIL_HIDDEN_ZOOM) / 2
    expect(railLineOpacity(mid)).toBeGreaterThan(0.4)
    expect(railLineOpacity(mid)).toBeLessThan(0.6)
    expect(railLineOpacity(mid, "cut")).toBe(railLineOpacity(mid))
  })

  it("feeds the map from the supply links, under the counters", () => {
    const source = readFileSync("components/war-map.tsx", "utf8")
    const lines = readFileSync("lib/map/rail-lines.ts", "utf8")
    const legend = readFileSync("components/map-legend.tsx", "utf8")
    expect(lines).toContain("linksOf")
    expect(source).toContain("railFeatureCollection")
    expect(source).toContain("useState(true)")
    const layers = readFileSync("lib/map/war-map-layers.ts", "utf8")
    expect(layers).not.toContain('id: "rail-sleepers"')
    expect(layers).toContain('id: "rail-casing"')
    expect(layers).toContain('id: "rail-track"')
    expect(layers).toContain('id: "rail-cut"')
    expect(layers).toContain("railWidthHot")
    expect(layers).toContain("RAIL_STYLE.casing")
    expect(layers).toContain("RAIL_STYLE.track")
    // Soft but readable at open zoom (not the old 0.62 / 0.38 fade caps).
    expect(layers).toContain("railFade(0.85)")
    expect(layers).not.toContain("railFade(0.62)")
    expect(layers).not.toContain("railFade(0.38)")
    expect(layers).toContain("railWidthHot(2.0, 3.0)")
    expect(layers).toContain("railWidthHot(3.1, 4.1)")
    // Zoom interpolate must be top-level — nesting under `*` rejects the layer.
    expect(layers).not.toMatch(/\*\s*,\s*\[\s*[\"']coalesce[\"'][\s\S]*?railWidth\(/)
    expect(layers).toContain('id: "province-labels"')
    expect(source).not.toContain("new maplibregl.Marker")
    expect(source).toContain('"rail-casing"')
    const casingAt = layers.indexOf('id: "rail-casing"')
    const railsAt = layers.indexOf('id: "rail-track"')
    const cutAt = layers.indexOf('id: "rail-cut"')
    const provincesAt = layers.indexOf('id: "provinces"')
    const bordersAt = layers.indexOf('id: "borders"')
    const labelsAt = layers.indexOf('id: "province-labels"')
    const countersAt = layers.indexOf('id: "province-counters"')
    expect(casingAt).toBeGreaterThan(provincesAt)
    expect(casingAt).toBeGreaterThan(bordersAt)
    expect(railsAt).toBeGreaterThan(casingAt)
    expect(cutAt).toBeGreaterThan(railsAt)
    expect(labelsAt).toBeGreaterThan(cutAt)
    expect(countersAt).toBeGreaterThan(labelsAt)
    const labelLayers = readFileSync("lib/map/province-label-layers.ts", "utf8")
    expect(labelLayers).toContain("provinceLabelCollection")
    const openAt = legend.indexOf("{open &&")
    const toggleAt = legend.indexOf('data-testid="rail-toggle"')
    expect(openAt).toBeGreaterThan(0)
    expect(toggleAt).toBeGreaterThan(openAt)
    expect(legend.slice(0, openAt)).not.toContain("rail-toggle")
    expect(legend.slice(openAt, toggleAt)).toContain("Rails")
    expect(legend).toContain("aria-pressed={showRails}")
    expect(legend).toContain("cannot advance")
    expect(legend).toContain("overlay === \"supply\"")
    expect(legend).toContain("overlay === \"unrest\"")
    expect(legend).toContain("overlay === \"resources\"")
  })
})