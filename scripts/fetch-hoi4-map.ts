/**
 * Download HOI4 map assets into scripts/cache/hoi4/ (gitignored).
 * Default: Kaiserreich public mirror on GitHub.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const CACHE = join(ROOT, "scripts/cache/hoi4")

export const HOI4_MAP_SOURCE = {
  name: "Kaiserreich (Hearts of Iron IV total conversion)",
  repoUrl: "https://github.com/Kaiserreich/Kaiserreich-HOI4",
  definitionUrl:
    "https://raw.githubusercontent.com/Kaiserreich/Kaiserreich-HOI4/master/map/definition.csv",
  provincesBmpUrl:
    "https://raw.githubusercontent.com/Kaiserreich/Kaiserreich-HOI4/master/map/provinces.bmp",
}

async function download(url: string, dest: string) {
  if (existsSync(dest)) {
    console.log(`cache hit ${dest}`)
    return
  }
  console.log(`fetching ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch failed ${url}: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(dest, buf)
  console.log(`wrote ${dest} (${buf.length} bytes)`)
}

async function main() {
  mkdirSync(CACHE, { recursive: true })
  writeFileSync(
    join(CACHE, "SOURCE.json"),
    JSON.stringify(HOI4_MAP_SOURCE, null, 2) + "\n",
  )
  await download(HOI4_MAP_SOURCE.definitionUrl, join(CACHE, "definition.csv"))
  await download(HOI4_MAP_SOURCE.provincesBmpUrl, join(CACHE, "provinces.bmp"))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
