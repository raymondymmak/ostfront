import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"
import path from "node:path"

const outDir = path.join(process.cwd(), "demo-check-output", "news-pr")
const base = process.env.DEMO_URL ?? "http://127.0.0.1:3000"

async function main() {
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

  await page.goto(`${base}/`, { waitUntil: "networkidle" })
  await page.getByTestId("begin-scenario").click({ timeout: 60000 })
  await page.waitForTimeout(500)

  await page.evaluate(() => {
    const setter = window.__ostfrontSetNewsQueue
    if (!setter) throw new Error("missing __ostfrontSetNewsQueue (run against next dev)")
    const queue = [
      {
        id: "demo-photo",
        kind: "cityTaken",
        provinceId: "lwow",
        provinceName: "Lemberg",
        faction: "central",
        headline: "Lemberg taken",
        lore: "Central Powers: Lemberg is Austrian soil again; the III Army's line is broken.",
        image: {
          type: "photo",
          key: "gorlice-column",
          credit: "IWM Q 55044 (demo)",
        },
        turn: 2,
      },
      {
        id: "demo-map",
        kind: "cityTaken",
        provinceId: "lwow",
        provinceName: "Lemberg",
        faction: "central",
        headline: "Lemberg taken",
        lore: "Central Powers: Garrison remnants fall back along the rail net.",
        image: {
          type: "map",
          provinceId: "lwow",
          arrowFrom: ["krakow", "kielce"],
          tone: "victory",
        },
        turn: 2,
      },
    ]
    setter(queue)
  })

  await page.waitForSelector('[data-testid="news-card-photo"]', { timeout: 10000 })
  await page.screenshot({ path: path.join(outDir, "news-card-photo.png") })

  await page.keyboard.press("Enter")
  await page.waitForSelector('[data-testid="news-card-map"]', { timeout: 10000 })
  await page.screenshot({ path: path.join(outDir, "news-card-map.png") })

  await page.keyboard.press("Escape")

  await page.evaluate(() => {
    const raw = localStorage.getItem("ostfront-1915-v1")
    if (!raw) return
    const save = JSON.parse(raw)
    save.log = [
      {
        turn: 0,
        date: "16 May 1915",
        narration: "Staff narrates the fortnight in full paragraphs that stay behind Details.",
        diplomacy: ["Vienna acknowledges the breakthrough."],
        resolutions: [{ proposal: { type: "move" }, status: "applied", summary: "Guard Corps holds the Dunajec." }],
        events: [],
        controlChanges: [{ provinceId: "lwow", name: "Lemberg", from: "russia", to: "central" }],
        logistics: [
          "Central Powers collect 4 manpower and 2 industry.",
          "Russia collect 3 manpower and 1 industry.",
          "Kraków drops below supply 30. Its formations cannot advance next fortnight.",
        ],
        notes: [],
        gmSource: "mock",
      },
    ]
    localStorage.setItem("ostfront-1915-v1", JSON.stringify(save))
  })
  await page.reload({ waitUntil: "networkidle" })

  await page.locator('[data-testid="chronicle"]').first().screenshot({
    path: path.join(outDir, "chronicle-compact.png"),
  })

  await browser.close()
  console.log("wrote", outDir)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})