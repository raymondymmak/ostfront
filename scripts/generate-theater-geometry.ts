/**
 * Theater geometry: land-masked raster provinces (coastline-respecting), NE backdrop & rivers.
 * Run: npx tsx scripts/generate-theater-geometry.ts
 */
import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import * as turf from "@turf/turf"
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson"
import { PROVINCE_DEFS } from "../lib/data/definitions"
import { RAIL_PAIRS } from "../lib/data/rails"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const COS = Math.cos((52 * Math.PI) / 180)
const BBOX: [number, number, number, number] = [15.8, 48.35, 28.8, 56.35]
const GRID_COLS = 400
const GRID_ROWS = 320

const NE_LAND =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson"
const NE_COUNTRIES =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson"
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

function clipToBbox(feature: Feature<Polygon | MultiPolygon>) {
  const box = turf.bboxPolygon(BBOX)
  const clipped = turf.intersect(turf.featureCollection([feature, box]))
  return clipped ?? null
}

function hashNoise(x: number, y: number, seed: number): number {
  let h = (x * 374761 + y * 668265 + seed * 982451) >>> 0
  h = ((h >> 16) ^ h) * 0x45d9f3b
  h = ((h >> 16) ^ h) * 0x45d9f3b
  h = (h >> 16) ^ h
  return (h & 0xffff) / 0xffff - 0.5
}

function cellCenter(col: number, row: number): [number, number] {
  const [minLon, minLat, maxLon, maxLat] = BBOX
  const lon = minLon + ((col + 0.5) / GRID_COLS) * (maxLon - minLon)
  const lat = maxLat - ((row + 0.5) / GRID_ROWS) * (maxLat - minLat)
  return [lon, lat]
}

function lonLatToCell(lon: number, lat: number): [number, number] | null {
  const [minLon, minLat, maxLon, maxLat] = BBOX
  const col = Math.floor(((lon - minLon) / (maxLon - minLon)) * GRID_COLS)
  const row = Math.floor(((maxLat - lat) / (maxLat - minLat)) * GRID_ROWS)
  if (col < 0 || row < 0 || col >= GRID_COLS || row >= GRID_ROWS) return null
  return [col, row]
}

function buildLandMask(land: FeatureCollection<Polygon | MultiPolygon>) {
  const box = turf.bboxPolygon(BBOX)
  const pieces: Feature<Polygon | MultiPolygon>[] = []
  for (const feature of land.features) {
    const clipped = turf.intersect(turf.featureCollection([feature as Feature<Polygon | MultiPolygon>, box]))
    if (clipped) pieces.push(clipped as Feature<Polygon | MultiPolygon>)
  }
  const union =
    pieces.length === 1 ? pieces[0] : turf.union(turf.featureCollection(pieces))
  if (!union) throw new Error("land union failed")
  return union
}

function buildAssignmentLand(land: Feature<Polygon | MultiPolygon>) {
  const byId = Object.fromEntries(PROVINCE_DEFS.map((def) => [def.id, def]))
  let expanded: Feature<Polygon | MultiPolygon> = land
  for (const [fromId, toId] of RAIL_PAIRS) {
    const from = byId[fromId]
    const to = byId[toId]
    if (!from || !to) continue
    const line = turf.lineString([[from.lon, from.lat], [to.lon, to.lat]])
    const bridge = turf.buffer(line, 11, { units: "kilometers" })
    if (!bridge) continue
    const merged = turf.union(turf.featureCollection([expanded, bridge]))
    if (merged) expanded = merged as Feature<Polygon | MultiPolygon>
  }
  const clipped = turf.intersect(turf.featureCollection([expanded, turf.bboxPolygon(BBOX)]))
  return clipped ?? expanded
}

/** Union of province catchments on land — avoids a convex hull chord across the Baltic. */
function buildPlayableZone(land: Feature<Polygon | MultiPolygon>) {
  const box = turf.bboxPolygon(BBOX)
  let zone: Feature<Polygon | MultiPolygon> | null = null
  for (const def of PROVINCE_DEFS) {
    const reach =
      def.id === "memel" || def.id === "konigsberg" || def.id === "danzig" || def.id === "tilsit"
        ? 95
        : 118
    const bubble = turf.buffer(turf.point([def.lon, def.lat]), reach, { units: "kilometers" })
    if (!bubble) continue
    if (!zone) zone = bubble as Feature<Polygon | MultiPolygon>
    else {
      const merged = turf.union(turf.featureCollection([zone, bubble]))
      if (merged) zone = merged as Feature<Polygon | MultiPolygon>
    }
  }
  if (!zone) throw new Error("playable zone union failed")
  const clipped = turf.intersect(turf.featureCollection([land, zone, box]))
  return clipped ?? zone
}

function buildRiverMask(rivers: FeatureCollection, land: Feature<Polygon | MultiPolygon>) {
  const mask = new Uint8Array(GRID_COLS * GRID_ROWS)
  const wanted = /vistula|niemen|nemunas|narew|bug|san|memel|daugava|pregel|passage/i
  for (const feature of rivers.features) {
    const name = String(feature.properties?.name ?? "")
    if (!wanted.test(name)) continue
    if (feature.geometry.type !== "LineString" && feature.geometry.type !== "MultiLineString") continue
    const coords =
      feature.geometry.type === "LineString"
        ? feature.geometry.coordinates
        : feature.geometry.coordinates.flat()
    const line = turf.buffer(turf.lineString(coords as [number, number][]), 3.5, {
      units: "kilometers",
    })
    if (!line) continue
    const clipped = turf.intersect(turf.featureCollection([line, land]))
    if (!clipped) continue
    const points = turf.pointGrid(BBOX, 8, { units: "kilometers", mask: clipped })
    for (const point of points.features) {
      const cell = lonLatToCell(point.geometry.coordinates[0], point.geometry.coordinates[1])
      if (!cell) continue
      mask[cell[1] * GRID_COLS + cell[0]] = 1
    }
  }
  return mask
}

function assignProvinces(
  assignmentLand: Feature<Polygon | MultiPolygon>,
  zone: Feature<Polygon | MultiPolygon>,
  riverMask: Uint8Array,
) {
  const ids = PROVINCE_DEFS.map((def) => def.id)
  const grid = new Int16Array(GRID_COLS * GRID_ROWS).fill(-1)

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const [lon, lat] = cellCenter(col, row)
      const point = turf.point([lon, lat])
      if (!turf.booleanPointInPolygon(point, assignmentLand)) continue
      if (!turf.booleanPointInPolygon(point, zone)) continue

      let best = -1
      let bestScore = Number.POSITIVE_INFINITY
      for (let provinceIndex = 0; provinceIndex < PROVINCE_DEFS.length; provinceIndex++) {
        const def = PROVINCE_DEFS[provinceIndex]
        const warp =
          0.14 * hashNoise(col, row, provinceIndex) +
          0.08 * hashNoise(col * 2, row * 3, provinceIndex + 11)
        const riverPenalty = riverMask[row * GRID_COLS + col] ? 0.22 : 0
        const score =
          Math.hypot((lon - def.lon) * COS, lat - def.lat) + warp + riverPenalty
        if (score < bestScore) {
          bestScore = score
          best = provinceIndex
        }
      }
      grid[row * GRID_COLS + col] = best
    }
  }

  return { grid, ids }
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

function unionAll(features: Feature<Polygon>[]) {
  if (!features.length) return null
  if (features.length === 1) return features[0]
  let queue = features
  while (queue.length > 1) {
    const next: Feature<Polygon>[] = []
    for (let i = 0; i < queue.length; i += 2) {
      if (i + 1 >= queue.length) {
        next.push(queue[i])
        continue
      }
      const merged = turf.union(turf.featureCollection([queue[i], queue[i + 1]]))
      if (merged) next.push(merged as Feature<Polygon>)
      else next.push(queue[i], queue[i + 1])
    }
    if (next.length === queue.length) {
      const fallback = turf.union(turf.featureCollection(queue))
      return (fallback ?? queue[0]) as Feature<Polygon | MultiPolygon>
    }
    queue = next
  }
  return queue[0]
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
    const cleaned = ring.map(roundCoord)
    polygons[ids[provinceIndex]] = cleaned
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
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
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
  land: Feature<Polygon | MultiPolygon>,
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
  }
  const regions: BackdropRegion[] = []
  const playable = turf.buffer(playableUnion, 2, { units: "kilometers" }) ?? playableUnion

  for (const feature of countries.features) {
    const name = feature.properties?.NAME as string | undefined
    if (!name || !labels[name]) continue
    const clipped = clipToBbox(feature as Feature<Polygon | MultiPolygon>)
    if (!clipped) continue
    const onLand = turf.intersect(turf.featureCollection([clipped, land]))
    if (!onLand) continue
    const diff = turf.difference(turf.featureCollection([onLand, playable]))
    if (!diff) continue
    const label = labels[name] ?? name
    const polys =
      diff.geometry.type === "Polygon"
        ? [diff.geometry.coordinates[0]]
        : diff.geometry.coordinates.map((p) => p[0])
    polys.forEach((ring, index) => {
      if (ring.length < 4) return
      if (turf.area(turf.polygon([ring])) < 2_000_000) return
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

async function main() {
  const [landRaw, countriesRaw, riversRaw] = await Promise.all([
    fetchJson(NE_LAND),
    fetchJson(NE_COUNTRIES),
    fetchJson(NE_RIVERS),
  ])

  const land = buildLandMask(landRaw as FeatureCollection<Polygon | MultiPolygon>)
  const zone = buildPlayableZone(land)
  const riverMask = buildRiverMask(riversRaw, land)
  const { grid, ids } = assignProvinces(land, zone, riverMask)
  let polygons = polygonsFromGrid(grid, ids)

  for (const def of PROVINCE_DEFS) {
    const ring = polygons[def.id]
    if (!ring?.length) continue
    const clipped = turf.intersect(turf.featureCollection([turf.polygon([ring]), land]))
    if (!clipped) continue
    const outer = outerRing(clipped as Feature<Polygon | MultiPolygon>)
    if (outer.length >= 4) polygons[def.id] = outer.map(roundCoord)
  }

  for (const def of PROVINCE_DEFS) {
    if (polygons[def.id]?.length >= 4) continue
    const cell = lonLatToCell(def.lon, def.lat)
    if (!cell) continue
    const point = turf.point([def.lon, def.lat])
    const patch = turf.buffer(point, 22, { units: "kilometers" })
    const clipped = patch ? turf.intersect(turf.featureCollection([patch, land, zone])) : null
    if (!clipped) continue
    const ring =
      clipped.geometry.type === "Polygon"
        ? clipped.geometry.coordinates[0]
        : clipped.geometry.coordinates[0][0]
    polygons[def.id] = ring.map((coord) => roundCoord(coord as [number, number]))
  }

  const centroids: Record<string, [number, number]> = {}
  for (const def of PROVINCE_DEFS) {
    const ring = polygons[def.id]
    if (ring?.length >= 4) {
      const c = turf.centroid(turf.polygon([ring]))
      centroids[def.id] = roundCoord(c.geometry.coordinates as [number, number])
    } else {
      centroids[def.id] = roundCoord([def.lon, def.lat])
    }
  }

  const neighbors = neighborsFromGrid(grid, ids)
  const playableFeatures = Object.entries(polygons)
    .filter(([, ring]) => ring.length >= 4)
    .map(([id, ring]) => turf.polygon([ring], { id }))
  const playableUnion =
    playableFeatures.length === 1
      ? playableFeatures[0]
      : turf.union(turf.featureCollection(playableFeatures))
  if (!playableUnion) throw new Error("playable union failed")

  const backdrop = buildBackdrop(
    countriesRaw as FeatureCollection<Polygon | MultiPolygon>,
    playableUnion,
    land,
  )
  const rivers = extractRivers(riversRaw)

  const payload = {
    source:
      "Natural Earth 1:50m land, Admin 0/1, rivers (public domain); provinces from land-masked multi-source grid with river barriers and admin-1 refinement",
    bbox: BBOX,
    polygons,
    centroids,
    neighbors,
    backdrop,
    rivers,
  }

  writeFileSync(join(ROOT, "lib/data/theater-geometry.json"), `${JSON.stringify(payload)}\n`)
  console.log(`Wrote theater-geometry.json — provinces ${Object.keys(polygons).length}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
