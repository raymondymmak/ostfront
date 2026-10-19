/**
 * Normalize WorldOS theater export → lib/data/worldos-theater-regions.geojson (simplified, topology-safe).
 *
 * Preferred input: uploads/ww1-1914-theater-regions.geojson (Raymond's World101 theater extract).
 * Run: npx tsx scripts/ingest-worldos-theater-regions.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const UPLOAD = join(ROOT, "uploads/ww1-1914-theater-regions.geojson")
const OUT = join(ROOT, "lib/data/worldos-theater-regions.geojson")
const WORK = join(ROOT, "scripts/cache/worldos-ingest")

function normalizeProps(props: Record<string, unknown>) {
  const name = String(props.name ?? props.label ?? props.region_name ?? "region")
  const owner = String(
    props.owner_1914 ?? props.owner ?? props.nation_1914 ?? props.nation ?? "Unknown",
  )
  const regionId = String(props.region_id ?? props.id ?? props.regionId ?? name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  return { region_id: regionId, name, owner_1914: owner }
}

function loadSource(): FeatureCollection {
  if (!existsSync(UPLOAD)) {
    throw new Error(
      `Missing ${UPLOAD}. Place the WorldOS theater extract there, then re-run ingest.`,
    )
  }
  const fc = JSON.parse(readFileSync(UPLOAD, "utf8")) as FeatureCollection
  const features: Feature<Polygon | MultiPolygon>[] = []
  for (const feature of fc.features) {
    if (!feature.geometry || (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon")) {
      continue
    }
    features.push({
      type: "Feature",
      properties: normalizeProps((feature.properties ?? {}) as Record<string, unknown>),
      geometry: feature.geometry,
    })
  }
  if (features.length < 80) {
    throw new Error(`Expected ~103 theater regions, got ${features.length}`)
  }
  return { type: "FeatureCollection", features }
}

function main() {
  const fc = loadSource()
  mkdirSync(WORK, { recursive: true })
  const raw = join(WORK, "raw.geojson")
  const simplified = join(WORK, "simplified.geojson")
  writeFileSync(raw, JSON.stringify(fc))
  const mapshaper = join(ROOT, "node_modules/mapshaper/bin/mapshaper")
  execFileSync(
    mapshaper,
    [
      "-i",
      raw,
      "encoding=utf8",
      "-clean",
      "gap-fill-area=0",
      "-filter-slivers",
      "min-area=0.15",
      "-simplify",
      "0.25%",
      "keep-shapes",
      "-o",
      simplified,
      "format=geojson",
      "gj2008",
    ],
    { stdio: "pipe", cwd: ROOT },
  )
  const outFc = JSON.parse(readFileSync(simplified, "utf8")) as FeatureCollection
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, `${JSON.stringify(outFc)}\n`)
  console.log(`Wrote ${OUT} (${outFc.features.length} regions)`)
}

main()
