/**
 * Theater geometry from Natural Earth 10m admin-1 + historical-basemaps 1914 borders.
 * Run: npx tsx scripts/fetch-theater-sources.ts && npx tsx scripts/build-vector-theater.ts
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import * as turf from "@turf/turf"
import type { Feature, FeatureCollection, LineString, MultiPolygon, Polygon } from "geojson"
import polygonClipping from "polygon-clipping"
import { PROVINCE_DEFS } from "../lib/data/definitions"
import { RAIL_PAIRS } from "../lib/data/rails"
import { applyWestGaliciaProvinces } from "./galicia-west-provinces"
import {
  buildVectorProvinceMesh,
  clipToRings,
  snapMeshVertices,
  snapRing,
  toClip,
  type ProvinceRings,
} from "./vector-province-mesh"
import {
  loadNations1914,
  PLAYABLE_EMPIRES,
  splitAdminBy1914,
  type AdminPiece,
} from "./theater/nations-1914"
import { simplifyProvinceRings } from "./vector-province-mesh"
import { readPolygonsByField, runMapshaperPipeline } from "./theater/mapshaper-tools"
import { neighborsFromPolygons } from "../lib/data/geometry"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const CACHE = join(ROOT, "scripts/cache")
const WORK = join(CACHE, "vector-theater-build")

const BBOX: [number, number, number, number] = [15.8, 48.35, 28.8, 56.35]
const VIEW_BBOX: [number, number, number, number] = [9.0, 46.75, 32.0, 57.35]

type BackdropRegion = { id: string; name: string; polygon: [number, number][] }
type RiverLine = { id: string; name: string; coordinates: [number, number][] }

function roundCoord([lon, lat]: [number, number]): [number, number] {
  return [Math.round(lon * 10000) / 10000, Math.round(lat * 10000) / 10000]
}

function loadJson(path: string): FeatureCollection {
  return JSON.parse(readFileSync(path, "utf8")) as FeatureCollection
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
  return pieces.length === 1
    ? pieces[0]
    : turf.union(turf.featureCollection(pieces))!
}

function buildTheaterHull() {
  const hull = turf.convex(
    turf.featureCollection(PROVINCE_DEFS.map((def) => turf.point([def.lon, def.lat]))),
  )
  if (!hull) throw new Error("convex hull failed")
  const buffered = turf.buffer(hull, 80, { units: "kilometers" })
  const box = turf.bboxPolygon(BBOX)
  const clipped = turf.intersect(turf.featureCollection([buffered!, box]))
  return clipped ?? buffered!
}

function ringsFromGeometry(geometry: Polygon | MultiPolygon): [number, number][][] {
  if (geometry.type === "Polygon") return [geometry.coordinates[0] as [number, number][]]
  return geometry.coordinates.map((p) => p[0] as [number, number][])
}

function geometryToRings(geometry: Polygon | MultiPolygon): ProvinceRings {
  if (geometry.type === "Polygon") {
    return [snapRing(geometry.coordinates[0] as [number, number][])]
  }
  let best = geometry.coordinates[0]
  let bestA = turf.area(turf.polygon(best))
  for (const poly of geometry.coordinates) {
    const a = turf.area(turf.polygon(poly))
    if (a > bestA) {
      bestA = a
      best = poly
    }
  }
  return [snapRing(best[0] as [number, number][])]
}

function loadAdminUnits(
  fc: FeatureCollection,
  hull: Feature<Polygon | MultiPolygon>,
  land: Feature<Polygon | MultiPolygon>,
): Feature<Polygon | MultiPolygon>[] {
  const theater = turf.intersect(turf.featureCollection([hull, land])) ?? land
  const units: Feature<Polygon | MultiPolygon>[] = []
  for (const feature of fc.features) {
    if (!feature.geometry || (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon")) {
      continue
    }
    const fb = turf.bbox(feature as Feature<Polygon | MultiPolygon>)
    if (fb[2] < BBOX[0] - 2 || fb[0] > BBOX[2] + 4 || fb[3] < BBOX[1] - 2 || fb[1] > BBOX[3] + 1) {
      continue
    }
    const clipped = turf.intersect(
      turf.featureCollection([feature as Feature<Polygon | MultiPolygon>, theater]),
    )
    if (!clipped || turf.area(clipped) < 1_500_000) continue
    units.push({
      type: "Feature",
      properties: {
        admin: feature.properties?.admin,
        name: feature.properties?.name,
        geonunit: feature.properties?.geonunit,
      },
      geometry: clipped.geometry as Polygon | MultiPolygon,
    })
  }
  return units
}

function extractRiverLines(rivers: FeatureCollection, bbox: [number, number, number, number]) {
  const wanted =
    /vistula|wisła|weichsel|niemen|nemunas|narew|bug|san|dnieper|dnister|dniester|pilica|wieprz|memel|daugava|pregel/i
  const lines: Feature<LineString>[] = []
  for (const feature of rivers.features) {
    const name = String(feature.properties?.name ?? "")
    if (!wanted.test(name)) continue
    if (feature.geometry.type !== "LineString" && feature.geometry.type !== "MultiLineString") continue
    const coords =
      feature.geometry.type === "LineString"
        ? feature.geometry.coordinates
        : feature.geometry.coordinates.flat()
    const line = turf.lineString(coords as [number, number][], { name })
    const clipped = turf.bboxClip(line, bbox)
    if (turf.length(clipped, { units: "kilometers" }) < 12) continue
    lines.push(clipped as Feature<LineString>)
  }
  return lines
}

function extractRiversDisplay(rivers: FeatureCollection): RiverLine[] {
  const wanted = /vistula|niemen|nemunas|narew|bug|san|memel|daugava|pregel|dnieper|dnister/i
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

function toClipRings(rings: ProvinceRings): polygonClipping.Polygon | null {
  if (!rings[0]?.length) return null
  return rings.map((ring) => ring.map((c) => [c[0], c[1]] as polygonClipping.Pair)) as polygonClipping.Polygon
}

function clipResultToRings(
  geom: polygonClipping.Polygon | polygonClipping.MultiPolygon | null,
): ProvinceRings {
  if (!geom) return []
  const polys: polygonClipping.Polygon[] = Array.isArray(geom[0]?.[0]?.[0])
    ? (geom as polygonClipping.MultiPolygon)
    : [geom as polygonClipping.Polygon]
  const rings: ProvinceRings = []
  for (const poly of polys) {
    for (const ring of poly) {
      if (ring.length >= 4) rings.push(snapRing(ring.map((c) => [c[0], c[1]] as [number, number])))
    }
  }
  return rings
}

function removeProvinceOverlaps(polygons: Record<string, ProvinceRings>) {
  const ids = PROVINCE_DEFS.map((def) => def.id)
  const areaOf = (id: string) => {
    const rings = polygons[id]
    return rings?.[0]?.length ? turf.area(turf.polygon(rings)) : 0
  }
  const sorted = [...ids].sort((a, b) => areaOf(a) - areaOf(b))
  for (const smallId of sorted) {
    const small = toClipRings(polygons[smallId])
    if (!small) continue
    for (const largeId of sorted) {
      if (largeId === smallId) continue
      if (areaOf(largeId) <= areaOf(smallId)) continue
      const largeRings = polygons[largeId]
      if (!largeRings?.[0]?.length) continue
      const overlap = turf.intersect(
        turf.featureCollection([turf.polygon(largeRings), turf.polygon(polygons[smallId])]),
      )
      if (!overlap || turf.area(overlap) < 1) continue
      const large = toClipRings(largeRings)
      if (!large) continue
      const diff = polygonClipping.difference(large, small)
      polygons[largeId] = clipResultToRings(diff)
    }
  }
}

function validateMesh(
  polygons: Record<string, ProvinceRings>,
  centroids: Record<string, [number, number]>,
  land: Feature<Polygon | MultiPolygon>,
  hull: Feature<Polygon | MultiPolygon>,
) {
  const theaterLand = turf.intersect(turf.featureCollection([hull, land]))
  const theaterLandAreaKm2 = theaterLand ? turf.area(theaterLand) / 1e6 : 0
  let minProvinceAreaKm2 = Number.POSITIVE_INFINITY
  for (const def of PROVINCE_DEFS) {
    const rings = polygons[def.id]
    if (!rings?.[0]?.length) continue
    const areaKm2 = turf.area(turf.polygon(rings)) / 1e6
    minProvinceAreaKm2 = Math.min(minProvinceAreaKm2, areaKm2)
  }
  const playableFeatures = PROVINCE_DEFS.map((d) => polygons[d.id]).filter((r) => r?.[0]?.length >= 4).map((r) => turf.polygon(r!))
  const playableUnion =
    playableFeatures.length === 1
      ? playableFeatures[0]
      : turf.union(turf.featureCollection(playableFeatures))!
  const playableAreaKm2 = playableUnion ? turf.area(playableUnion) / 1e6 : 0
  for (const def of PROVINCE_DEFS) {
    const centroid = turf.point(centroids[def.id])
    if (!turf.booleanPointInPolygon(centroid, land)) {
      throw new Error(`centroid for ${def.id} is not on Natural Earth land`)
    }
  }
  const coverage = playableAreaKm2 / theaterLandAreaKm2
  if (coverage < 0.82 || coverage > 1.15) {
    throw new Error(
      `playable area coverage ${(coverage * 100).toFixed(1)}% outside 82–115% of theater land`,
    )
  }
  if (minProvinceAreaKm2 < 2_000) {
    throw new Error(`province area too small: ${minProvinceAreaKm2.toFixed(0)} km²`)
  }
  return {
    theaterLandAreaKm2: Math.round(theaterLandAreaKm2),
    playableAreaKm2: Math.round(playableAreaKm2),
    minProvinceAreaKm2: Math.round(minProvinceAreaKm2),
  }
}

function buildBackdrop(
  nations: ReturnType<typeof loadNations1914>,
  playableUnion: Feature<Polygon | MultiPolygon>,
  viewBbox: [number, number, number, number],
): BackdropRegion[] {
  const view = turf.bboxPolygon(viewBbox)
  const pad = turf.buffer(playableUnion, 2, { units: "kilometers" }) ?? playableUnion
  const regions: BackdropRegion[] = []
  const seen = new Set<string>()

  for (const nation of nations) {
    if (PLAYABLE_EMPIRES.has(nation.label)) continue
    const clipped = turf.intersect(turf.featureCollection([nation.feature, view]))
    if (!clipped) continue
    const diff = turf.difference(turf.featureCollection([clipped, pad]))
    if (!diff) continue
    const polys =
      diff.geometry.type === "Polygon"
        ? [diff.geometry.coordinates[0]]
        : diff.geometry.coordinates.map((p) => p[0])
    polys.forEach((ring, index) => {
      if (ring.length < 4) return
      if (turf.area(turf.polygon([ring])) < 400_000) return
      const key = `${nation.label}-${index}`
      if (seen.has(key)) return
      seen.add(key)
      regions.push({
        id: key.toLowerCase().replace(/\s+/g, "-"),
        name: nation.label,
        polygon: snapRing(ring.map((c) => [c[0], c[1]] as [number, number])),
      })
    })
  }
  return regions
}

async function main() {
  const required = [
    "ne_10m_admin_1_states_provinces.geojson",
    "ne_10m_land.geojson",
    "ne_10m_rivers_lake_centerlines.geojson",
    "historical-basemaps_world_1914.geojson",
  ]
  for (const file of required) {
    if (!existsSync(join(CACHE, file))) {
      throw new Error(`missing ${file} — run: npx tsx scripts/fetch-theater-sources.ts`)
    }
  }
  mkdirSync(WORK, { recursive: true })

  const adminFc = loadJson(join(CACHE, "ne_10m_admin_1_states_provinces.geojson"))
  const landFc = loadJson(join(CACHE, "ne_10m_land.geojson")) as FeatureCollection<Polygon | MultiPolygon>
  const riversFc = loadJson(join(CACHE, "ne_10m_rivers_lake_centerlines.geojson"))
  const world1914 = loadJson(join(CACHE, "historical-basemaps_world_1914.geojson"))

  const landTheater = buildLandMask(landFc, BBOX) as Feature<Polygon | MultiPolygon>
  const landView = buildLandMask(landFc, VIEW_BBOX) as Feature<Polygon | MultiPolygon>
  const hull = buildTheaterHull()
  const nations = loadNations1914(world1914, VIEW_BBOX)
  console.log(`1914 nations in view: ${nations.map((n) => n.label).join(", ")}`)

  const adminUnits = loadAdminUnits(adminFc, hull, landTheater)
  console.log(`NE admin-1 units in theater: ${adminUnits.length}`)

  const riverLines = extractRiverLines(riversFc, BBOX)
  const theaterZone = turf.intersect(turf.featureCollection([hull, landTheater])) ?? landTheater

  const meshUnits: Feature<Polygon | MultiPolygon>[] = []
  for (const unit of adminUnits) {
    const pieces = splitAdminBy1914(unit, nations)
    for (const piece of pieces) {
      if (!PLAYABLE_EMPIRES.has(piece.nationLabel)) continue
      meshUnits.push(
        turf.feature(piece.geometry, {
          name: `${piece.admin} ${piece.name}`,
          admin: piece.admin,
          unitName: piece.name,
          nation1914: piece.nationLabel,
        }),
      )
    }
  }
  console.log(`playable admin pieces (1914-split): ${meshUnits.length}`)

  let polygons = buildVectorProvinceMesh(meshUnits, theaterZone, riverLines)
  snapMeshVertices(polygons, 4)
  polygons = simplifyProvinceRings(polygons, 1.8)
  snapMeshVertices(polygons, 4)
  applyWestGaliciaProvinces(polygons, meshUnits, theaterZone)
  snapMeshVertices(polygons, 4)

  for (const def of PROVINCE_DEFS) {
    const rings = polygons[def.id]
    if (!rings?.[0]?.length) continue
    const clipped = turf.intersect(turf.featureCollection([turf.polygon(rings), landTheater]))
    if (clipped) polygons[def.id] = clipToRings(toClip(clipped as Feature<Polygon | MultiPolygon>))
  }

  removeProvinceOverlaps(polygons)
  snapMeshVertices(polygons, 4)

  const piecesPath = join(WORK, "playable-pieces.geojson")
  const dissolvedPath = join(WORK, "playable-dissolved.geojson")
  const exportFc: FeatureCollection = {
    type: "FeatureCollection",
    features: PROVINCE_DEFS
      .filter((d) => polygons[d.id]?.[0]?.length)
      .map((d) => turf.feature(turf.polygon(polygons[d.id]).geometry, { gameId: d.id })),
  }
  writeFileSync(piecesPath, JSON.stringify(exportFc))
  runMapshaperPipeline(ROOT, piecesPath, dissolvedPath, "gameId", "0.28%")
  const simplified = readPolygonsByField(dissolvedPath, "gameId")
  for (const def of PROVINCE_DEFS) {
    const geom = simplified[def.id]
    if (geom) polygons[def.id] = geometryToRings(geom)
  }
  snapMeshVertices(polygons, 4)
  removeProvinceOverlaps(polygons)

  const missing = PROVINCE_DEFS.filter((d) => !polygons[d.id]?.[0]?.length).map((d) => d.id)
  if (missing.length) throw new Error(`missing provinces after vector build: ${missing.join(", ")}`)

  const centroids: Record<string, [number, number]> = {}
  for (const def of PROVINCE_DEFS) {
    const rings = polygons[def.id]
    const c = turf.pointOnFeature(turf.polygon(rings))
    centroids[def.id] = roundCoord(c.geometry.coordinates as [number, number])
  }

  let neighbors = neighborsFromPolygons(polygons)
  for (const [a, b] of RAIL_PAIRS) {
    if (!neighbors[a].includes(b)) {
      neighbors[a].push(b)
      neighbors[b].push(a)
    }
  }
  for (const id of Object.keys(neighbors)) neighbors[id].sort()

  const validation = validateMesh(polygons, centroids, landTheater, hull)
  const playableFeatures = PROVINCE_DEFS.map((d) => turf.polygon(polygons[d.id], { id: d.id }))
  const playableUnion =
    playableFeatures.length === 1
      ? playableFeatures[0]
      : turf.union(turf.featureCollection(playableFeatures))!

  const landRings = ringsFromGeometry(landView.geometry).map((ring) => snapRing(ring))
  const viewBox = turf.bboxPolygon(VIEW_BBOX)
  const sea = turf.difference(turf.featureCollection([viewBox, landView]))
  const seaPolygons: [number, number][][] = []
  if (sea) {
    for (const ring of ringsFromGeometry(sea.geometry as Polygon | MultiPolygon)) {
      if (ring.length >= 4) seaPolygons.push(snapRing(ring))
    }
  }

  const backdrop = buildBackdrop(nations, playableUnion as Feature<Polygon | MultiPolygon>, VIEW_BBOX)
  const rivers = extractRiversDisplay(riversFc)

  const payload = {
    source:
      "Playable provinces: Natural Earth 10m admin-1 clipped to 1914 borders (aourednik/historical-basemaps, CC-BY-SA) and merged to Ostfront game ids; grey backdrop: remaining 1914 nations; coast/sea/rivers: Natural Earth 10m (public domain). worldos.cc WWI map used as visual reference only.",
    bbox: BBOX,
    viewBbox: VIEW_BBOX,
    landPolygons: landRings,
    seaPolygons,
    polygons,
    centroids,
    neighbors,
    backdrop,
    rivers,
    validation,
  }

  writeFileSync(join(ROOT, "lib/data/theater-geometry.json"), `${JSON.stringify(payload)}\n`)
  console.log(`Wrote theater-geometry.json — ${PROVINCE_DEFS.length} provinces`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
