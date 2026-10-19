import { chromium } from "playwright"
import { mkdirSync } from "node:fs"

const base = process.env.MAP_URL ?? "http://127.0.0.1:3000"
const outDir = "/opt/cursor/artifacts/screenshots"
const THEATER_BBOX = [15.8, 48.35, 28.8, 56.35]
const TARNOW = [21.0, 50.01]
mkdirSync(outDir, { recursive: true })

function lngLatToCanvasPoint(lon, lat, box, padding = 32) {
  const [minLon, minLat, maxLon, maxLat] = THEATER_BBOX
  const width = box.width - padding * 2
  const height = box.height - padding * 2
  const x = box.x + padding + ((lon - minLon) / (maxLon - minLon)) * width
  const y = box.y + padding + ((maxLat - lat) / (maxLat - minLat)) * height
  return { x, y }
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader"],
})

async function capture(name, width, height, after) {
  const page = await browser.newPage({ viewport: { width, height } })
  await page.goto(base, { waitUntil: "networkidle", timeout: 90000 })
  await page.waitForSelector("[data-testid=war-map]", { timeout: 30000 })
  await page.waitForTimeout(3200)
  if (after) await after(page)
  await page.screenshot({ path: `${outDir}/${name}.png` })
  await page.close()
}

async function mapCanvas(page) {
  const canvas = page.locator(".maplibregl-canvas")
  await canvas.waitFor({ state: "visible", timeout: 30000 })
  return canvas.boundingBox()
}

await capture("map-desktop-1440x900", 1440, 900)
await capture("map-portrait-390x844", 390, 844)
await capture("map-desktop-selection-tarnow", 1440, 900, async (page) => {
  const box = await mapCanvas(page)
  if (!box) return
  const { x, y } = lngLatToCanvasPoint(TARNOW[0], TARNOW[1], box)
  await page.mouse.click(x, y)
  await page.waitForTimeout(600)
})
await capture("map-desktop-east-prussia", 1440, 900, async (page) => {
  const box = await mapCanvas(page)
  if (!box) return
  const { x, y } = lngLatToCanvasPoint(20.45, 54.72, box)
  await page.mouse.move(x, y)
  for (let i = 0; i < 3; i++) {
    await page.mouse.click(x, y, { clickCount: 2 })
    await page.waitForTimeout(350)
  }
  await page.waitForTimeout(900)
})

const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
await page.goto(base, { waitUntil: "networkidle", timeout: 90000 })
await page.waitForSelector("[data-testid=war-map]", { timeout: 30000 })
await page.waitForTimeout(2800)
const anchor = await page.evaluate(() => {
  const map = document.querySelector(".maplibregl-map")
  const war = document.querySelector("[data-testid=war-map]")
  const legendBtn = document.querySelector('[aria-expanded]')
  return {
    mapHeight: map?.getBoundingClientRect().height ?? 0,
    warHeight: war?.getBoundingClientRect().height ?? 0,
    legendCollapsed: legendBtn?.getAttribute("aria-expanded") === "false",
  }
})
console.log(JSON.stringify(anchor))
await browser.close()
