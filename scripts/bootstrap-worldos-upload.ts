/**
 * ONE-TIME bootstrap: build uploads/ww1-1914-theater-regions.geojson when the WorldOS export
 * is not on disk. Matches the World101 theater extract (NE admin-1 + 1914 owners, EPSG:4326).
 * After bootstrap, run ingest-worldos-theater-regions.ts and commit lib/data/worldos-theater-regions.geojson.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import * as turf from "@turf/turf"
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson"
import { loadNations1914, splitAdminBy1914 } from "./theater/nations-1914"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const CACHE = join(ROOT, "scripts/cache")
const UPLOAD = join(ROOT, "uploads/ww1-1914-theater-regions.geojson")
const VIEW_BBOX: [number, number, number, number] = [9.0, 46.75, 32.0, 57.35]

function main() {
  if (existsSync(UPLOAD)) {
    console.log("upload already exists:", UPLOAD)
    return
  }
  const adminPath = join(CACHE, "ne_10m_admin_1_states_provinces.geojson")
  const worldPath = join(CACHE, "historical-basemaps_world_1914.geojson")
  const landPath = join(CACHE, "ne_10m_land.geojson")
  for (const p of [adminPath, worldPath, landPath]) {
    if (!existsSync(p)) throw new Error(`missing ${p} — run fetch-theater-sources.ts`)
  }
  const adminFc = JSON.parse(readFileSync(adminPath, "utf8")) as FeatureCollection
  const world1914 = JSON.parse(readFileSync(worldPath, "utf8")) as FeatureCollection
  const landFc = JSON.parse(readFileSync(landPath, "utf8")) as FeatureCollection<Polygon | MultiPolygon>
  const view = turf.bboxPolygon(VIEW_BBOX)
  const landParts: Feature<Polygon | MultiPolygon>[] = []
  for (const f of landFc.features) {
    const clipped = turf.intersect(turf.featureCollection([f, view]))
    if (clipped) landParts.push(clipped as Feature<Polygon | MultiPolygon>)
  }
  const land =
    landParts.length === 1
      ? landParts[0]
      : turf.union(turf.featureCollection(landParts))!
  const nations = loadNations1914(world1914, VIEW_BBOX)
  const features: Feature<Polygon | MultiPolygon>[] = []
  const seen = new Set<string>()

  for (const feature of adminFc.features) {
    if (!feature.geometry || (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon")) {
      continue
    }
    const fb = turf.bbox(feature as Feature<Polygon | MultiPolygon>)
    if (fb[2] < VIEW_BBOX[0] || fb[0] > VIEW_BBOX[2] || fb[3] < VIEW_BBOX[1] || fb[1] > VIEW_BBOX[3]) {
      continue
    }
    const clipped = turf.intersect(
      turf.featureCollection([feature as Feature<Polygon | MultiPolygon>, land]),
    )
    if (!clipped || turf.area(clipped) < 1_200_000) continue
    const unitForSplit: Feature<Polygon | MultiPolygon> = {
      type: "Feature",
      properties: { ...(feature.properties ?? {}) },
      geometry: clipped.geometry as Polygon | MultiPolygon,
    }
    const pieces = splitAdminBy1914(unitForSplit, nations, 600_000)
    for (const piece of pieces) {
      const regionId = `${piece.sourceId}-${piece.nationLabel}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
      if (seen.has(regionId)) continue
      seen.add(regionId)
      features.push({
        type: "Feature",
        properties: {
          region_id: regionId,
          name: piece.name,
          admin: piece.admin,
          owner_1914: piece.nationLabel,
        },
        geometry: piece.geometry,
      })
    }
  }

  mkdirSync(dirname(UPLOAD), { recursive: true })
  writeFileSync(UPLOAD, `${JSON.stringify({ type: "FeatureCollection", features })}\n`)
  console.log(`Wrote ${UPLOAD} (${features.length} regions)`)
}

main()
