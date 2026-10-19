import { chromium } from "playwright"
import { mkdirSync } from "node:fs"

const base = process.env.MAP_URL ?? "http://127.0.0.1:3000"
const outDir = "/opt/cursor/artifacts/screenshots"
mkdirSync(outDir, { recursive: true })

// Pseudo-degrees of the HOI4 pixel map, not geographic longitude.
const views = [
  { name: "ostfront-full-theater", query: "" },
  { name: "world-1914", query: "mapBounds=-39.2,-19.8,31.2,6.3&mapPadding=8" },
  { name: "world-europe", query: "mapBounds=-8.2,-4.2,7.2,5.4&mapPadding=12" },
  { name: "world-africa", query: "mapBounds=-8.5,-19.2,8.5,-3.6&mapPadding=12" },
  { name: "world-middle-east", query: "mapBounds=1.2,-10.4,12.2,-1.2&mapPadding=12" },
  { name: "world-east-asia", query: "mapBounds=12.8,-9.4,29.6,5.6&mapPadding=12" },
]

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader"],
})

for (const view of views) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const url = view.query ? `${base}?${view.query}` : base
  await page.goto(url, { waitUntil: "networkidle", timeout: 120000 })
  await page.waitForSelector("[data-testid=war-map]", { timeout: 30000 })
  await page.waitForTimeout(2500)
  const path = `${outDir}/${view.name}.png`
  const map = page.locator("[data-testid=war-map]")
  await map.screenshot({ path })
  console.log(path, url)
  await page.close()
}

await browser.close()
