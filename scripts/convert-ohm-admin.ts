/**
 * Converts cached Overpass JSON to clipped admin polygons for the theater.
 * Run: npx tsx scripts/convert-ohm-admin.ts
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import * as turf from "@turf/turf"
import osmtogeojson from "osmtogeojson"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const CACHE = join(ROOT, "scripts/cache")
const THEATER: [number, number, number, number] = [15.5, 48.0, 29.2, 56.6]

async function main() {
  const raw = JSON.parse(readFileSync(join(CACHE, "ohm-admin.json"), "utf8"))
  const geo = osmtogeojson(raw, { flatProperties: true }) as GeoJSON.FeatureCollection
  const box = turf.bboxPolygon(THEATER)
  const kept: GeoJSON.Feature[] = []

  const [minLon, minLat, maxLon, maxLat] = THEATER
  for (const feature of geo.features) {
    if (!feature.geometry) continue
    if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") continue
    const fb = turf.bbox(feature)
    if (fb[2] < minLon || fb[0] > maxLon || fb[3] < minLat || fb[1] > maxLat) continue
    let fixed = feature
    try {
      fixed = turf.rewind(feature, { reverse: false }) as GeoJSON.Feature
    } catch {
      continue
    }
    const clipped = turf.intersect(
      turf.featureCollection([fixed as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>, box]),
    )
    if (!clipped) continue
    const name =
      String(feature.properties?.name ?? "") ||
      String(feature.properties?.["name:en"] ?? "") ||
      `admin-${feature.id ?? kept.length}`
    const level = Number(feature.properties?.admin_level ?? 0)
    if (level < 4 || level > 8) continue
    const area = turf.area(clipped)
    if (area < 5_000_000) continue
    kept.push({
      type: "Feature",
      properties: { name, admin_level: level, source: "ohm" },
      geometry: clipped.geometry,
    })
  }

  writeFileSync(join(CACHE, "ohm-theater-admin.geojson"), `${JSON.stringify({
    type: "FeatureCollection",
    features: kept,
  })}\n`)
  console.log(`ohm admin units kept: ${kept.length}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
