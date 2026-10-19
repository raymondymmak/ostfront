import { chromium } from "playwright"
import { mkdirSync } from "node:fs"

const base = process.env.MAP_URL ?? "http://127.0.0.1:3000"
const outDir = "/opt/cursor/artifacts/screenshots"
mkdirSync(outDir, { recursive: true })

// Pseudo-degrees of the HOI4 pixel map, not geographic longitude.
const views = [
  { name: "ostfront-full-theater", query: "" },
  { name: "ostfront-galicia", query: "mapBounds=-0.85,-1.25,1.35,-0.22&mapPadding=20" },
  { name: "ostfront-east-prussia", query: "mapBounds=-0.9,0.15,0.7,1.2&mapPadding=24" },
  { name: "ostfront-baltic", query: "mapBounds=-0.7,0.55,1.35,2.15&mapPadding=20" },
  { name: "ostfront-romania-black-sea", query: "mapBounds=0.15,-2.65,2.15,-0.85&mapPadding=20" },
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
