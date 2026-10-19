/**
 * Historical theater geometry (1914 admin units → game provinces, CShapes backdrop).
 * Run: npx tsx scripts/build-historical-theater.ts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import * as turf from "@turf/turf"
import type { Feature, FeatureCollection, LineString, MultiPolygon, Point, Polygon } from "geojson"
import polygonClipping from "polygon-clipping"
import { PROVINCE_DEFS } from "../lib/data/definitions"
import { applyWestGaliciaProvinces } from "./galicia-west-provinces"
import {
  buildVectorProvinceMesh,
  simplifyProvinceRings,
  snapMeshVertices,
  snapRing,
  type ProvinceRings,
} from "./vector-province-mesh"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const CACHE = join(ROOT, "scripts/cache")
const BBOX: [number, number, number, number] = [15.8, 48.35, 28.8, 56.35]
const VIEW_BBOX: [number, number, number, number] = [9.0, 46.75, 32.0, 57.35]
const NE_LAND =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson"
const NE_RIVERS =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_rivers_lake_centerlines.geojson"

const CS_LABELS: Record<string, string> = {
  "Germany (Prussia)": "German Empire",
  "Austria-Hungary": "Austria-Hungary",
  "Russia (Soviet Union)": "Russian Empire",
  Rumania: "Romania",
  Sweden: "Sweden",
  Denmark: "Denmark",
  Netherlands: "Netherlands",
  Norway: "Norway",
  Switzerland: "Switzerland",
  Italy: "Italy",
  Turkey: "Ottoman Empire",
  Montenegro: "Montenegro",
  Serbia: "Serbia",
  Bulgaria: "Bulgaria",
  Greece: "Greece",
  Albania: "Albania",
}

type BackdropRegion = { id: string; name: string; polygon: [number, number][] }
type RiverLine = { id: string; name: string; coordinates: [number, number][] }

async function fetchJson(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)
  return (await response.json()) as FeatureCollection
}

function roundCoord([lon, lat]: [number, number]): [number, number] {
  return [Math.round(lon * 10000) / 10000, Math.round(lat * 10000) / 10000]
}

function outerRing(merged: Feature<Polygon | MultiPolygon>): [number, number][] {
  if (merged.geometry.type === "Polygon") return snapRing(merged.geometry.coordinates[0] as [number, number][])
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
  return snapRing(best)
}

function buildLandMask(land: FeatureCollection<Polygon | MultiPolygon>, bbox: [number, number, number, number]) {
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
  return geometry.coordinates.map((poly) => poly[0] as [number, number][])
}

function activeInJune1915(props: Record<string, unknown>): boolean {
  const gwsyear = Number(props.gwsyear)
  const gweyear = Number(props.gweyear)
  const gwsmonth = Number(props.gwsmonth ?? 1)
  const gwemonth = Number(props.gwemonth ?? 12)
  const start = gwsyear + (gwsmonth - 1) / 12
  const end = gweyear >= 9999 ? 9999 : gweyear + (gwemonth - 1) / 12
  const june1915 = 1915 + 5 / 12
  return start <= june1915 && end >= june1915
}

function loadAdminUnits(hull: Feature<Polygon | MultiPolygon>): Feature<Polygon | MultiPolygon>[] {
  const units: Feature<Polygon | MultiPolygon>[] = []
  const box = turf.bboxPolygon(BBOX)

  const uezdPath = join(CACHE, "uezds.geojson")
  if (existsSync(uezdPath)) {
    const uezds = JSON.parse(readFileSync(uezdPath, "utf8")) as FeatureCollection
    for (const feature of uezds.features) {
      if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") continue
      const fb = turf.bbox(feature as Feature<Polygon | MultiPolygon>)
      if (fb[2] < BBOX[0] || fb[0] > BBOX[2] || fb[3] < BBOX[1] || fb[1] > BBOX[3]) continue
      const clipped = turf.intersect(turf.featureCollection([feature as Feature<Polygon | MultiPolygon>, hull]))
      if (!clipped || turf.area(clipped) < 2_000_000) continue
      units.push({
        type: "Feature",
        properties: {
          name: `${feature.properties?.uezd_name ?? "uezd"} (${feature.properties?.province_n ?? ""})`,
          source: "uezd1897",
        },
        geometry: clipped.geometry,
      })
    }
  }

  const ohmPath = join(CACHE, "ohm-theater-admin.geojson")
  if (existsSync(ohmPath)) {
    const ohm = JSON.parse(readFileSync(ohmPath, "utf8")) as FeatureCollection
    for (const feature of ohm.features) {
      const level = Number(feature.properties?.admin_level ?? 0)
      const name = String(feature.properties?.name ?? "")
      if (level < 4 || level > 7) continue
      if (level === 4 && /provinz|gouvernement|gubernia/i.test(name) && !/poland|galicia|warsaw/i.test(name)) {
        continue
      }
      if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") continue
      const clipped = turf.intersect(turf.featureCollection([feature as Feature<Polygon | MultiPolygon>, hull]))
      if (!clipped || turf.area(clipped) < 2_500_000) continue
      units.push({
        type: "Feature",
        properties: {
          name: String(feature.properties?.name ?? "ohm"),
          source: "ohm",
          admin_level: level,
        },
        geometry: clipped.geometry,
      })
    }
  }

  return units
}

function ringsFromFeature(feature: Feature<Polygon | MultiPolygon>): ProvinceRings {
  if (feature.geometry.type === "Polygon") {
    return feature.geometry.coordinates.map((ring) =>
      snapRing(ring as [number, number][]),
    ) as ProvinceRings
  }
  let merged: Feature<Polygon | MultiPolygon> = turf.polygon(feature.geometry.coordinates[0])
  for (let i = 1; i < feature.geometry.coordinates.length; i++) {
    const next = turf.polygon(feature.geometry.coordinates[i])
    const unioned = turf.union(turf.featureCollection([merged, next]))
    if (unioned) merged = unioned as Feature<Polygon | MultiPolygon>
  }
  return ringsFromFeature(merged)
}

function toClipRings(rings: ProvinceRings): polygonClipping.Polygon | polygonClipping.MultiPolygon | null {
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
      if (ring.length >= 4) {
        rings.push(snapRing(ring.map((c) => [c[0], c[1]] as [number, number])))
      }
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

function clipPolygonsToLand(
  polygons: Record<string, ProvinceRings>,
  land: Feature<Polygon | MultiPolygon>,
) {
  for (const def of PROVINCE_DEFS) {
    const rings = polygons[def.id]
    if (!rings?.[0]?.length) continue
    const clipped = turf.intersect(turf.featureCollection([turf.polygon(rings), land]))
    if (!clipped) continue
    polygons[def.id] = ringsFromFeature(clipped as Feature<Polygon | MultiPolygon>)
  }
}

function neighborsFromPolygons(polygons: Record<string, ProvinceRings>) {
  const features = Object.entries(polygons).map(([id, rings]) => turf.polygon(rings, { id }))
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

function buildTheaterHull() {
  const hull = turf.convex(
    turf.featureCollection(PROVINCE_DEFS.map((def) => turf.point([def.lon, def.lat]))),
  )
  if (!hull) throw new Error("convex hull failed")
  const buffered = turf.buffer(hull, 75, { units: "kilometers" })
  const box = turf.bboxPolygon(BBOX)
  const clipped = turf.intersect(turf.featureCollection([buffered!, box]))
  return clipped ?? buffered!
}

function buildCShapesBackdrop(
  playableUnion: Feature<Polygon | MultiPolygon>,
  viewBbox: [number, number, number, number],
): BackdropRegion[] {
  const cshapes = JSON.parse(readFileSync(join(CACHE, "CShapes-2.0.geojson"), "utf8")) as FeatureCollection
  const viewBox = turf.bboxPolygon(viewBbox)
  const playable = turf.buffer(playableUnion, 3, { units: "kilometers" }) ?? playableUnion
  const regions: BackdropRegion[] = []
  const seen = new Set<string>()

  for (const feature of cshapes.features) {
    const props = feature.properties as Record<string, unknown>
    if (!activeInJune1915(props)) continue
    const rawName = String(props.cntry_name ?? "")
    const label = CS_LABELS[rawName]
    if (!label) continue
    if (/poland|slovak|ukraine|lithuania|latvia|belarus|czech/i.test(rawName)) continue
    const clipped = turf.intersect(
      turf.featureCollection([feature as Feature<Polygon | MultiPolygon>, viewBox]),
    )
    if (!clipped) continue
    const diff = turf.difference(turf.featureCollection([clipped, playable]))
    if (!diff) continue
    const polys =
      diff.geometry.type === "Polygon"
        ? [diff.geometry.coordinates[0]]
        : diff.geometry.coordinates.map((p) => p[0])
    polys.forEach((ring, index) => {
      if (ring.length < 4) return
      if (turf.area(turf.polygon([ring])) < 500_000) return
      const key = `${label}-${index}`
      if (seen.has(key)) return
      seen.add(key)
      regions.push({
        id: key.toLowerCase().replace(/\s+/g, "-"),
        name: label,
        polygon: snapRing(ring.map((c) => [c[0], c[1]] as [number, number])),
      })
    })
  }
  return regions
}

function extractRiverLinesForCuts(rivers: FeatureCollection): Feature<LineString>[] {
  const wanted = /vistula|wisła|weichsel|niemen|nemunas|narew|bug|san|memel|daugava|pregel|dnieper|pilica|wieprz/i
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
    if (turf.length(clipped, { units: "kilometers" }) < 15) continue
    lines.push(clipped as Feature<LineString>)
  }
  return lines
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

function validateMesh(
  polygons: Record<string, ProvinceRings>,
  centroids: Record<string, [number, number]>,
  land: Feature<Polygon | MultiPolygon>,
  hull: Feature<Polygon | MultiPolygon>,
) {
  const theaterLand = turf.intersect(turf.featureCollection([hull, land]))
  const theaterLandAreaKm2 = theaterLand ? turf.area(theaterLand) / 1e6 : 0
  let minProvinceAreaKm2 = Number.POSITIVE_INFINITY
  for (const rings of Object.values(polygons)) {
    const areaKm2 = turf.area(turf.polygon(rings)) / 1e6
    minProvinceAreaKm2 = Math.min(minProvinceAreaKm2, areaKm2)
  }
  const playableUnion =
    Object.values(polygons).length === 1
      ? turf.polygon(Object.values(polygons)[0])
      : turf.union(
          turf.featureCollection(Object.values(polygons).map((rings) => turf.polygon(rings))),
        )
  const playableAreaKm2 = playableUnion ? turf.area(playableUnion) / 1e6 : 0
  for (const def of PROVINCE_DEFS) {
    const centroid = turf.point(centroids[def.id])
    if (!turf.booleanPointInPolygon(centroid, land)) {
      throw new Error(`centroid for ${def.id} is not on Natural Earth land`)
    }
  }
  const coverage = playableAreaKm2 / theaterLandAreaKm2
  if (coverage < 0.88 || coverage > 1.12) {
    throw new Error(
      `playable area coverage ${(coverage * 100).toFixed(1)}% outside 88–110% of theater land`,
    )
  }
  if (minProvinceAreaKm2 < 2_400) {
    throw new Error(`province area too small: ${minProvinceAreaKm2.toFixed(0)} km²`)
  }
  return {
    theaterLandAreaKm2: Math.round(theaterLandAreaKm2),
    playableAreaKm2: Math.round(playableAreaKm2),
    minProvinceAreaKm2: Math.round(minProvinceAreaKm2),
  }
}

async function main() {
  const [landRaw, riversRaw] = await Promise.all([fetchJson(NE_LAND), fetchJson(NE_RIVERS)])
  const landTheater = buildLandMask(
    landRaw as FeatureCollection<Polygon | MultiPolygon>,
    BBOX,
  ) as Feature<Polygon | MultiPolygon>
  const landView = buildLandMask(
    landRaw as FeatureCollection<Polygon | MultiPolygon>,
    VIEW_BBOX,
  ) as Feature<Polygon | MultiPolygon>
  const hull = buildTheaterHull()

  const units = loadAdminUnits(hull)
  console.log(`admin units in theater: ${units.length}`)
  if (units.length < 40) {
    throw new Error("too few historical admin units — run convert-ohm-admin and uezds cache first")
  }

  const theaterZone = turf.intersect(turf.featureCollection([hull, landTheater])) ?? landTheater
  const riverFeatures = extractRiverLinesForCuts(riversRaw)
  let polygons = buildVectorProvinceMesh(units, theaterZone, riverFeatures)
  snapMeshVertices(polygons, 4)
  polygons = simplifyProvinceRings(polygons, 2.2)
  snapMeshVertices(polygons, 4)
  clipPolygonsToLand(polygons, landTheater)
  applyWestGaliciaProvinces(polygons, units, theaterZone)
  snapMeshVertices(polygons, 4)
  removeProvinceOverlaps(polygons)

  const centroids: Record<string, [number, number]> = {}
  for (const def of PROVINCE_DEFS) {
    const rings = polygons[def.id]
    if (rings?.[0]?.length >= 4) {
      const c = turf.pointOnFeature(turf.polygon(rings))
      centroids[def.id] = roundCoord(c.geometry.coordinates as [number, number])
    } else {
      centroids[def.id] = roundCoord([def.lon, def.lat])
    }
  }

  const neighbors = neighborsFromPolygons(polygons)
  const filled = Object.values(polygons).filter((rings) => rings[0]?.length >= 4).length
  console.log(`province polygons: ${filled}/${PROVINCE_DEFS.length}`)
  const validation = validateMesh(polygons, centroids, landTheater, hull)

  const playableFeatures = Object.entries(polygons).map(([id, rings]) => turf.polygon(rings, { id }))
  const playableUnion =
    playableFeatures.length === 1
      ? playableFeatures[0]
      : turf.union(turf.featureCollection(playableFeatures))!

  const landRings = ringsFromGeometry(landView.geometry).map((ring) => snapRing(ring))
  const viewBox = turf.bboxPolygon(VIEW_BBOX)
  const sea = turf.difference(turf.featureCollection([viewBox, landView]))
  const seaRings: [number, number][][] = []
  if (sea) {
    for (const ring of ringsFromGeometry(sea.geometry as Polygon | MultiPolygon)) {
      if (ring.length >= 4) seaRings.push(snapRing(ring))
    }
  }

  const backdrop = buildCShapesBackdrop(playableUnion, VIEW_BBOX)
  const rivers = extractRivers(riversRaw)

  const payload = {
    source:
      "Playable: dissolved 1897 uezds + OpenHistoricalMap admin (CC0), clipped NE coast; backdrop: CShapes 2.0 (June 1915); rivers: Natural Earth",
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

  writeFileSync(join(ROOT, "lib/data/theater-geometry.json"), `${JSON.stringify(payload)}\n`)
  console.log(`Wrote theater-geometry.json — ${Object.keys(polygons).length} provinces`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
