/**
 * HOI4 theater geometry: raster IDs → polygonize → mapshaper → TPS/affine georef.
 * Run: npx tsx scripts/build-hoi4-theater.ts
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs"
import polygonClipping from "polygon-clipping"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import * as turf from "@turf/turf"
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson"
import { PROVINCE_DEFS } from "../lib/data/definitions"
import { RAIL_PAIRS } from "../lib/data/rails"
import { snapMeshVertices, snapRing, type ProvinceRings } from "./vector-province-mesh"
import { neighborsFromPolygons } from "../lib/data/geometry"
import { loadBmp24, pixelRgb } from "./hoi4/load-bmp"
import { loadHoi4Definitions, rgbKey } from "./hoi4/definition"
import { applyAffine, fitAffine } from "./hoi4/georef"
import { HOI4_MAP_SOURCE } from "./fetch-hoi4-map"
import { HOI4_FIT_ANCHORS, HOI4_GAME_ANCHORS } from "./hoi4/anchors"
import { loadKrProvinceStates } from "./hoi4/state-pools"
import { balanceAssignHoi4ToGame } from "./hoi4/balance-assign"
import { buildHoi4Adjacency } from "./hoi4/adjacency"
import { modeFilter3x3 } from "./hoi4/mode-filter"
import {
  GAME_INDEX,
  INDEX_TO_GAME,
  SEA_GID,
  isNationGid,
  isPlayableGid,
} from "./hoi4/id-codes"
import { loadNationTable, nationAtPoint } from "./hoi4/nation-assign"
import { polygonizeGtiff, readGeoJson, runMapshaper, writeUInt16Gtiff } from "./hoi4/gdal-tools"
import { buildGeorefGcps, buildWarpGcps } from "./hoi4/gcp-build"
import { buildHullClampedGeoref } from "./hoi4/polynomial-georef"

const MAX_GEOREF_RESIDUAL_KM = 15

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const CACHE = join(ROOT, "scripts/cache")
const HOI4 = join(CACHE, "hoi4")
const WORK = join(CACHE, "hoi4-build")
const BBOX: [number, number, number, number] = [15.8, 48.35, 28.8, 56.35]
const VIEW_BBOX: [number, number, number, number] = [9.0, 46.75, 32.0, 57.35]
/** Clip playable outlines (avoid VIEW_BBOX east/north chords that create spikes). */
const PLAYABLE_CLIP_BBOX: [number, number, number, number] = [
  BBOX[0],
  VIEW_BBOX[1],
  BBOX[2],
  BBOX[3],
]
const NE_RIVERS =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_rivers_lake_centerlines.geojson"

type BackdropRegion = { id: string; name: string; polygon: [number, number][] }
type RiverLine = { id: string; name: string; coordinates: [number, number][] }

function roundCoord([lon, lat]: [number, number]): [number, number] {
  return [Math.round(lon * 10000) / 10000, Math.round(lat * 10000) / 10000]
}

function featureFromRings(rings: ProvinceRings): Feature<Polygon | MultiPolygon> | null {
  const parts = rings.filter((r) => r.length >= 4).map((r) => turf.polygon([r]))
  if (!parts.length) return null
  if (parts.length === 1) return parts[0]
  return turf.union(turf.featureCollection(parts)) ?? parts[0]
}

function areaKm2FromRings(rings: ProvinceRings): number {
  const f = featureFromRings(rings)
  return f ? turf.area(f) / 1e6 : 0
}

async function fetchJson(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)
  return (await response.json()) as FeatureCollection
}

function computeCentroids(
  img: ReturnType<typeof loadBmp24>,
  rgbToId: Map<number, number>,
): Map<number, { x: number; y: number; count: number }> {
  const sums = new Map<number, { sx: number; sy: number; n: number }>()
  const { width, height, rows, rowBytes } = img
  for (let y = 0; y < height; y++) {
    const row = height - 1 - y
    const base = row * rowBytes
    for (let x = 0; x < width; x++) {
      const i = base + x * 3
      const pid = rgbToId.get(rgbKey([rows[i + 2], rows[i + 1], rows[i]]))
      if (!pid) continue
      let s = sums.get(pid)
      if (!s) {
        s = { sx: 0, sy: 0, n: 0 }
        sums.set(pid, s)
      }
      s.sx += x
      s.sy += y
      s.n++
    }
  }
  const out = new Map<number, { x: number; y: number; count: number }>()
  for (const [pid, s] of sums) out.set(pid, { x: s.sx / s.n, y: s.sy / s.n, count: s.n })
  return out
}

function inTheaterGeo(lon: number, lat: number, pad = 1.35) {
  return (
    lon >= BBOX[0] - pad &&
    lon <= BBOX[2] + pad &&
    lat >= BBOX[1] - pad &&
    lat <= BBOX[3] + pad
  )
}

function collectTheaterLand(
  centroids: Map<number, { x: number; y: number }>,
  byId: Map<number, { isSea: boolean; isLake: boolean }>,
  aff: ReturnType<typeof fitAffine>,
): Set<number> {
  const theaterLand = new Set<number>()
  for (const [pid] of centroids) {
    const meta = byId.get(pid)
    if (!meta || meta.isSea || meta.isLake) continue
    const c = centroids.get(pid)!
    const [lon, lat] = applyAffine(aff, c.x, c.y)
    if (inTheaterGeo(lon, lat)) theaterLand.add(pid)
  }
  return theaterLand
}

function buildHoi4GidMap(
  byId: Map<number, { isSea: boolean; isLake: boolean }>,
  centroids: Map<number, { x: number; y: number; count: number }>,
  aff: ReturnType<typeof fitAffine>,
  hoi4ToGame: Map<number, string>,
  nationTable: ReturnType<typeof loadNationTable>,
): Map<number, number> {
  const out = new Map<number, number>()
  for (const [pid, c] of centroids) {
    const meta = byId.get(pid)
    if (!meta) continue
    if (meta.isSea || meta.isLake) {
      out.set(pid, SEA_GID)
      continue
    }
    const game = hoi4ToGame.get(pid)
    if (game) {
      out.set(pid, GAME_INDEX.get(game)!)
      continue
    }
    const [lon, lat] = applyAffine(aff, c.x, c.y)
    const nation = nationAtPoint(nationTable, lon, lat)
    if (nation) out.set(pid, nation.gid)
  }
  return out
}

function buildIdRaster(
  img: ReturnType<typeof loadBmp24>,
  rgbToId: Map<number, number>,
  byId: Map<number, { isSea: boolean; isLake: boolean }>,
  hoi4Gid: Map<number, number>,
  x0: number,
  y0: number,
  gw: number,
  gh: number,
): Uint16Array {
  const data = new Uint16Array(gw * gh)
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const px = x0 + gx
      const py = y0 + gy
      const rgb = pixelRgb(img, px, py)
      const pid = rgbToId.get(rgbKey(rgb))
      if (!pid) continue
      const gid = hoi4Gid.get(pid)
      if (gid) data[gy * gw + gx] = gid
    }
  }
  return modeFilter3x3(gw, gh, modeFilter3x3(gw, gh, data))
}

function warpFeatureCollection(fc: FeatureCollection, transform: (x: number, y: number) => [number, number]) {
  const out: FeatureCollection = { type: "FeatureCollection", features: [] }
  for (const feature of fc.features) {
    const geom = feature.geometry
    if (!geom) continue
    if (geom.type === "Polygon") {
      out.features.push({
        type: "Feature",
        properties: feature.properties,
        geometry: {
          type: "Polygon",
          coordinates: geom.coordinates.map((ring) =>
            (ring as number[][]).map((c) => transform(c[0], c[1])),
          ),
        },
      })
    } else if (geom.type === "MultiPolygon") {
      out.features.push({
        type: "Feature",
        properties: feature.properties,
        geometry: {
          type: "MultiPolygon",
          coordinates: geom.coordinates.map((poly) =>
            poly.map((ring) => (ring as number[][]).map((c) => transform(c[0], c[1]))),
          ),
        },
      })
    }
  }
  return out
}

function ringFromCoords(coords: number[][]): [number, number][] {
  return coords.map((c) => roundCoord([c[0], c[1]] as [number, number]))
}

function clipGeomToBbox(
  geom: Polygon | MultiPolygon,
  clip: ReturnType<typeof turf.bboxPolygon>,
): Polygon | MultiPolygon | null {
  const feat = turf.feature(geom)
  const clipped = turf.intersect(turf.featureCollection([clip, feat]))
  if (!clipped) return null
  return clipped.geometry as Polygon | MultiPolygon
}

function mergeClippedParts(geom: Polygon | MultiPolygon): Feature<Polygon | MultiPolygon> | null {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates
  const parts: Feature<Polygon>[] = []
  for (const poly of polys) {
    const f = turf.polygon(poly)
    if (turf.area(f) > 1) parts.push(f)
  }
  if (!parts.length) return null
  if (parts.length === 1) return parts[0]
  return turf.union(turf.featureCollection(parts)) ?? parts[0]
}

function pushSeaRings(geom: Polygon | MultiPolygon, seaRings: [number, number][][]) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates
  for (const poly of polys) {
    const outer = snapRing(ringFromCoords(poly[0] as number[][]))
    if (outer.length >= 4) seaRings.push(outer)
  }
}

function extractPolygonsFromFeatures(
  fc: FeatureCollection,
  nationNames: Map<number, string>,
) {
  const viewClip = turf.bboxPolygon(VIEW_BBOX)
  const clipInset = 0.04
  const playableClip = turf.bboxPolygon([
    PLAYABLE_CLIP_BBOX[0] + clipInset,
    PLAYABLE_CLIP_BBOX[1] + clipInset,
    PLAYABLE_CLIP_BBOX[2] - clipInset,
    PLAYABLE_CLIP_BBOX[3] - clipInset,
  ])
  const nationClip = turf.bboxPolygon([
    VIEW_BBOX[0],
    VIEW_BBOX[1],
    BBOX[2] - clipInset,
    VIEW_BBOX[3] - clipInset,
  ])
  const byGame: Record<string, Feature<Polygon | MultiPolygon>[]> = {}
  for (const def of PROVINCE_DEFS) byGame[def.id] = []

  const backdrop: BackdropRegion[] = []
  const seaRings: [number, number][][] = []
  const landRings: [number, number][][] = []

  for (const feature of fc.features) {
    const gid = Number(feature.properties?.gid ?? 0)
    if (!gid) continue
    const raw = feature.geometry
    if (!raw || (raw.type !== "Polygon" && raw.type !== "MultiPolygon")) continue

    if (gid === SEA_GID) {
      const clipped = clipGeomToBbox(raw, viewClip)
      if (!clipped) continue
      const merged = mergeClippedParts(clipped)
      if (!merged) continue
      pushSeaRings(merged.geometry, seaRings)
      continue
    }

    if (isPlayableGid(gid)) {
      const clipped = clipGeomToBbox(raw, playableClip)
      if (!clipped) continue
      const merged = mergeClippedParts(clipped)
      if (!merged) continue
      byGame[INDEX_TO_GAME.get(gid)!].push(merged)
      continue
    }

    const clipped = clipGeomToBbox(raw, nationClip)
    if (!clipped) continue
    const merged = mergeClippedParts(clipped)
    if (!merged) continue
    const geom = merged.geometry

    if (isNationGid(gid)) {
      const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates
      for (const poly of polys) {
        const outer = snapRing(ringFromCoords(poly[0] as number[][]))
        if (outer.length < 4) continue
        const name = nationNames.get(gid) ?? `nation-${gid}`
        backdrop.push({
          id: `${name.toLowerCase().replace(/\s+/g, "-")}-${backdrop.length}`,
          name,
          polygon: outer,
        })
        landRings.push(outer)
      }
    }
  }

  const polygons: Record<string, ProvinceRings> = {}
  for (const def of PROVINCE_DEFS) {
    const parts = byGame[def.id]
    if (!parts.length) {
      polygons[def.id] = []
      continue
    }
    const unioned =
      parts.length === 1 ? parts[0] : turf.union(turf.featureCollection(parts)) ?? parts[0]
    const geom = unioned.geometry
    const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates
    let best = polys[0]
    let bestA = 0
    for (const poly of polys) {
      const a = turf.area(turf.polygon(poly))
      if (a > bestA) {
        bestA = a
        best = poly
      }
    }
    const outer = snapRing(ringFromCoords(best[0]))
    polygons[def.id] = [outer]
    landRings.push(outer)
  }

  return { polygons, backdrop, seaRings, landRings }
}

function clampOversizedProvince(
  rings: ProvinceRings,
  anchor: [number, number],
  maxRadiusKm: number,
): ProvinceRings {
  const feat = featureFromRings(rings)
  if (!feat) return rings
  const bbox = turf.bbox(feat)
  const diagKm = turf.distance(turf.point([bbox[0], bbox[1]]), turf.point([bbox[2], bbox[3]]), {
    units: "kilometers",
  })
  const areaKm2 = turf.area(feat) / 1e6
  if (diagKm < 320 && areaKm2 < 18_000) return rings
  const [lon, lat] = anchor
  const dLon = maxRadiusKm / (111 * Math.cos((lat * Math.PI) / 180))
  const dLat = maxRadiusKm / 111
  const cap = turf.bboxPolygon([lon - dLon, lat - dLat, lon + dLon * 0.92, lat + dLat * 0.82])
  const outer = rings[0]
  if (!outer || outer.length < 4) return rings
  let clipRing = outer
  try {
    const cleaned = turf.buffer(turf.polygon([outer]), 0)
    if (cleaned?.geometry.type === "Polygon") {
      clipRing = cleaned.geometry.coordinates[0] as [number, number][]
    }
  } catch {
    /* use original ring */
  }
  const capRing = cap.geometry.coordinates[0] as [number, number][]
  let parts: polygonClipping.MultiPolygon = []
  try {
    parts = polygonClipping.intersection([clipRing.map((c) => [c[0], c[1]] as [number, number])], [
      capRing,
    ]) as polygonClipping.MultiPolygon
  } catch {
    return rings
  }
  if (!parts.length) return rings
  let best = parts[0][0]
  let bestA = 0
  for (const poly of parts) {
    const ring = poly[0]
    if (!ring || ring.length < 4) continue
    const a = turf.area(turf.polygon([ring as [number, number][]]))
    if (a > bestA) {
      bestA = a
      best = ring
    }
  }
  const next = [snapRing(ringFromCoords(best as number[][]))]
  if (areaKm2FromRings(next) < 2_000) return rings
  return next
}

function stripGeorefSpikes(rings: ProvinceRings, anchor: [number, number]): ProvinceRings {
  let ring = rings[0]
  if (!ring || ring.length < 5) return rings
  for (let pass = 0; pass < 4; pass++) {
    const dists = ring.map((c) => turf.distance(anchor, c, { units: "kilometers" }))
    const ranked = dists
      .map((d, i) => ({ d, i }))
      .sort((a, b) => b.d - a.d)
    const top = ranked[0]
    const next = ranked[1]
    if (!top || !next) break
    if (top.d < 265 || top.d < next.d * 1.75) break
    ring = ring.filter((_, i) => i !== top.i)
    if (ring.length < 4) return rings
  }
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) ring = [...ring, first]
  const f = turf.polygon([ring])
  try {
    const fixed = turf.buffer(f, 0)
    if (!fixed?.geometry || fixed.geometry.type !== "Polygon") return [snapRing(ring)]
    return [snapRing(ringFromCoords(fixed.geometry.coordinates[0]))]
  } catch {
    return [snapRing(ring)]
  }
}

function fixProvinceRings(rings: ProvinceRings): ProvinceRings {
  const f = featureFromRings(rings)
  if (!f) return rings
  try {
    const fixed = turf.buffer(f, 0)
    if (!fixed?.geometry) return rings
    if (fixed.geometry.type === "Polygon") {
      return [snapRing(ringFromCoords(fixed.geometry.coordinates[0]))]
    }
    let best = fixed.geometry.coordinates[0]
    let bestA = 0
    for (const poly of fixed.geometry.coordinates) {
      const a = turf.area(turf.polygon(poly))
      if (a > bestA) {
        bestA = a
        best = poly
      }
    }
    return [snapRing(ringFromCoords(best[0]))]
  } catch {
    return rings
  }
}

function extractRivers(rivers: FeatureCollection): RiverLine[] {
  const wanted = /vistula|niemen|nemunas|narew|bug|san|memel|daugava|pregel|dnieper/i
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
    if (turf.length(clipped, { units: "kilometers" }) < 20) continue
    lines.push({
      id: name.toLowerCase().replace(/\s+/g, "-"),
      name,
      coordinates: (clipped.geometry.coordinates as [number, number][]).map(roundCoord),
    })
  }
  return lines
}

function mergeLandRings(rings: [number, number][][]): [number, number][][] {
  if (!rings.length) return []
  const feats = rings.map((r) => turf.polygon([r]))
  const u = turf.union(turf.featureCollection(feats))
  if (!u) return rings
  if (u.geometry.type === "Polygon") return [snapRing(ringFromCoords(u.geometry.coordinates[0]))]
  return u.geometry.coordinates
    .map((p) => snapRing(ringFromCoords(p[0])))
    .filter((r) => r.length >= 4)
}

async function main() {
  const defPath = join(HOI4, "definition.csv")
  const bmpPath = join(HOI4, "provinces.bmp")
  if (!existsSync(defPath) || !existsSync(bmpPath)) {
    throw new Error("missing HOI4 cache — run: npx tsx scripts/fetch-hoi4-map.ts")
  }
  mkdirSync(WORK, { recursive: true })

  const { byId, rgbToId } = loadHoi4Definitions(defPath)
  const img = loadBmp24(bmpPath)
  console.log(`HOI4 map ${img.width}×${img.height} from ${HOI4_MAP_SOURCE.repoUrl}`)

  const centroids = computeCentroids(img, rgbToId)
  const fitPairs = HOI4_FIT_ANCHORS.map((a) => {
    const c = centroids.get(a.hoi4Id)!
    return { x: c.x, y: c.y, lon: a.lon, lat: a.lat }
  })
  const aff = fitAffine(fitPairs)

  const statePools = await loadKrProvinceStates(join(HOI4, "states"))
  const nationTable = loadNationTable(CACHE)
  const theaterLand = collectTheaterLand(centroids, byId, aff)

  let pxMin = Infinity
  let pxMax = -Infinity
  let pyMin = Infinity
  let pyMax = -Infinity
  for (const pid of theaterLand) {
    const c = centroids.get(pid)!
    pxMin = Math.min(pxMin, c.x)
    pxMax = Math.max(pxMax, c.x)
    pyMin = Math.min(pyMin, c.y)
    pyMax = Math.max(pyMax, c.y)
  }
  for (const anchor of HOI4_GAME_ANCHORS) {
    const c = centroids.get(anchor.hoi4Id)
    if (!c) continue
    pxMin = Math.min(pxMin, c.x)
    pxMax = Math.max(pxMax, c.x)
    pyMin = Math.min(pyMin, c.y)
    pyMax = Math.max(pyMax, c.y)
  }
  const margin = 180
  const x0 = Math.max(0, Math.floor(pxMin) - margin)
  const y0 = Math.max(0, Math.floor(pyMin) - margin)
  const x1 = Math.min(img.width - 1, Math.ceil(pxMax) + margin)
  const y1 = Math.min(img.height - 1, Math.ceil(pyMax) + margin)
  const gw = x1 - x0 + 1
  const gh = y1 - y0 + 1
  console.log(`theater crop ${gw}×${gh} px at (${x0},${y0})`)

  const adj = buildHoi4Adjacency(img, rgbToId, byId)
  const hoi4ToGame = balanceAssignHoi4ToGame(theaterLand, centroids, adj, aff, statePools)
  const hoi4Gid = buildHoi4GidMap(byId, centroids, aff, hoi4ToGame, nationTable)

  const raster = buildIdRaster(img, rgbToId, byId, hoi4Gid, x0, y0, gw, gh)

  const idsTif = join(WORK, "ids.tif")
  const rawJson = join(WORK, "raw.geojson")
  const cleanJson = join(WORK, "clean.geojson")
  const warpedJson = join(WORK, "warped.geojson")

  writeUInt16Gtiff(idsTif, gw, gh, raster, x0, y0)
  polygonizeGtiff(idsTif, rawJson)
  runMapshaper(rawJson, cleanJson, ROOT)
  const { gcps: warpGcps, labels: warpLabels } = buildWarpGcps(centroids)
  const { gcps: reportGcps, labels: reportLabels } = buildGeorefGcps(centroids, aff, theaterLand, {
    x0,
    y0,
    x1,
    y1,
  })
  if (warpGcps.length < 30) {
    throw new Error(`need at least 30 warp GCPs, got ${warpGcps.length}`)
  }
  const georef = buildHullClampedGeoref(warpGcps, warpLabels, 3, { x0, y0, x1, y1 })
  console.log(
    `hull-clamped georef (TPS + degree-${georef.degree} poly) with ${warpGcps.length} warp GCPs (${reportGcps.length} reported):`,
  )
  for (const r of georef.residualsKm.sort((a, b) => b.km - a.km).slice(0, 12)) {
    console.log(`  ${r.label}: ${r.km.toFixed(2)} km`)
  }
  console.log(`  max residual: ${georef.maxResidualKm.toFixed(2)} km`)
  if (georef.maxResidualKm > MAX_GEOREF_RESIDUAL_KM) {
    throw new Error(
      `georef max residual ${georef.maxResidualKm.toFixed(2)} km exceeds ${MAX_GEOREF_RESIDUAL_KM} km`,
    )
  }
  const warpedFinal = warpFeatureCollection(readGeoJson(cleanJson), georef.transform)
  writeFileSync(warpedJson, JSON.stringify(warpedFinal))

  const { polygons, backdrop, seaRings, landRings } = extractPolygonsFromFeatures(
    warpedFinal,
    nationTable.gidToName,
  )

  const missing = PROVINCE_DEFS.filter((d) => !polygons[d.id]?.[0]?.length).map((d) => d.id)
  if (missing.length) throw new Error(`missing province polygons: ${missing.join(", ")}`)

  for (const def of PROVINCE_DEFS) {
    polygons[def.id] = fixProvinceRings(polygons[def.id])
  }
  snapMeshVertices(polygons, 4)
  for (const def of PROVINCE_DEFS) {
    const anchor = HOI4_GAME_ANCHORS.find((a) => a.gameId === def.id)
    if (!anchor) continue
    const anchorPt: [number, number] = [anchor.lon, anchor.lat]
    polygons[def.id] = clampOversizedProvince(polygons[def.id], anchorPt, 128)
    polygons[def.id] = stripGeorefSpikes(polygons[def.id], anchorPt)
    polygons[def.id] = fixProvinceRings(polygons[def.id])
  }
  const neighbors = neighborsFromPolygons(polygons)
  for (const [a, b] of RAIL_PAIRS) {
    if (!neighbors[a].includes(b)) {
      neighbors[a].push(b)
      neighbors[b].push(a)
    }
  }
  for (const id of Object.keys(neighbors)) neighbors[id].sort()
  const gameCentroids: Record<string, [number, number]> = {}
  for (const def of PROVINCE_DEFS) {
    const f = featureFromRings(polygons[def.id])
    if (!f) continue
    const c = turf.pointOnFeature(f)
    gameCentroids[def.id] = roundCoord(c.geometry.coordinates as [number, number])
  }

  const playableFeatures = PROVINCE_DEFS.map((d) => featureFromRings(polygons[d.id])).filter(
    Boolean,
  ) as Feature<Polygon | MultiPolygon>[]
  const playableUnion =
    playableFeatures.length === 1
      ? playableFeatures[0]
      : turf.union(turf.featureCollection(playableFeatures))!

  let minProvinceAreaKm2 = Number.POSITIVE_INFINITY
  for (const def of PROVINCE_DEFS) {
    const areaKm2 = areaKm2FromRings(polygons[def.id])
    if (!areaKm2) continue
    if (areaKm2 < minProvinceAreaKm2) minProvinceAreaKm2 = areaKm2
  }
  const playableAreaKm2 = turf.area(playableUnion) / 1e6
  const theaterLandAreaKm2 = playableAreaKm2

  const MIN_PROVINCE_KM2 = 2_000
  if (minProvinceAreaKm2 < MIN_PROVINCE_KM2) {
    const tiny = PROVINCE_DEFS.filter((d) => areaKm2FromRings(polygons[d.id]) < MIN_PROVINCE_KM2).map(
      (d) => d.id,
    )
    throw new Error(`province too small: ${minProvinceAreaKm2.toFixed(0)} km² (${tiny.join(", ")})`)
  }

  const rivers = extractRivers(await fetchJson(NE_RIVERS))
  const viewClip = turf.bboxPolygon(VIEW_BBOX)
  const clipInset = 0.04
  const nationClip = turf.bboxPolygon([
    VIEW_BBOX[0],
    VIEW_BBOX[1],
    BBOX[2] - clipInset,
    VIEW_BBOX[3] - clipInset,
  ])
  const landForView: [number, number][][] = []
  const pushClippedRings = (
    clipped: Feature<Polygon | MultiPolygon> | null,
    target: [number, number][][],
  ) => {
    if (!clipped) return
    if (clipped.geometry.type === "Polygon") {
      target.push(snapRing(ringFromCoords(clipped.geometry.coordinates[0])))
    } else if (clipped.geometry.type === "MultiPolygon") {
      for (const p of clipped.geometry.coordinates) {
        target.push(snapRing(ringFromCoords(p[0])))
      }
    }
  }
  for (const ring of landRings) {
    pushClippedRings(
      turf.intersect(turf.featureCollection([nationClip, turf.polygon([ring])])) as Feature<
        Polygon | MultiPolygon
      > | null,
      landForView,
    )
  }
  for (const region of backdrop) {
    const clipped = turf.intersect(
      turf.featureCollection([nationClip, turf.polygon([region.polygon])]),
    ) as Feature<Polygon | MultiPolygon> | null
    pushClippedRings(clipped, landForView)
  }

  const seaClipped: [number, number][][] = []
  for (const ring of seaRings) {
    const clipped = turf.intersect(turf.featureCollection([viewClip, turf.polygon([ring])]))
    if (!clipped) continue
    if (clipped.geometry.type === "Polygon") {
      seaClipped.push(snapRing(ringFromCoords(clipped.geometry.coordinates[0])))
    } else if (clipped.geometry.type === "MultiPolygon") {
      for (const p of clipped.geometry.coordinates) {
        seaClipped.push(snapRing(ringFromCoords(p[0])))
      }
    }
  }

  const payload = {
    source: `Playable provinces traced from ${HOI4_MAP_SOURCE.name} (provinces.bmp); raster ID mesh → gdal_polygonize → mapshaper → TPS+hull-clamped degree-${georef.degree} poly georef (${warpGcps.length} GCPs, max residual ${georef.maxResidualKm.toFixed(1)} km); 1914 grey nations via CShapes 2.0 (June 1915) HOI4 assignment; rivers: Natural Earth. Non-commercial learning use; no Paradox files in repo.`,
    hoi4MapSource: HOI4_MAP_SOURCE.repoUrl,
    bbox: BBOX,
    viewBbox: VIEW_BBOX,
    landPolygons: landForView.map((r) => snapRing(r)),
    seaPolygons: seaClipped,
    polygons,
    centroids: gameCentroids,
    neighbors,
    backdrop,
    rivers,
    validation: {
      theaterLandAreaKm2: Math.round(theaterLandAreaKm2),
      playableAreaKm2: Math.round(playableAreaKm2),
      minProvinceAreaKm2: Math.round(minProvinceAreaKm2),
      georefMaxResidualKm: Math.round(georef.maxResidualKm * 100) / 100,
      georefGcpCount: warpGcps.length,
      georefDegree: georef.degree,
    },
  }

  writeFileSync(join(ROOT, "lib/data/theater-geometry.json"), `${JSON.stringify(payload)}\n`)
  console.log(`Wrote theater-geometry.json — ${PROVINCE_DEFS.length} provinces`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
