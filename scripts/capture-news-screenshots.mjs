import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"
import path from "node:path"

const outDir = path.join(process.cwd(), "demo-check-output", "news-pr")
const base = process.env.DEMO_URL ?? "http://127.0.0.1:3000"
const TURN_MS = 120_000

async function hideDevtools(page) {
  await page.addStyleTag({
    content: `
      [data-nextjs-toast], nextjs-portal,
      [data-next-badge-root], #devtools-indicator,
      .nextjs-toast, .vercel-toolbar { display: none !important; }
    `,
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
  await page.screenshot({ path: path.join(outDir, "news-card-photo.png"), fullPage: false })

  await page.keyboard.press("Enter")
  await page.waitForSelector('[data-testid="news-card-map"]', { timeout: 15_000 })
  await page.screenshot({ path: path.join(outDir, "news-card-map.png"), fullPage: false })

  await page.keyboard.press("Escape")

  const gameId = await page.evaluate(
    () => JSON.parse(localStorage.getItem("ostfront-1915-v1") ?? "{}").gameId,
  )
  if (!gameId) throw new Error("no gameId after begin")
  const controller = new AbortController()
  const turnTimer = setTimeout(() => controller.abort(), TURN_MS)
  const turnRes = await fetch(`${base.replace(/\/$/, "")}/api/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, expectedTurn: 0, orders: [] }),
    signal: controller.signal,
  })
  clearTimeout(turnTimer)
  if (!turnRes.ok) throw new Error(`turn HTTP ${turnRes.status}`)
  const turnPayload = await turnRes.json()
  if (!turnPayload.record) throw new Error("turn returned no record")
  await page.goto(`${base}/?newsDemo=1`, { waitUntil: "networkidle" })
  await page.waitForSelector("[data-testid=war-map]", { timeout: 60_000 })
  await hideDevtools(page)

  await page.getByTestId("chronicle-log-toggle").click()
  await page.waitForSelector('[data-testid="chronicle-routine"] li', { timeout: 15_000 })
  await hideDevtools(page)
  await page.screenshot({ path: path.join(outDir, "log-drawer-open.png"), fullPage: false })

  await browser.close()
  console.log("wrote", outDir)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})