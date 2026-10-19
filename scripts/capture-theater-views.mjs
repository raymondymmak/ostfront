import { chromium } from "playwright"
import { mkdirSync } from "node:fs"

const base = process.env.MAP_URL ?? "http://127.0.0.1:3000"
const outDir = "/opt/cursor/artifacts/screenshots"
mkdirSync(outDir, { recursive: true })

const views = [
  {
    name: "ostfront-full-theater",
    query: "mapBounds=9,43.2,34.2,58&mapPadding=16",
  },
  {
    name: "ostfront-east-prussia",
    query: "mapBounds=19.2,53.9,22.8,55.4&mapPadding=28",
  },
  {
    name: "ostfront-galicia",
    query: "mapBounds=19.5,49.2,25.2,50.8&mapPadding=24",
  },
  {
    name: "ostfront-congress-poland",
    query: "mapBounds=17.5,50.8,24.5,53.2&mapPadding=24",
  },
]

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader"],
})

for (const view of views) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const url = `${base}?${view.query}`
  await page.goto(url, { waitUntil: "networkidle", timeout: 120000 })
  await page.waitForSelector("[data-testid=war-map]", { timeout: 30000 })
  await page.waitForTimeout(3500)
  const path = `${outDir}/${view.name}.png`
  await page.screenshot({ path })
  console.log(path)
  await page.close()
}

await browser.close()
