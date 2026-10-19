import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs"
import { join, basename, dirname } from "node:path"
import { execFileSync } from "node:child_process"
import type { FeatureCollection } from "geojson"

export function writeUInt16Gtiff(
  dest: string,
  width: number,
  height: number,
  data: Uint16Array,
  originX: number,
  originY: number,
) {
  const dir = dirname(dest)
  const base = basename(dest, ".tif")
  const raw = join(dir, `${base}.bil`)
  const hdr = join(dir, `${base}.hdr`)
  writeFileSync(raw, Buffer.from(data.buffer, data.byteOffset, data.byteLength))
  writeFileSync(
    hdr,
    `ENVI
description = { Ostfront HOI4 id raster }
samples = ${width}
lines = ${height}
bands = 1
header offset = 0
file type = ENVI Standard
data type = 12
byte order = 0
interleave = bsq
`,
  )
  execFileSync(
    "gdal_translate",
    [
      "-of",
      "GTiff",
      "-co",
      "COMPRESS=NONE",
      "-a_gt",
      String(originX),
      "1",
      "0",
      String(originY),
      "0",
      "1",
      raw,
      dest,
    ],
    { stdio: "pipe" },
  )
  unlinkSync(raw)
  unlinkSync(hdr)
}

export function polygonizeGtiff(tifPath: string, geojsonPath: string, field = "gid") {
  if (existsSync(geojsonPath)) unlinkSync(geojsonPath)
  execFileSync(
    "gdal_polygonize.py",
    [tifPath, "-b", "1", "-f", "GeoJSON", geojsonPath, "layer", field],
    { stdio: "pipe" },
  )
}

export function runMapshaper(input: string, output: string, root: string) {
  const mapshaper = join(root, "node_modules/mapshaper/bin/mapshaper")
  execFileSync(
    mapshaper,
    [
      "-i",
      input,
      "encoding=utf8",
      "-dissolve",
      "gid",
      "-clean",
      "gap-fill-area=0",
      "-filter-slivers",
      "min-area=2",
      "-smooth",
      "2",
      "-simplify",
      "0.65%",
      "keep-shapes",
      "-o",
      output,
      "format=geojson",
      "gj2008",
    ],
    { stdio: "pipe", cwd: root },
  )
}

export function warpTpsGcps(
  input: string,
  output: string,
  gcps: { px: number; py: number; lon: number; lat: number }[],
) {
  if (existsSync(output)) unlinkSync(output)
  const args = ["-f", "GeoJSON", output, input, "-tps"]
  for (const g of gcps) {
    args.push("-gcp", String(g.px), String(g.py), String(g.lon), String(g.lat))
  }
  execFileSync("ogr2ogr", args, { stdio: "pipe" })
}

export function readGeoJson(path: string): FeatureCollection {
  return JSON.parse(readFileSync(path, "utf8")) as FeatureCollection
}
