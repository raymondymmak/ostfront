import { chromium } from "playwright"
import { mkdirSync } from "node:fs"

const base = process.env.MAP_URL ?? "http://127.0.0.1:3000"
const outDir = "/opt/cursor/artifacts/screenshots"
const TARNOW = [21.0, 50.01]
mkdirSync(outDir, { recursive: true })

async function projectOnMap(page, lon, lat) {
  return page.evaluate(
    ([longitude, latitude]) => {
      const map = window.__ostfrontMap
      if (!map) return null
      const projected = map.project([longitude, latitude])
      const rect = map.getCanvas().getBoundingClientRect()
      return { x: rect.left + projected.x, y: rect.top + projected.y }
    },
    [lon, lat],
  )
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

await capture("map-desktop-1440x900", 1440, 900)
await capture("map-portrait-390x844", 390, 844)
await capture("map-desktop-selection-tarnow", 1440, 900, async (page) => {
  const point = await projectOnMap(page, TARNOW[0], TARNOW[1])
  if (!point) return
  await page.mouse.click(point.x, point.y)
  await page.waitForTimeout(600)
})
await capture("map-desktop-1914-backdrop", 1440, 900, async (page) => {
  await page.evaluate(() => {
    const map = window.__ostfrontMap
    if (!map) return
    map.fitBounds(
      [
        [9.0, 46.75],
        [32.0, 57.35],
      ],
      { padding: 24, duration: 0 },
    )
  })
  await page.waitForTimeout(1200)
})
await capture("map-desktop-east-prussia", 1440, 900, async (page) => {
  const point = await projectOnMap(page, 20.45, 54.72)
  if (!point) return
  const { x, y } = point
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
