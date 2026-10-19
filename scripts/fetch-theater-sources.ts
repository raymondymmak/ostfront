/**
 * Fetch Natural Earth 10m + aourednik historical-basemaps into scripts/cache/.
 * Run: npx tsx scripts/fetch-theater-sources.ts
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const CACHE = join(ROOT, "scripts/cache")

const SOURCES: { url: string; file: string }[] = [
  {
    url:
      "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson",
    file: "ne_10m_admin_1_states_provinces.geojson",
  },
  {
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson",
    file: "ne_10m_land.geojson",
  },
  {
    url:
      "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson",
    file: "ne_10m_rivers_lake_centerlines.geojson",
  },
  {
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_coastline.geojson",
    file: "ne_10m_coastline.geojson",
  },
  {
    url: "https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson/world_1914.geojson",
    file: "historical-basemaps_world_1914.geojson",
  },
]

async function main() {
  mkdirSync(CACHE, { recursive: true })
  for (const { url, file } of SOURCES) {
    const dest = join(CACHE, file)
    if (existsSync(dest)) {
      console.log(`cache hit ${file}`)
      continue
    }
    console.log(`fetching ${file}…`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url} → ${res.status}`)
    const text = await res.text()
    writeFileSync(dest, text)
    console.log(`wrote ${dest} (${(text.length / 1e6).toFixed(2)} MB)`)
  }
  const sample = JSON.parse(
    readFileSync(join(CACHE, "historical-basemaps_world_1914.geojson"), "utf8"),
  )
  console.log(
    "world_1914 sample props:",
    JSON.stringify(sample.features[0]?.properties ?? {}, null, 0).slice(0, 200),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
