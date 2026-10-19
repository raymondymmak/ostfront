import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import type { FeatureCollection, Polygon, MultiPolygon } from "geojson"

export function runMapshaperPipeline(
  root: string,
  input: string,
  output: string,
  dissolveField: string,
  simplifyPct = "0.35%",
) {
  const mapshaper = join(root, "node_modules/mapshaper/bin/mapshaper")
  if (existsSync(output)) unlinkSync(output)
  execFileSync(
    mapshaper,
    [
      "-i",
      input,
      "encoding=utf8",
      "-clean",
      "gap-fill-area=0",
      "-dissolve",
      dissolveField,
      "-filter-slivers",
      "min-area=0.2",
      "-simplify",
      simplifyPct,
      "keep-shapes",
      "-o",
      output,
      "format=geojson",
      "gj2008",
    ],
    { stdio: "pipe", cwd: root },
  )
}

export function readPolygonsByField(
  path: string,
  field: string,
): Record<string, Polygon | MultiPolygon> {
  const fc = JSON.parse(readFileSync(path, "utf8")) as FeatureCollection
  const out: Record<string, Polygon | MultiPolygon> = {}
  for (const feature of fc.features) {
    const id = String(feature.properties?.[field] ?? "")
    if (!id || !feature.geometry) continue
    out[id] = feature.geometry as Polygon | MultiPolygon
  }
  return out
}
