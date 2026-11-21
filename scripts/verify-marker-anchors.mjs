import { chromium } from "playwright"

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader"],
})
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto("http://127.0.0.1:4179", { waitUntil: "networkidle", timeout: 60000 })
await page.waitForSelector("[data-testid=war-map]", { timeout: 30000 })
await page.waitForTimeout(2200)

const anchors = await page.evaluate(() => {
  const map = window.__ostfrontMap
  if (!map) return { ok: false, reason: "missing map" }
  const labels = map.queryRenderedFeatures(undefined, { layers: ["province-labels"] })
  const counters = map.queryRenderedFeatures(undefined, { layers: ["province-counters"] })
  return {
    ok: labels.length >= 30,
    labels: labels.length,
    counters: counters.length,
    sample: labels.slice(0, 5).map((feature) => ({
      id: feature.properties?.id,
      name: feature.properties?.name,
      coordinates: feature.geometry?.coordinates,
    })),
  }
})
console.log(JSON.stringify(anchors, null, 2))

const warsaw = await page.evaluate(() => {
  const map = window.__ostfrontMap
  if (!map) return null
  const matches = map.queryRenderedFeatures(undefined, { layers: ["province-labels"] }).filter((feature) =>
    String(feature.properties?.name ?? "").includes("Warsaw"),
  )
  return matches[0]?.geometry?.coordinates ?? null
})
if (warsaw) {
  const canvas = await page.locator(".maplibregl-canvas").boundingBox()
  if (canvas) {
    const projected = await page.evaluate(
      (coords) => window.__ostfrontMap?.project(coords),
      warsaw,
    )
    const px = { x: canvas.x + projected.x, y: canvas.y + projected.y }
    await page.mouse.click(px.x, px.y)
    await page.waitForTimeout(500)
  }
}

await browser.close()
if (!anchors.ok) process.exit(1)