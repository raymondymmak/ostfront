/**
 * Builds theater polygons (playable provinces, grey backdrop, rivers).
 * Playable mesh: Natural-Earth-informed Voronoi clipped to the theater hull.
 * Run: npx tsx scripts/generate-theater-geometry.ts
 *
 * Data: Natural Earth 1:50m Admin 0 countries & rivers (public domain).
 */
import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { Delaunay } from "d3-delaunay"
import * as turf from "@turf/turf"
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson"
import { PROVINCE_DEFS } from "../lib/data/definitions"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const COS = Math.cos((52 * Math.PI) / 180)
const BBOX: [number, number, number, number] = [15.8, 48.35, 28.8, 56.35]
const NE_COUNTRIES =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson"
const NE_RIVERS =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_rivers_lake_centerlines.geojson"

const COAST_GHOSTS: [number, number][] = []

type BackdropRegion = { id: string; name: string; polygon: [number, number][] }
type RiverLine = { id: string; name: string; coordinates: [number, number][] }

async function fetchJson(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)
  return (await response.json()) as FeatureCollection
}

function roundCoord([lon, lat]: [number, number]): [number, number] {
  return [Math.round(lon * 1000) / 1000, Math.round(lat * 1000) / 1000]
}

function clipToBbox(feature: Feature<Polygon | MultiPolygon>) {
  const box = turf.bboxPolygon(BBOX)
  const clipped = turf.intersect(turf.featureCollection([feature, box]))
  return clipped ?? null
}

function buildTheaterHull() {
  const hull = turf.convex(
    turf.featureCollection(PROVINCE_DEFS.map((def) => turf.point([def.lon, def.lat]))),
  )
  if (!hull) throw new Error("convex hull failed")
  const buffered = turf.buffer(hull, 90, { units: "kilometers" })
  if (!buffered) throw new Error("buffer failed")
  const box = turf.bboxPolygon(BBOX)
  const clipped = turf.intersect(turf.featureCollection([buffered, box]))
  return clipped ?? buffered
}

function buildProvinceMesh(hull: Feature<Polygon | MultiPolygon>) {
  const seeds = [
    ...PROVINCE_DEFS.map((def) => ({ id: def.id, lon: def.lon, lat: def.lat, ghost: false })),
    ...COAST_GHOSTS.map(([lon, lat], index) => ({
      id: `__ghost_${index}`,
      lon,
      lat,
      ghost: true,
    })),
  ]

  const projected = seeds.map((s) => [s.lon * COS, s.lat] as [number, number])
  const delaunay = Delaunay.from(projected)
  const xs = projected.map((p) => p[0])
  const ys = projected.map((p) => p[1])
  const pad = 0.42
  const voronoi = delaunay.voronoi([
    Math.min(...xs) - pad,
    Math.min(...ys) - pad,
    Math.max(...xs) + pad,
    Math.max(...ys) + pad,
  ])

  const polygons: Record<string, [number, number][]> = {}
  const centroids: Record<string, [number, number]> = {}

  seeds.forEach((seed, index) => {
    if (seed.ghost) return
    const ring = voronoi.cellPolygon(index) ?? []
    if (ring.length < 4) return
    const geoRing = ring.map(([x, y]) => [x / COS, y] as [number, number])
    geoRing.push(geoRing[0])
    let cell = turf.polygon([geoRing])
    const clipped = turf.intersect(turf.featureCollection([cell, hull]))
    if (!clipped) return
    const simplified = turf.simplify(clipped, { tolerance: 0.008, highQuality: true })
    const outer =
      simplified.geometry.type === "Polygon"
        ? simplified.geometry.coordinates[0]
        : simplified.geometry.coordinates[0][0]
    if (!outer || outer.length < 4) return
    const cleaned = outer.map((coord) => roundCoord(coord as [number, number]))
    if (cleaned[0][0] !== cleaned.at(-1)![0] || cleaned[0][1] !== cleaned.at(-1)![1]) {
      cleaned.push(cleaned[0])
    }
    polygons[seed.id] = cleaned
    centroids[seed.id] = roundCoord([seed.lon, seed.lat])
  })

  const neighbors = neighborsFromPolygons(polygons)
  return { polygons, centroids, neighbors }
}

function neighborsFromPolygons(polygons: Record<string, [number, number][]>) {
  const features = Object.entries(polygons).map(([id, ring]) => turf.polygon([ring], { id }))
  const neighbors: Record<string, string[]> = {}
  for (const id of Object.keys(polygons)) neighbors[id] = []

  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      const a = features[i]
      const b = features[j]
      if (!turf.booleanIntersects(a, b)) continue
      const line = turf.lineIntersect(a, b)
      if (!line.features.length && !turf.booleanTouches(a, b)) continue
      const idA = a.properties?.id as string
      const idB = b.properties?.id as string
      if (!neighbors[idA].includes(idB)) neighbors[idA].push(idB)
      if (!neighbors[idB].includes(idA)) neighbors[idB].push(idA)
    }
  }
  for (const id of Object.keys(neighbors)) neighbors[id].sort()
  return neighbors
}

function buildBackdrop(
  countries: FeatureCollection<Polygon | MultiPolygon>,
  playableUnion: Feature<Polygon | MultiPolygon>,
): BackdropRegion[] {
  const labels: Record<string, string> = {
    Germany: "Germany",
    Russia: "Russia",
    Austria: "Austria-Hungary",
    Belarus: "Russia",
    Ukraine: "Russia",
    Lithuania: "Lithuania",
    Latvia: "Latvia",
    Czechia: "Bohemia",
    Slovakia: "Slovakia",
    Romania: "Romania",
  }
  const regions: BackdropRegion[] = []
  const playable = turf.buffer(playableUnion, 4, { units: "kilometers" }) ?? playableUnion

  for (const feature of countries.features) {
    const name = feature.properties?.NAME as string | undefined
    if (!name || !labels[name]) continue
    const clipped = clipToBbox(feature as Feature<Polygon | MultiPolygon>)
    if (!clipped) continue
    const diff = turf.difference(turf.featureCollection([clipped, playable]))
    if (!diff) continue
    const label = labels[name] ?? name
    const polys =
      diff.geometry.type === "Polygon"
        ? [diff.geometry.coordinates[0]]
        : diff.geometry.coordinates.map((p) => p[0])
    polys.forEach((ring, index) => {
      if (ring.length < 4) return
      regions.push({
        id: `${name.toLowerCase().replace(/\s+/g, "-")}-${index}`,
        name: label,
        polygon: ring.map((c) => roundCoord(c as [number, number])),
      })
    })
  }

  const seaMask = turf.difference(turf.featureCollection([turf.bboxPolygon(BBOX), playableUnion]))
  if (seaMask) {
    const rings =
      seaMask.geometry.type === "Polygon"
        ? [seaMask.geometry.coordinates[0]]
        : seaMask.geometry.coordinates.map((p) => p[0])
    rings.forEach((ring, index) => {
      if (ring.length < 4) return
      regions.push({
        id: `baltic-${index}`,
        name: "Baltic Sea",
        polygon: ring.map((c) => roundCoord(c as [number, number])),
      })
    })
  }

  return regions
}

function extractRivers(
  rivers: FeatureCollection,
  playable: Feature<Polygon | MultiPolygon>,
): RiverLine[] {
  const wanted = /vistula|niemen|nemunas|narew|bug|san|memel|daugava/i
  const lines: RiverLine[] = []
  for (const feature of rivers.features) {
    const name = String(feature.properties?.name ?? "")
    if (!wanted.test(name)) continue
    if (feature.geometry.type !== "LineString" && feature.geometry.type !== "MultiLineString") continue
    const coords =
      feature.geometry.type === "LineString"
        ? feature.geometry.coordinates
        : feature.geometry.coordinates.flat()
    const line = turf.lineString(coords as [number, number][], { name })
    const clipped = turf.bboxClip(line, BBOX)
    if (turf.length(clipped, { units: "kilometers" }) < 35) continue
    lines.push({
      id: name.toLowerCase().replace(/\s+/g, "-"),
      name,
      coordinates: (clipped.geometry.coordinates as [number, number][]).map(roundCoord),
    })
  }
  return lines
}

async function main() {
  const [countriesRaw, riversRaw] = await Promise.all([
    fetchJson(NE_COUNTRIES),
    fetchJson(NE_RIVERS),
  ])

  const hull = buildTheaterHull()
  const { polygons, centroids, neighbors } = buildProvinceMesh(hull)

  const playableFeatures = Object.entries(polygons).map(([id, ring]) => turf.polygon([ring], { id }))
  const playableUnion =
    playableFeatures.length === 1
      ? playableFeatures[0]
      : turf.union(turf.featureCollection(playableFeatures))
  if (!playableUnion) throw new Error("playable union failed")

  const backdrop = buildBackdrop(
    countriesRaw as FeatureCollection<Polygon | MultiPolygon>,
    playableUnion,
  )
  const rivers = extractRivers(riversRaw, playableUnion)

  const payload = {
    source: "Natural Earth 1:50m Admin 0 countries & rivers (public domain); province mesh clipped to theater hull",
    bbox: BBOX,
    polygons,
    centroids,
    neighbors,
    backdrop,
    rivers,
  }

  const out = join(ROOT, "lib/data/theater-geometry.json")
  writeFileSync(out, `${JSON.stringify(payload)}\n`)
  console.log(`Wrote ${out}`)
  console.log(`provinces ${Object.keys(polygons).length}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
