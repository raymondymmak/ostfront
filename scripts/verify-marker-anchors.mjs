import { chromium } from "playwright"

const base = process.env.MAP_URL ?? "http://127.0.0.1:3000"
const tolerance = Number(process.env.MARKER_TOLERANCE_PX ?? 3)

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader"],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(base, { waitUntil: "networkidle", timeout: 120000 })
await page.waitForSelector("[data-testid=war-map] .map-tag", { timeout: 30000 })
await page.waitForTimeout(1200)

async function offsets() {
  return page.evaluate(() => {
    const map = window.__ostfrontMap
    const canvas = map.getCanvas().getBoundingClientRect()
    return [...document.querySelectorAll(".map-tag")].map((el) => {
      const rect = el.getBoundingClientRect()
      const point = map.project([Number(el.dataset.lng), Number(el.dataset.lat)])
      return {
        id: el.dataset.province,
        dx: rect.left + rect.width / 2 - (canvas.left + point.x),
        dy: rect.top + rect.height / 2 - (canvas.top + point.y),
        width: rect.width,
      }
    })
  })
}

function report(label, rows) {
  const worst = rows.reduce(
    (best, row) => (Math.hypot(row.dx, row.dy) > Math.hypot(best.dx, best.dy) ? row : best),
    rows[0],
  )
  const wide = rows.filter((row) => row.width > 400)
  console.log(
    label,
    JSON.stringify({
      count: rows.length,
      worst: worst && { id: worst.id, dx: +worst.dx.toFixed(2), dy: +worst.dy.toFixed(2) },
      wide: wide.map((row) => row.id),
    }),
  )
  const off = rows.filter((row) => Math.abs(row.dx) > tolerance || Math.abs(row.dy) > tolerance || row.width > 400)
  if (off.length) {
    console.error(label, "detached", off.slice(0, 8))
    return false
  }
  return true
}

let ok = true
ok = report("initial", await offsets()) && ok

const warsaw = page.locator(".map-tag", { hasText: "Warsaw" }).first()
const box = await warsaw.boundingBox()
await page.mouse.click(box.x + box.width / 2, box.y + 6)
await page.waitForTimeout(700)
ok = report("after select", await offsets()) && ok

await page.getByRole("button", { name: "Close the fortnight" }).click()
await page.waitForTimeout(2000)
ok = report("after turn", await offsets()) && ok

const canvas = await page.locator(".maplibregl-canvas").boundingBox()
await page.mouse.move(canvas.x + canvas.width * 0.55, canvas.y + canvas.height * 0.4)
await page.mouse.down()
await page.mouse.move(canvas.x + canvas.width * 0.3, canvas.y + canvas.height * 0.65, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(500)
ok = report("after pan", await offsets()) && ok

await page.locator(".maplibregl-ctrl-zoom-in").click()
await page.waitForTimeout(400)
ok = report("after zoom", await offsets()) && ok

await browser.close()
if (!ok) process.exit(1)
