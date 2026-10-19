/**
 * Simplify Raymond's WorldOS theater extract into the committed derivative.
 * Input: uploads/ww1-1914-theater-regions.geojson (gitignored).
 * Output: lib/data/worldos-theater-regions.geojson
 *
 * Run: npm run ingest:worldos
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const UPLOAD = join(ROOT, "uploads/ww1-1914-theater-regions.geojson")
const OUT = join(ROOT, "lib/data/worldos-theater-regions.geojson")
const WORK = join(ROOT, "scripts/cache/worldos-ingest")

const KEEP = ["id", "name", "owner_1914", "owner_label", "country_modern"] as const

function main() {
  if (!existsSync(UPLOAD)) {
    throw new Error(`Missing ${UPLOAD}. Place the WorldOS theater extract there and re-run.`)
  }
  const source = JSON.parse(readFileSync(UPLOAD, "utf8")) as FeatureCollection
  if (source.type !== "FeatureCollection" || source.features.length !== 103) {
    throw new Error(`Expected 103 WorldOS theater regions, found ${source.features?.length ?? 0}`)
  }
  const features: Feature<Polygon | MultiPolygon>[] = []
  for (const feature of source.features) {
    if (!feature.geometry || (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon")) {
      throw new Error("theater extract contains a non-polygon")
    }
    const props = feature.properties ?? {}
    for (const key of KEEP) {
      if (props[key] == null || props[key] === "") throw new Error(`region is missing ${key}`)
    }
    features.push({
      type: "Feature",
      properties: {
        id: String(props.id),
        name: String(props.name),
        owner_1914: String(props.owner_1914),
        owner_label: String(props.owner_label),
        country_modern: String(props.country_modern),
        geometrySource: "natural-earth-admin1-1914",
      },
      geometry: feature.geometry,
    })
  }

  mkdirSync(WORK, { recursive: true })
  const raw = join(WORK, "raw.geojson")
  const simplified = join(WORK, "simplified.geojson")
  writeFileSync(raw, JSON.stringify({ type: "FeatureCollection", features }))
  const mapshaper = join(ROOT, "node_modules/mapshaper/bin/mapshaper")
  execFileSync(
    mapshaper,
    [
      "-i",
      raw,
      "encoding=utf8",
      "-clean",
      "overlap-rule=max-area",
      "-simplify",
      "weighted",
      "90%",
      "keep-shapes",
      "-o",
      simplified,
      "format=geojson",
      "precision=0.0001",
      "gj2008",
    ],
    { stdio: "inherit", cwd: ROOT },
  )
  const out = JSON.parse(readFileSync(simplified, "utf8")) as FeatureCollection
  if (out.features.length !== 103) {
    throw new Error(`simplify changed the region count to ${out.features.length}`)
  }
  writeFileSync(OUT, `${JSON.stringify(out)}\n`)
  console.log(`Wrote ${OUT} (${out.features.length} regions, ${(Buffer.byteLength(JSON.stringify(out)) / 1e3).toFixed(0)} KB)`)
}

main()
