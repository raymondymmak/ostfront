import { chromium } from "playwright"
import { copyFile, mkdir } from "node:fs/promises"
import path from "node:path"

const outDir = path.join(process.cwd(), "demo-check-output", "news-pr")
const base = process.env.DEMO_URL ?? "http://127.0.0.1:3000"
async function waitMapReady(page) {
  try {
    await page.waitForFunction(
      () => {
        const map = window.__ostfrontMap
        if (!map?.isStyleLoaded?.()) return false
        const feats = map.queryRenderedFeatures({ layers: ["provinces"] })
        return feats.length > 0
      },
      { timeout: 45_000 },
    )
  } catch {
    await page.waitForTimeout(3500)
  }
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const map = window.__ostfrontMap
        if (!map) {
          resolve()
          return
        }
        map.once("idle", () => resolve())
      }),
  )
}

async function hideDevtools(page) {
  await page.addStyleTag({
    content: `
      [data-nextjs-toast], nextjs-portal,
      [data-next-badge-root], [data-nextjs-dev-tools-button],
      #devtools-indicator, [data-nextjs-devtools],
      .nextjs-toast, .vercel-toolbar,
      button[aria-label="Open Next.js Dev Tools"],
      [class*="devIndicators"] { display: none !important; visibility: hidden !important; }
    `,
  })
  await page.evaluate(() => {
    for (const sel of ["nextjs-portal", "[data-next-badge-root]", "[data-nextjs-dev-tools-button]"]) {
      document.querySelectorAll(sel).forEach((el) => el.remove())
    }
  })
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await hideDevtools(page)

  await page.goto(`${base}/?newsDemo=1`, { waitUntil: "networkidle" })
  await page.getByTestId("begin-scenario").click({ timeout: 60_000 })
  await page.waitForSelector("[data-testid=war-map]", { timeout: 60_000 })
  await waitMapReady(page)
  await hideDevtools(page)

  await page.screenshot({ path: path.join(outDir, "map-full-height.png"), fullPage: false })

  await page.evaluate(() => {
    const setter = window.__ostfrontSetNewsQueue
    if (!setter) throw new Error("missing __ostfrontSetNewsQueue (use ?newsDemo=1)")
    setter([
      {
        id: "demo-photo",
        kind: "cityTaken",
        provinceId: "lwow",
        provinceName: "Lemberg",
        faction: "central",
        headline: "Lemberg taken",
        lore: "Central Powers: Lemberg is Austrian soil again; the III Army's line is broken.",
        image: { type: "photo", key: "gorlice-column", credit: "IWM Q 55044 (demo)" },
        turn: 1,
      },
      {
        id: "demo-map",
        kind: "objectiveTaken",
        provinceId: "lwow",
        provinceName: "Lemberg",
        faction: "central",
        headline: "Lemberg in our hands",
        lore: "Central Powers: Garrison remnants fall back along the rail net.",
        image: { type: "map", provinceId: "lwow", arrowFrom: ["krakow", "kielce"], tone: "victory" },
        turn: 1,
      },
    ])
  })

  await page.waitForSelector('[data-testid="news-card-photo"]', { timeout: 15_000 })
  await hideDevtools(page)
  await page.screenshot({ path: path.join(outDir, "news-card-photo.png"), fullPage: false })

  await page.keyboard.press("Enter")
  await page.waitForSelector('[data-testid="news-card-map"]', { timeout: 15_000 })
  await hideDevtools(page)
  await page.screenshot({ path: path.join(outDir, "news-card-map.png"), fullPage: false })

  await page.keyboard.press("Escape")

  await page.evaluate(() => {
    const key = "ostfront-1915-v1"
    const save = JSON.parse(localStorage.getItem(key) ?? "{}")
    if (!save.gameId) throw new Error("no gameId after begin")
    save.log = [
      {
        turn: 1,
        date: "18 May 1915",
        narration: "The front shifts after Gorlice.",
        diplomacy: [],
        resolutions: [],
        events: [],
        controlChanges: [],
        logistics: [
          "Kraków: 200 strength exceeds supply capacity 120",
          "Central Powers collect 2 manpower and 1 industry.",
          "Russia collect 1 manpower and 0 industry.",
        ],
        notes: [],
        gmSource: "mock",
      },
      {
        turn: 0,
        date: "2 May 1915",
        narration: "The campaign opens.",
        diplomacy: [],
        resolutions: [],
        events: [],
        controlChanges: [],
        logistics: ["Central Powers collect 4 manpower and 2 industry."],
        notes: [],
        gmSource: "mock",
      },
    ]
    localStorage.setItem(key, JSON.stringify(save))
  })
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForSelector("[data-testid=war-map]", { timeout: 60_000 })
  await waitMapReady(page)
  await hideDevtools(page)

  await page.getByTestId("chronicle-log-toggle").click()
  await page.waitForSelector('[data-testid="chronicle-routine"] li', { timeout: 30_000 })
  await hideDevtools(page)
  await page.screenshot({ path: path.join(outDir, "log-drawer-open.png"), fullPage: false })

  const artifactDir = "/opt/cursor/artifacts/news-pr"
  await mkdir(artifactDir, { recursive: true })
  for (const name of [
    "map-full-height.png",
    "news-card-photo.png",
    "news-card-map.png",
    "log-drawer-open.png",
  ]) {
    await copyFile(path.join(outDir, name), path.join(artifactDir, name)).catch(() => {})
  }

  await browser.close()
  console.log("wrote", outDir, "and", artifactDir)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})