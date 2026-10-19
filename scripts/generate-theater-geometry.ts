/**
 * Theater geometry: Voronoi or admin/river-biased grid inside hull∩land, NE backdrop.
 * Run: npx tsx scripts/generate-theater-geometry.ts
 */
import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { Delaunay } from "d3-delaunay"
import * as turf from "@turf/turf"
import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiLineString,
  MultiPolygon,
  Point,
  Polygon,
} from "geojson"
import { PROVINCE_DEFS } from "../lib/data/definitions"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const COS = Math.cos((52 * Math.PI) / 180)
/** Playable province mesh & adjacency */
export const BBOX: [number, number, number, number] = [15.8, 48.35, 28.8, 56.35]
/** Grey land fill & country backdrop (wider than theater) */
const VIEW_BBOX: [number, number, number, number] = [9.0, 46.75, 32.0, 57.35]
const GRID_COLS = 360
const GRID_ROWS = 288

const NE_LAND =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson"
const NE_COUNTRIES =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson"
const NE_ADMIN1 =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson"
const NE_RIVERS =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_rivers_lake_centerlines.geojson"

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

function clipToBbox(feature: Feature<Polygon | MultiPolygon>, bbox: [number, number, number, number]) {
  const box = turf.bboxPolygon(bbox)
  const clipped = turf.intersect(turf.featureCollection([feature, box]))
  return clipped ?? null
}

function buildLandMask(
  land: FeatureCollection<Polygon | MultiPolygon>,
  bbox: [number, number, number, number],
) {
  const box = turf.bboxPolygon(bbox)
  const pieces: Feature<Polygon | MultiPolygon>[] = []
  for (const feature of land.features) {
    const clipped = turf.intersect(
      turf.featureCollection([feature as Feature<Polygon | MultiPolygon>, box]),
    )
    if (clipped) pieces.push(clipped as Feature<Polygon | MultiPolygon>)
  }
  const union =
    pieces.length === 1 ? pieces[0] : turf.union(turf.featureCollection(pieces))
  if (!union) throw new Error("land union failed")
  return union
}

function ringsFromGeometry(geometry: Polygon | MultiPolygon): [number, number][][] {
  if (geometry.type === "Polygon") return [geometry.coordinates[0] as [number, number][]]
  return geometry.coordinates.map((poly) => poly[0] as [number, number][])
}

function outerRing(merged: Feature<Polygon | MultiPolygon>): [number, number][] {
  if (merged.geometry.type === "Polygon") return merged.geometry.coordinates[0] as [number, number][]
  let best = merged.geometry.coordinates[0][0] as [number, number][]
  let bestArea = turf.area(turf.polygon([best]))
  for (const polygon of merged.geometry.coordinates) {
    const ring = polygon[0] as [number, number][]
    const area = turf.area(turf.polygon([ring]))
    if (area > bestArea) {
      bestArea = area
      best = ring
    }
  }
  return best
}

function clipPolygonsToLand(
  polygons: Record<string, [number, number][]>,
  land: Feature<Polygon | MultiPolygon>,
) {
  for (const def of PROVINCE_DEFS) {
    const ring = polygons[def.id]
    if (!ring?.length) continue
    const clipped = turf.intersect(turf.featureCollection([turf.polygon([ring]), land]))
    if (!clipped) continue
    const outer = outerRing(clipped as Feature<Polygon | MultiPolygon>)
    if (outer.length >= 4) polygons[def.id] = outer.map(roundCoord)
  }
}

function hashNoise(x: number, y: number, seed: number): number {
  let h = (x * 374761 + y * 668265 + seed * 982451) >>> 0
  h = ((h >> 16) ^ h) * 0x45d9f3b
  h = ((h >> 16) ^ h) * 0x45d9f3b
  h = (h >> 16) ^ h
  return (h & 0xffff) / 0xffff - 0.5
}

function cellCenter(col: number, row: number, bbox: [number, number, number, number]): [number, number] {
  const [minLon, minLat, maxLon, maxLat] = bbox
  const lon = minLon + ((col + 0.5) / GRID_COLS) * (maxLon - minLon)
  const lat = maxLat - ((row + 0.5) / GRID_ROWS) * (maxLat - minLat)
  return [lon, lat]
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

function buildProvinceMeshVoronoi(hull: Feature<Polygon | MultiPolygon>) {
  const seeds = PROVINCE_DEFS.map((def) => ({ id: def.id, lon: def.lon, lat: def.lat }))
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
    const ring = voronoi.cellPolygon(index) ?? []
    if (ring.length < 4) return
    const geoRing = ring.map(([x, y]) => [x / COS, y] as [number, number])
    geoRing.push(geoRing[0])
    const cell = turf.polygon([geoRing])
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

  return { polygons, centroids, neighbors: neighborsFromPolygons(polygons) }
}

function adminIdAt(
  lon: number,
  lat: number,
  adminFeatures: Feature<Polygon | MultiPolygon>[],
): string {
  const point = turf.point([lon, lat])
  for (const feature of adminFeatures) {
    if (turf.booleanPointInPolygon(point, feature)) {
      const name = feature.properties?.name ?? feature.properties?.NAME ?? ""
      const code = feature.properties?.adm1_code ?? feature.properties?.iso_3166_2 ?? ""
      return `${name}:${code}`
    }
  }
  return ""
}

function buildRiverMask(
  rivers: FeatureCollection,
  zone: Feature<Polygon | MultiPolygon>,
): Uint8Array {
  const mask = new Uint8Array(GRID_COLS * GRID_ROWS)
  const wanted = /vistula|niemen|nemunas|narew|bug|san|memel|daugava|pregel|passage|dniester|dnieper/i
  for (const feature of rivers.features) {
    const name = String(feature.properties?.name ?? "")
    if (!wanted.test(name)) continue
    if (feature.geometry.type !== "LineString" && feature.geometry.type !== "MultiLineString") continue
    const coords =
      feature.geometry.type === "LineString"
        ? feature.geometry.coordinates
        : feature.geometry.coordinates.flat()
    const line = turf.buffer(turf.lineString(coords as [number, number][]), 4, {
      units: "kilometers",
    })
    if (!line) continue
    const clipped = turf.intersect(turf.featureCollection([line, zone]))
    if (!clipped) continue
    const points = turf.pointGrid(BBOX, 7, { units: "kilometers", mask: clipped })
    for (const point of points.features) {
      const [lon, lat] = point.geometry.coordinates
      const col = Math.floor(((lon - BBOX[0]) / (BBOX[2] - BBOX[0])) * GRID_COLS)
      const row = Math.floor(((BBOX[3] - lat) / (BBOX[3] - BBOX[1])) * GRID_ROWS)
      if (col < 0 || row < 0 || col >= GRID_COLS || row >= GRID_ROWS) continue
      mask[row * GRID_COLS + col] = 1
    }
  }
  return mask
}

function buildAdminMask(
  adminFeatures: Feature<Polygon | MultiPolygon>[],
): string[] {
  const ids = new Array<string>(GRID_COLS * GRID_ROWS)
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const [lon, lat] = cellCenter(col, row, BBOX)
      ids[row * GRID_COLS + col] = adminIdAt(lon, lat, adminFeatures)
    }
  }
  return ids
}

function pointKey(point: [number, number]): string {
  return `${point[0].toFixed(5)},${point[1].toFixed(5)}`
}

function chainEdges(edges: Array<[[number, number], [number, number]]>): [number, number][] {
  if (!edges.length) return []
  const adj = new Map<string, [number, number][]>()
  for (const [a, b] of edges) {
    const ka = pointKey(a)
    const kb = pointKey(b)
    if (!adj.has(ka)) adj.set(ka, [])
    if (!adj.has(kb)) adj.set(kb, [])
    adj.get(ka)!.push(b)
    adj.get(kb)!.push(a)
  }
  const start = edges[0][0]
  const ring: [number, number][] = [start]
  let current = start
  let previous: [number, number] | null = null
  for (let step = 0; step < edges.length + 8; step++) {
    const options = adj.get(pointKey(current)) ?? []
    const next = options.find(
      (candidate) =>
        !previous || candidate[0] !== previous[0] || candidate[1] !== previous[1],
    )
    if (!next) break
    if (ring.length > 2 && next[0] === start[0] && next[1] === start[1]) break
    ring.push(next)
    previous = current
    current = next
  }
  if (ring.length >= 3) ring.push(start)
  return ring
}

function polygonsFromGrid(grid: Int16Array, ids: string[]) {
  const polygons: Record<string, [number, number][]> = {}
  const [minLon, minLat, maxLon, maxLat] = BBOX
  const lonStep = (maxLon - minLon) / GRID_COLS
  const latStep = (maxLat - minLat) / GRID_ROWS

  const idAt = (col: number, row: number) => {
    if (col < 0 || row < 0 || col >= GRID_COLS || row >= GRID_ROWS) return -2
    return grid[row * GRID_COLS + col]
  }

  for (let provinceIndex = 0; provinceIndex < ids.length; provinceIndex++) {
    const edges: Array<[[number, number], [number, number]]> = []
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        if (grid[row * GRID_COLS + col] !== provinceIndex) continue
        const x0 = minLon + col * lonStep
        const x1 = x0 + lonStep
        const y1 = maxLat - row * latStep
        const y0 = y1 - latStep
        if (idAt(col + 1, row) !== provinceIndex) edges.push([[x1, y0], [x1, y1]])
        if (idAt(col, row + 1) !== provinceIndex) edges.push([[x0, y1], [x1, y1]])
        if (idAt(col - 1, row) !== provinceIndex) edges.push([[x0, y0], [x0, y1]])
        if (idAt(col, row - 1) !== provinceIndex) edges.push([[x0, y0], [x1, y0]])
      }
    }
    const ring = chainEdges(edges)
    if (ring.length < 4) continue
    polygons[ids[provinceIndex]] = ring.map(roundCoord)
  }
  return polygons
}

function neighborsFromGrid(grid: Int16Array, ids: string[]) {
  const neighbors: Record<string, string[]> = {}
  for (const id of ids) neighbors[id] = []
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const here = grid[row * GRID_COLS + col]
      if (here < 0) continue
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = col + dc
        const nr = row + dr
        if (nc < 0 || nr < 0 || nc >= GRID_COLS || nr >= GRID_ROWS) continue
        const other = grid[nr * GRID_COLS + nc]
        if (other < 0 || other === here) continue
        const idA = ids[here]
        const idB = ids[other]
        if (!neighbors[idA].includes(idB)) neighbors[idA].push(idB)
        if (!neighbors[idB].includes(idA)) neighbors[idB].push(idA)
      }
    }
  }
  for (const id of ids) neighbors[id].sort()
  return neighbors
}

function buildProvinceMeshGrid(
  hull: Feature<Polygon | MultiPolygon>,
  land: Feature<Polygon | MultiPolygon>,
  riverMask: Uint8Array,
  adminAtCell: string[],
  seedAdmin: Record<string, string>,
) {
  const zone = turf.intersect(turf.featureCollection([hull, land])) ?? hull
  const ids = PROVINCE_DEFS.map((def) => def.id)
  const grid = new Int16Array(GRID_COLS * GRID_ROWS).fill(-1)

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const [lon, lat] = cellCenter(col, row, BBOX)
      const point = turf.point([lon, lat])
      if (!turf.booleanPointInPolygon(point, zone)) continue

      let best = -1
      let bestScore = Number.POSITIVE_INFINITY
      const cellAdmin = adminAtCell[row * GRID_COLS + col]
      const onRiver = riverMask[row * GRID_COLS + col] === 1

      for (let provinceIndex = 0; provinceIndex < PROVINCE_DEFS.length; provinceIndex++) {
        const def = PROVINCE_DEFS[provinceIndex]
        const warp =
          0.11 * hashNoise(col, row, provinceIndex) +
          0.07 * hashNoise(col * 2, row * 3, provinceIndex + 17)
        const riverPenalty = onRiver ? 0.2 : 0
        const adminPenalty =
          cellAdmin && seedAdmin[def.id] && cellAdmin !== seedAdmin[def.id] ? 0.28 : 0
        const score =
          Math.hypot((lon - def.lon) * COS, lat - def.lat) + warp + riverPenalty + adminPenalty
        if (score < bestScore) {
          bestScore = score
          best = provinceIndex
        }
      }
      grid[row * GRID_COLS + col] = best
    }
  }

  let polygons = polygonsFromGrid(grid, ids)
  clipPolygonsToLand(polygons, land)
  const neighbors = neighborsFromGrid(grid, ids)
  return { polygons, grid, neighbors }
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
  bbox: [number, number, number, number],
): BackdropRegion[] {
  const labels: Record<string, string> = {
    Germany: "Germany",
    Russia: "Russia",
    Austria: "Austria-Hungary",
    Belarus: "Russia",
    Ukraine: "Ukraine",
    Lithuania: "Lithuania",
    Latvia: "Latvia",
    Czechia: "Bohemia",
    Slovakia: "Slovakia",
    Romania: "Romania",
    Poland: "Poland",
  }
  const regions: BackdropRegion[] = []
  const playable = turf.buffer(playableUnion, 4, { units: "kilometers" }) ?? playableUnion

  for (const feature of countries.features) {
    const name = feature.properties?.NAME as string | undefined
    if (!name || !labels[name]) continue
    const clipped = clipToBbox(feature as Feature<Polygon | MultiPolygon>, bbox)
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
      if (turf.area(turf.polygon([ring])) < 800_000) return
      regions.push({
        id: `${name.toLowerCase().replace(/\s+/g, "-")}-${index}`,
        name: label,
        polygon: ring.map((c) => roundCoord(c as [number, number])),
      })
    })
  }
  return regions
}

function extractRivers(rivers: FeatureCollection): RiverLine[] {
  const wanted = /vistula|niemen|nemunas|narew|bug|san|memel|daugava|pregel/i
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
    if (turf.length(clipped, { units: "kilometers" }) < 25) continue
    lines.push({
      id: name.toLowerCase().replace(/\s+/g, "-"),
      name,
      coordinates: (clipped.geometry.coordinates as [number, number][]).map(roundCoord),
    })
  }
  return lines
}

function nearestOnPolyline(
  point: Feature<Point>,
  coords: [number, number][],
  maxKm: number,
): [number, number] | null {
  if (coords.length < 2) return null
  const line = turf.lineString(coords)
  const nearest = turf.nearestPointOnLine(line, point)
  const dist = turf.distance(point, nearest, { units: "kilometers" })
  if (dist > maxKm) return null
  return nearest.geometry.coordinates as [number, number]
}

function adminBoundarySegments(adminFeatures: Feature<Polygon | MultiPolygon>[]) {
  const segments: [number, number][][] = []
  for (const feature of adminFeatures) {
    try {
      const line = turf.polygonToLine(feature) as Feature<LineString | MultiLineString>
      if (line.geometry.type === "LineString") {
        segments.push(
          line.geometry.coordinates.map((c) => [c[0], c[1]] as [number, number]) as [number, number][],
        )
      } else if (line.geometry.type === "MultiLineString") {
        for (const part of line.geometry.coordinates) {
          segments.push(part.map((c) => [c[0], c[1]] as [number, number]) as [number, number][])
        }
      }
    } catch {
      /* ignore */
    }
  }
  return segments
}

function refineProvinceShapes(
  polygons: Record<string, [number, number][]>,
  riverLines: RiverLine[],
  adminFeatures: Feature<Polygon | MultiPolygon>[],
) {
  const adminSegments = adminBoundarySegments(adminFeatures)

  for (const def of PROVINCE_DEFS) {
    const ring = polygons[def.id]
    if (!ring || ring.length < 4) continue
    const densified: [number, number][] = []
    const limit = ring.length - 1
    for (let i = 0; i < limit; i++) {
      const a = ring[i]
      const b = ring[i + 1]
      densified.push(a)
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const point = turf.point(mid)
      let snapped: [number, number] | null = null
      for (const river of riverLines) {
        snapped = nearestOnPolyline(point, river.coordinates, 5.5)
        if (snapped) break
      }
      if (!snapped) {
        for (const segment of adminSegments) {
          snapped = nearestOnPolyline(point, segment, 4.5)
          if (snapped) break
        }
      }
      const warp = 0.009 * hashNoise(i, limit, def.id.length)
      const target = snapped ?? mid
      densified.push(
        roundCoord([
          target[0] + (snapped ? 0 : warp),
          target[1] + (snapped ? 0 : warp * 0.55),
        ]),
      )
    }
    densified.push(ring[0])
    const simplified = turf.simplify(turf.polygon([densified]), {
      tolerance: 0.005,
      highQuality: true,
    })
    const outer =
      simplified.geometry.type === "Polygon"
        ? simplified.geometry.coordinates[0]
        : simplified.geometry.coordinates[0][0]
    if (outer?.length >= 4) {
      polygons[def.id] = outer.map((coord) => roundCoord(coord as [number, number]))
    }
  }
}

function validateMesh(
  polygons: Record<string, [number, number][]>,
  centroids: Record<string, [number, number]>,
  land: Feature<Polygon | MultiPolygon>,
  hull: Feature<Polygon | MultiPolygon>,
) {
  const theaterLand = turf.intersect(turf.featureCollection([hull, land]))
  const theaterLandAreaKm2 = theaterLand ? turf.area(theaterLand) / 1e6 : 0
  let playableAreaKm2 = 0
  let minProvinceAreaKm2 = Number.POSITIVE_INFINITY
  for (const ring of Object.values(polygons)) {
    const areaKm2 = turf.area(turf.polygon([ring])) / 1e6
    playableAreaKm2 += areaKm2
    minProvinceAreaKm2 = Math.min(minProvinceAreaKm2, areaKm2)
  }
  for (const def of PROVINCE_DEFS) {
    const centroid = turf.point(centroids[def.id])
    if (!turf.booleanPointInPolygon(centroid, land)) {
      throw new Error(`centroid for ${def.id} is not on Natural Earth land`)
    }
  }
  const coverage = playableAreaKm2 / theaterLandAreaKm2
  if (coverage < 0.9 || coverage > 1.08) {
    throw new Error(
      `playable area coverage ${(coverage * 100).toFixed(1)}% outside 90–108% of theater land`,
    )
  }
  if (minProvinceAreaKm2 < 4_000) {
    throw new Error(`province area too small: ${minProvinceAreaKm2.toFixed(0)} km²`)
  }
  return {
    theaterLandAreaKm2: Math.round(theaterLandAreaKm2),
    playableAreaKm2: Math.round(playableAreaKm2),
    minProvinceAreaKm2: Math.round(minProvinceAreaKm2),
  }
}

async function main() {
  const [landRaw, countriesRaw, admin1Raw, riversRaw] = await Promise.all([
    fetchJson(NE_LAND),
    fetchJson(NE_COUNTRIES),
    fetchJson(NE_ADMIN1),
    fetchJson(NE_RIVERS),
  ])

  const landTheater = buildLandMask(landRaw as FeatureCollection<Polygon | MultiPolygon>, BBOX)
  const landView = buildLandMask(landRaw as FeatureCollection<Polygon | MultiPolygon>, VIEW_BBOX)
  const hull = buildTheaterHull()

  const adminFeatures = (admin1Raw.features as Feature<Polygon | MultiPolygon>[]).filter(
    (feature) => {
      const [lon, lat] = turf.centroid(feature).geometry.coordinates
      return lon >= BBOX[0] - 1 && lon <= BBOX[2] + 1 && lat >= BBOX[1] - 1 && lat <= BBOX[3] + 1
    },
  )
  const seedAdmin: Record<string, string> = {}
  for (const def of PROVINCE_DEFS) {
    seedAdmin[def.id] = adminIdAt(def.lon, def.lat, adminFeatures)
  }
  const riversEarly = extractRivers(riversRaw)
  let polygons: Record<string, [number, number][]>
  let neighbors: Record<string, string[]>
  const voronoiMesh = buildProvinceMeshVoronoi(hull)
  polygons = voronoiMesh.polygons
  clipPolygonsToLand(polygons, landTheater)
  refineProvinceShapes(polygons, riversEarly, adminFeatures)
  clipPolygonsToLand(polygons, landTheater)
  neighbors = neighborsFromPolygons(polygons)
  const meshKind = "voronoi-refined"

  const centroids: Record<string, [number, number]> = {}
  for (const def of PROVINCE_DEFS) {
    const ring = polygons[def.id]
    if (ring?.length >= 4) {
      const poly = turf.polygon([ring])
      const c = turf.pointOnFeature(poly)
      centroids[def.id] = roundCoord(c.geometry.coordinates as [number, number])
    } else {
      centroids[def.id] = roundCoord([def.lon, def.lat])
    }
  }

  const validation = validateMesh(polygons, centroids, landTheater, hull)

  const playableFeatures = Object.entries(polygons).map(([id, ring]) => turf.polygon([ring], { id }))
  const playableUnion =
    playableFeatures.length === 1
      ? playableFeatures[0]
      : turf.union(turf.featureCollection(playableFeatures))
  if (!playableUnion) throw new Error("playable union failed")

  const landRings = ringsFromGeometry(landView.geometry as Polygon | MultiPolygon).map((ring) =>
    ring.map((coord) => roundCoord(coord as [number, number])),
  )
  const viewBox = turf.bboxPolygon(VIEW_BBOX)
  const sea = turf.difference(turf.featureCollection([viewBox, landView]))
  const seaRings: [number, number][][] = []
  if (sea) {
    for (const ring of ringsFromGeometry(sea.geometry as Polygon | MultiPolygon)) {
      if (ring.length >= 4) seaRings.push(ring.map((coord) => roundCoord(coord as [number, number])))
    }
  }

  const backdrop = buildBackdrop(
    countriesRaw as FeatureCollection<Polygon | MultiPolygon>,
    playableUnion,
    VIEW_BBOX,
  )
  const rivers = extractRivers(riversRaw)

  const payload = {
    source:
      `Natural Earth 1:50m land, admin-0/1, rivers (public domain); ${meshKind} provinces in hull∩land`,
    bbox: BBOX,
    viewBbox: VIEW_BBOX,
    landPolygons: landRings,
    seaPolygons: seaRings,
    polygons,
    centroids,
    neighbors,
    backdrop,
    rivers,
    validation,
  }

  const out = join(ROOT, "lib/data/theater-geometry.json")
  writeFileSync(out, `${JSON.stringify(payload)}\n`)
  console.log(`Wrote ${out} (${meshKind})`)
  console.log(`provinces ${Object.keys(polygons).length}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
