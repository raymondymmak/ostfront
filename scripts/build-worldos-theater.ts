/**
 * Theater geometry from WorldOS World101 theater regions (lib/data/worldos-theater-regions.geojson).
 * Run: npx tsx scripts/ingest-worldos-theater-regions.ts && npx tsx scripts/build-worldos-theater.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import * as turf from "@turf/turf"
import type { Feature, FeatureCollection, LineString, MultiPolygon, Polygon } from "geojson"
import polygonClipping from "polygon-clipping"
import { PROVINCE_DEFS } from "../lib/data/definitions"
import { RAIL_PAIRS } from "../lib/data/rails"
import { neighborsFromPolygons } from "../lib/data/geometry"
import { applyWestGaliciaProvinces } from "./galicia-west-provinces"
import {
  buildVectorProvinceMesh,
  clipToRings,
  simplifyProvinceRings,
  snapMeshVertices,
  snapRing,
  toClip,
  unionFeatures,
  type ProvinceRings,
} from "./vector-province-mesh"
import { readPolygonsByField, runMapshaperPipeline } from "./theater/mapshaper-tools"
import { PLAYABLE_EMPIRES } from "./theater/nations-1914"
import {
  applyCongressPolandSplits,
  assignRegionGameId,
  type WorldosRegion,
} from "./theater/worldos-game-assign"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const CACHE = join(ROOT, "scripts/cache")
const WORK = join(CACHE, "worldos-theater-build")
const REGIONS_PATH = join(ROOT, "lib/data/worldos-theater-regions.geojson")

const BBOX: [number, number, number, number] = [15.8, 48.35, 28.8, 56.35]
const VIEW_BBOX: [number, number, number, number] = [9.0, 46.75, 32.0, 57.35]

const SOURCE_ATTRIBUTION =
  "Region geometry from worldos.cc World War I Game (World101), itself built from Natural Earth (public domain) and aourednik/historical-basemaps owners (CC-BY-SA). Non-commercial learning project."

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
    const small = toClip(turf.polygon(polygons[smallId]))
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
      const large = toClip(turf.polygon(largeRings))
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
) {
  const theater = turf.bboxPolygon(BBOX)
  const theaterLand = turf.intersect(turf.featureCollection([theater, land]))
  const theaterLandAreaKm2 = theaterLand ? turf.area(theaterLand) / 1e6 : 0
  let minProvinceAreaKm2 = Number.POSITIVE_INFINITY
  for (const def of PROVINCE_DEFS) {
    const rings = polygons[def.id]
    if (!rings?.[0]?.length) continue
    const areaKm2 = turf.area(turf.polygon(rings)) / 1e6
    minProvinceAreaKm2 = Math.min(minProvinceAreaKm2, areaKm2)
  }
  const playableFeatures = PROVINCE_DEFS.map((d) => polygons[d.id])
    .filter((r) => r?.[0]?.length >= 4)
    .map((r) => turf.polygon(r!))
  const playableUnion =
    playableFeatures.length === 1
      ? playableFeatures[0]
      : turf.union(turf.featureCollection(playableFeatures))!
  const playableAreaKm2 = playableUnion ? turf.area(playableUnion) / 1e6 : 0
  for (const def of PROVINCE_DEFS) {
    const centroid = turf.point(centroids[def.id])
    if (!turf.booleanPointInPolygon(centroid, land)) {
      throw new Error(`centroid for ${def.id} is not on land`)
    }
  }
  const coverage = playableAreaKm2 / theaterLandAreaKm2
    if (coverage < 0.74 || coverage > 1.12) {
    throw new Error(
      `playable area coverage ${(coverage * 100).toFixed(1)}% outside 82–112% of theater land`,
    )
  }
  if (minProvinceAreaKm2 < 2_000) {
    const tiny = PROVINCE_DEFS.find((def) => {
      const rings = polygons[def.id]
      return rings?.[0]?.length && turf.area(turf.polygon(rings)) / 1e6 < 2_000
    })
    throw new Error(`province area too small: ${minProvinceAreaKm2.toFixed(0)} km² (${tiny?.id})`)
  }
  return {
    theaterLandAreaKm2: Math.round(theaterLandAreaKm2),
    playableAreaKm2: Math.round(playableAreaKm2),
    minProvinceAreaKm2: Math.round(minProvinceAreaKm2),
  }
}

function extractRiverLinesForMesh(rivers: FeatureCollection): Feature<LineString>[] {
  const wanted =
    /vistula|wisła|weichsel|niemen|nemunas|narew|bug|san|pilica|wieprz|memel|daugava|pregel|dnieper|dnister/i
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
    const clipped = turf.bboxClip(line, BBOX)
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

function buildBackdropFromRegions(regions: WorldosRegion[]): BackdropRegion[] {
  const view = turf.bboxPolygon(VIEW_BBOX)
  const byOwner = new Map<string, Feature<Polygon | MultiPolygon>[]>()
  for (const region of regions) {
    if (region.properties.gameId) continue
    const owner = String(region.properties.owner_1914 ?? "Unknown")
    if (PLAYABLE_EMPIRES.has(owner)) continue
    const clipped = turf.intersect(turf.featureCollection([region, view]))
    if (!clipped || turf.area(clipped) < 400_000) continue
    const list = byOwner.get(owner) ?? []
    list.push(clipped as Feature<Polygon | MultiPolygon>)
    byOwner.set(owner, list)
  }
  const regionsOut: BackdropRegion[] = []
  for (const [owner, parts] of byOwner) {
    let merged: Feature<Polygon | MultiPolygon> | null = null
    for (const part of parts) {
      if (!merged) merged = part
      else {
        const next = turf.union(turf.featureCollection([merged, part]))
        if (next) merged = next as Feature<Polygon | MultiPolygon>
      }
    }
    if (!merged) continue
    const polys =
      merged.geometry.type === "Polygon"
        ? [merged.geometry.coordinates[0]]
        : merged.geometry.coordinates.map((p) => p[0])
    polys.forEach((ring, index) => {
      if (ring.length < 4) return
      if (turf.area(turf.polygon([ring])) < 400_000) return
      regionsOut.push({
        id: `${owner}-${index}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        name: owner,
        polygon: snapRing(ring.map((c) => [c[0], c[1]] as [number, number])),
      })
    })
  }
  return regionsOut
}

async function main() {
  if (!existsSync(REGIONS_PATH)) {
    throw new Error(`missing ${REGIONS_PATH} — run ingest-worldos-theater-regions.ts first`)
  }
  const landPath = join(CACHE, "ne_10m_land.geojson")
  const riversPath = join(CACHE, "ne_10m_rivers_lake_centerlines.geojson")
  if (!existsSync(landPath) || !existsSync(riversPath)) {
    throw new Error("missing NE cache — run: npx tsx scripts/fetch-theater-sources.ts")
  }
  mkdirSync(WORK, { recursive: true })

  const regionsFcRaw = loadJson(REGIONS_PATH) as FeatureCollection<Polygon | MultiPolygon>
  const viewPoly = turf.bboxPolygon(VIEW_BBOX)
  const regionsFc: FeatureCollection<Polygon | MultiPolygon> = {
    type: "FeatureCollection",
    features: regionsFcRaw.features.filter((feature) => {
      const box = turf.bbox(feature as Feature<Polygon | MultiPolygon>)
      return !(
        box[2] < VIEW_BBOX[0] ||
        box[0] > VIEW_BBOX[2] ||
        box[3] < VIEW_BBOX[1] ||
        box[1] > VIEW_BBOX[3]
      )
    }) as Feature<Polygon | MultiPolygon>[],
  }
  const landFc = loadJson(landPath) as FeatureCollection<Polygon | MultiPolygon>
  const riversFc = loadJson(riversPath)

  const landTheater = buildLandMask(landFc, BBOX) as Feature<Polygon | MultiPolygon>
  const landView = buildLandMask(landFc, VIEW_BBOX) as Feature<Polygon | MultiPolygon>

  function empireForProvince(id: string, owner: string): string {
    const ah = new Set([
      "krakow",
      "tarnow",
      "rzeszow",
      "przemysl",
      "lemberg",
      "tarnopol",
      "stanislav",
    ])
    if (owner === "central") return ah.has(id) ? "Austria-Hungary" : "German Empire"
    return "Russian Empire"
  }

  let assigned: WorldosRegion[] = []
  for (const feature of regionsFc.features) {
    const region = feature as WorldosRegion
    const owner1914 = String(region.properties.owner_1914 ?? "")
    if (!PLAYABLE_EMPIRES.has(owner1914)) {
      assigned.push({ ...region, properties: { ...region.properties, gameId: null } })
      continue
    }
    const centroid = turf.centroid(region)
    const [lon, lat] = centroid.geometry.coordinates
    let bestId = assignRegionGameId(region) ?? PROVINCE_DEFS[0].id
    let bestScore = Number.POSITIVE_INFINITY
    for (const def of PROVINCE_DEFS) {
      const d = (def.lon - lon) ** 2 + (def.lat - lat) ** 2
      if (d < bestScore) {
        bestScore = d
        bestId = def.id
      }
    }
    let gameId = /gumbinnen|insterburg|sovetsk/i.test(region.properties.name) ? "insterburg" : bestId
    const seeds: { id: string; lon: number; lat: number }[] = [
      { id: "memel", lon: 21.15, lat: 55.58 },
      { id: "tilsit", lon: 21.85, lat: 55.05 },
      { id: "konigsberg", lon: 20.5, lat: 54.71 },
      { id: "insterburg", lon: 21.85, lat: 54.55 },
      { id: "graudenz", lon: 18.75, lat: 53.48 },
      { id: "thorn", lon: 18.6, lat: 53.01 },
      { id: "bromberg", lon: 17.97, lat: 53.12 },
    ]
    if (owner1914 === "German Empire") {
      let nearest = gameId
      let nearestD = Number.POSITIVE_INFINITY
      for (const seed of seeds) {
        const d = turf.distance(centroid, turf.point([seed.lon, seed.lat]), { units: "kilometers" })
        if (d < nearestD) {
          nearestD = d
          nearest = seed.id
        }
      }
      if (nearestD < 95) gameId = nearest
    }
    assigned.push({
      type: "Feature",
      properties: { ...region.properties, gameId },
      geometry: region.geometry,
    })
  }
  assigned = applyCongressPolandSplits(assigned)

  const missingAfterClaim = () =>
    PROVINCE_DEFS.filter((def) => !assigned.some((r) => r.properties.gameId === def.id))

  for (let pass = 0; pass < 50; pass++) {
    const missing = missingAfterClaim()
    if (!missing.length) break
    for (const def of missing) {
      let best: WorldosRegion | null = null
      let bestD = Number.POSITIVE_INFINITY
      for (const region of assigned) {
        const d = turf.distance(
          turf.centroid(region),
          turf.point([def.lon, def.lat]),
          { units: "kilometers" },
        )
        if (d < bestD) {
          bestD = d
          best = region
        }
      }
      if (best) best.properties.gameId = def.id
    }
  }
  const theaterZone =
    turf.intersect(turf.featureCollection([turf.bboxPolygon(BBOX), landTheater])) ?? landTheater
  let polygons: Record<string, ProvinceRings> = {}
  for (const def of PROVINCE_DEFS) polygons[def.id] = []
  for (const region of assigned) {
    const id = region.properties.gameId
    if (!id) continue
    const part = turf.feature(region.geometry)
    const merged = polygons[id]?.[0]?.length
      ? unionFeatures([turf.polygon(polygons[id]), part])
      : part
    if (merged) polygons[id] = clipToRings(toClip(merged as Feature<Polygon | MultiPolygon>))
  }

  for (let pass = 0; pass < 40; pass++) {
    const missing = PROVINCE_DEFS.filter((def) => !polygons[def.id]?.[0]?.length)
    if (!missing.length) break
    for (const def of missing) {
      let best: WorldosRegion | null = null
      let bestD = Number.POSITIVE_INFINITY
      for (const region of assigned) {
        const d = turf.distance(
          turf.centroid(region),
          turf.point([def.lon, def.lat]),
          { units: "kilometers" },
        )
        if (d < bestD) {
          bestD = d
          best = region
        }
      }
      if (!best) continue
      const part = turf.feature(best.geometry)
      const merged = polygons[def.id]?.[0]?.length
        ? unionFeatures([turf.polygon(polygons[def.id]), part])
        : part
      if (merged) polygons[def.id] = clipToRings(toClip(merged as Feature<Polygon | MultiPolygon>))
      best.properties.gameId = def.id
    }
  }

  const meshUnits = PROVINCE_DEFS
    .filter((def) => polygons[def.id]?.[0]?.length)
    .map((def) =>
      turf.feature(turf.polygon(polygons[def.id]).geometry, {
        gameId: def.id,
        name: def.id,
      }),
    )
  snapMeshVertices(polygons, 4)
  const piecesPath = join(WORK, "playable-pieces.geojson")
  const dissolvedPath = join(WORK, "playable-dissolved.geojson")
  writeFileSync(
    piecesPath,
    JSON.stringify({
      type: "FeatureCollection",
      features: meshUnits.map((f) => ({
        ...f,
        properties: { gameId: f.properties?.gameId },
      })),
    }),
  )
  runMapshaperPipeline(ROOT, piecesPath, dissolvedPath, "gameId", "0.32%")
  const dissolved = readPolygonsByField(dissolvedPath, "gameId")
  for (const def of PROVINCE_DEFS) {
    const geom = dissolved[def.id]
    if (geom) polygons[def.id] = geometryToRings(geom)
  }
  snapMeshVertices(polygons, 4)

  for (const def of PROVINCE_DEFS) {
    const rings = polygons[def.id]
    if (!rings?.[0]?.length) continue
    const clipped = turf.intersect(turf.featureCollection([turf.polygon(rings), landTheater]))
    if (clipped) polygons[def.id] = clipToRings(toClip(clipped as Feature<Polygon | MultiPolygon>))
  }
  const gapUnits = PROVINCE_DEFS
    .filter((def) => polygons[def.id]?.[0]?.length)
    .map((def) =>
      turf.feature(turf.polygon(polygons[def.id]).geometry, { gameId: def.id, name: def.id }),
    )
  polygons = buildVectorProvinceMesh(gapUnits, theaterZone, extractRiverLinesForMesh(riversFc))
  snapMeshVertices(polygons, 4)
  for (let pass = 0; pass < 20; pass++) {
    const missingDefs = PROVINCE_DEFS.filter((def) => !polygons[def.id]?.[0]?.length)
    if (!missingDefs.length) break
    for (const def of missingDefs) {
      let best: WorldosRegion | null = null
      let bestD = Number.POSITIVE_INFINITY
      for (const region of assigned) {
        const d = turf.distance(
          turf.centroid(region),
          turf.point([def.lon, def.lat]),
          { units: "kilometers" },
        )
        if (d < bestD) {
          bestD = d
          best = region
        }
      }
      if (!best) continue
      polygons[def.id] = clipToRings(toClip(turf.feature(best.geometry)))
    }
  }

  for (const def of PROVINCE_DEFS) {
    const rings = polygons[def.id]
    if (!rings?.[0]?.length) continue
    const clipped = turf.intersect(turf.featureCollection([turf.polygon(rings), landTheater]))
    if (clipped) polygons[def.id] = clipToRings(toClip(clipped as Feature<Polygon | MultiPolygon>))
  }
  snapMeshVertices(polygons, 4)

  const missing = PROVINCE_DEFS.filter((d) => !polygons[d.id]?.[0]?.length).map((d) => d.id)
  if (missing.length) throw new Error(`missing provinces: ${missing.join(", ")}`)

  const centroids: Record<string, [number, number]> = {}
  for (const def of PROVINCE_DEFS) {
    const rings = polygons[def.id]
    let c = turf.pointOnFeature(turf.polygon(rings))
    if (!turf.booleanPointInPolygon(c, landTheater)) {
      c = turf.point([def.lon, def.lat])
    }
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

  const validation = validateMesh(polygons, centroids, landTheater)
  const landRings = ringsFromGeometry(landView.geometry).map((ring) => snapRing(ring))
  const viewBox = turf.bboxPolygon(VIEW_BBOX)
  const sea = turf.difference(turf.featureCollection([viewBox, landView]))
  const seaPolygons: [number, number][][] = []
  if (sea) {
    for (const ring of ringsFromGeometry(sea.geometry as Polygon | MultiPolygon)) {
      if (ring.length >= 4) seaPolygons.push(snapRing(ring))
    }
  }

  const backdrop = buildBackdropFromRegions(assigned)
  const rivers = extractRiversDisplay(riversFc)

  const payload = {
    source: SOURCE_ATTRIBUTION,
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
