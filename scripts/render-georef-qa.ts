/**
 * QA PNGs: HOI4 crop, ids.tif, warped GeoJSON outline, Natural Earth coast.
 * Run after build-hoi4-theater.ts: npx tsx scripts/render-georef-qa.ts
 */
import { execSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { FeatureCollection } from "geojson"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const WORK = join(ROOT, "scripts/cache/hoi4-build")
const HOI4 = join(ROOT, "scripts/cache/hoi4")
const OUT = "/opt/cursor/artifacts/georef-qa"
const NE_COAST =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_coastline.geojson"
const VIEW: [number, number, number, number] = [9.0, 46.75, 32.0, 57.35]

function lonLatToPx(
  lon: number,
  lat: number,
  w: number,
  h: number,
): [number, number] {
  const [minLon, minLat, maxLon, maxLat] = VIEW
  const x = ((lon - minLon) / (maxLon - minLon)) * w
  const y = ((maxLat - lat) / (maxLat - minLat)) * h
  return [x, y]
}

function ringToPath(ring: number[][], w: number, h: number): string {
  if (!ring.length) return ""
  const [fx, fy] = lonLatToPx(ring[0][0], ring[0][1], w, h)
  let d = `M ${fx.toFixed(1)} ${fy.toFixed(1)}`
  for (let i = 1; i < ring.length; i++) {
    const [x, y] = lonLatToPx(ring[i][0], ring[i][1], w, h)
    d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return `${d} Z`
}

function featurePaths(fc: FeatureCollection, w: number, h: number, stroke: string): string {
  const paths: string[] = []
  for (const f of fc.features) {
    const g = f.geometry
    if (!g) continue
    if (g.type === "Polygon") {
      for (const ring of g.coordinates) {
        paths.push(`<path d="${ringToPath(ring as number[][], w, h)}" fill="none" stroke="${stroke}" stroke-width="0.8"/>`)
      }
    } else if (g.type === "MultiPolygon") {
      for (const poly of g.coordinates) {
        for (const ring of poly) {
          paths.push(`<path d="${ringToPath(ring as number[][], w, h)}" fill="none" stroke="${stroke}" stroke-width="0.8"/>`)
        }
      }
    } else if (g.type === "LineString") {
      const ring = g.coordinates as number[][]
      paths.push(`<path d="${ringToPath(ring, w, h)}" fill="none" stroke="${stroke}" stroke-width="1.2"/>`)
    } else if (g.type === "MultiLineString") {
      for (const line of g.coordinates) {
        paths.push(`<path d="${ringToPath(line as number[][], w, h)}" fill="none" stroke="${stroke}" stroke-width="1.2"/>`)
      }
    }
  }
  return paths.join("\n")
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const idsTif = join(WORK, "ids.tif")
  const warpedPath = join(WORK, "warped.geojson")
  const bmpPath = join(HOI4, "provinces.bmp")
  if (!existsSync(idsTif) || !existsSync(warpedPath)) {
    throw new Error("run build-hoi4-theater.ts first")
  }

  const idsPng = join(OUT, "ids-raster.png")
  execSync(`gdal_translate -of PNG -scale "${idsTif}" "${idsPng}"`, { stdio: "inherit" })

  const w = 1400
  const h = 1000
  const warped = JSON.parse(readFileSync(warpedPath, "utf8")) as FeatureCollection
  const coastRes = await fetch(NE_COAST)
  const coast = (await coastRes.json()) as FeatureCollection
  const viewPoly = {
    type: "FeatureCollection",
    features: coast.features.filter((f) => {
      if (f.geometry?.type !== "LineString" && f.geometry?.type !== "MultiLineString") return false
      const coords =
        f.geometry.type === "LineString"
          ? f.geometry.coordinates
          : f.geometry.coordinates.flat()
      return coords.some(
        ([lon, lat]) => lon >= VIEW[0] && lon <= VIEW[2] && lat >= VIEW[1] && lat <= VIEW[3],
      )
    }),
  }

  const svg = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="#1a2030"/>
  ${featurePaths(warped, w, h, "#7ec8ff")}
  ${featurePaths(viewPoly, w, h, "#f4d35e")}
</svg>`
  const svgPath = join(OUT, "warped-coast.svg")
  writeFileSync(svgPath, svg)

  const { chromium } = await import("playwright")
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  })
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.goto(`file://${svgPath}`, { waitUntil: "load" })
  await page.screenshot({ path: join(OUT, "warped-vs-coast.png") })

  const compareHtml = `<!DOCTYPE html><html><body style="margin:0;background:#111;display:flex;gap:8px;padding:8px">
  <div><div style="color:#ccc;font:12px sans-serif">ids.tif</div><img src="file://${idsPng}" width="680"/></div>
  <div><div style="color:#ccc;font:12px sans-serif">warped + NE coast</div><img src="file://${join(OUT, "warped-vs-coast.png")}" width="680"/></div>
  </body></html>`
  const htmlPath = join(OUT, "compare.html")
  writeFileSync(htmlPath, compareHtml)
  const cmp = await browser.newPage({ viewport: { width: 1400, height: 520 } })
  await cmp.goto(`file://${htmlPath}`, { waitUntil: "load" })
  await cmp.screenshot({ path: join(OUT, "side-by-side.png"), fullPage: true })
  await browser.close()

  console.log(`QA PNGs in ${OUT}`)
  console.log(`  ${idsPng}`)
  console.log(`  ${join(OUT, "warped-vs-coast.png")}`)
  console.log(`  ${join(OUT, "side-by-side.png")}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
