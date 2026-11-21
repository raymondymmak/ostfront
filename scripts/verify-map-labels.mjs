import { chromium } from "playwright"

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader"],
})
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto("http://127.0.0.1:4179", { waitUntil: "networkidle", timeout: 60000 })
await page.waitForSelector("[data-testid=war-map]", { timeout: 30000 })
await page.waitForTimeout(1500)
await page.screenshot({ path: "/tmp/map-before-pan.png", fullPage: false })
const zoomIn = page.locator(".maplibregl-ctrl-zoom-in")
if (await zoomIn.count()) {
  await zoomIn.click({ force: true })
  await zoomIn.click({ force: true })
}
await page.waitForTimeout(400)
const canvas = page.locator(".maplibregl-canvas")
const box = await canvas.boundingBox()
if (box) {
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.35)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.65, { steps: 16 })
  await page.mouse.up()
}
await page.waitForTimeout(900)
await page.screenshot({ path: "/tmp/map-after-pan.png", fullPage: false })
const overlap = await page.evaluate(() => {
  const map = document.querySelector("[data-testid=war-map]")
  if (!map) return { ok: false, reason: "missing map" }
  const markers = document.querySelectorAll(".maplibregl-marker")
  if (markers.length) {
    return { ok: false, reason: "html_markers_present", markerCount: markers.length }
  }
  const mapgl = window.__ostfrontMap
  if (!mapgl) return { ok: false, reason: "missing map ref" }
  const features = mapgl.queryRenderedFeatures(undefined, { layers: ["province-labels"] })
  const offenders = features.filter((feature) => {
    const el = mapgl.getCanvas().getBoundingClientRect()
    const coords = feature.geometry?.coordinates
    if (!coords) return false
    const projected = mapgl.project(coords)
    return projected.y > el.height + 2 || projected.y < -2
  })
  return {
    ok: offenders.length === 0,
    offenders: offenders.length,
    labelCount: features.length,
  }
})
console.log(JSON.stringify(overlap))
await browser.close()
if (!overlap.ok) process.exit(1)