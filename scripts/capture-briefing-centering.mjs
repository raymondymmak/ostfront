/**
 * Local smoke: assert start-card control insets at 390×844 and save screenshots.
 * Usage: node scripts/capture-briefing-centering.mjs [baseUrl]
 */
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

const baseUrl = process.argv[2] ?? "http://127.0.0.1:3000"
const outDir = process.argv[3] ?? "/opt/cursor/artifacts"
mkdirSync(outDir, { recursive: true })

const sizes = [
  { name: "briefing-390x844", width: 390, height: 844, assertCenter: true },
  { name: "briefing-375x667", width: 375, height: 667, assertCenter: true },
  { name: "briefing-1440x900", width: 1440, height: 900, assertCenter: true },
]

async function measure(page) {
  return page.evaluate(() => {
    const card = document.querySelector("[data-testid=campaign-start-card]")
    const difficulty = document.querySelector("[data-testid=difficulty]")
    const actions = document.querySelector("[data-testid=campaign-start-actions]")
    if (!card || !difficulty || !actions) {
      return { ok: false, reason: "missing card/controls" }
    }
    const cardRect = card.getBoundingClientRect()
    const rows = [difficulty, actions].map((el) => {
      const rect = el.getBoundingClientRect()
      const left = rect.left - cardRect.left
      const right = cardRect.right - rect.right
      return {
        left,
        right,
        delta: Math.abs(left - right),
        width: rect.width,
      }
    })
    return { ok: rows.every((row) => row.delta <= 1), rows, cardWidth: cardRect.width }
  })
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
})

for (const size of sizes) {
  const page = await browser.newPage({ viewport: { width: size.width, height: size.height } })
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await page.evaluate(() => {
    localStorage.removeItem("ostfront-1915-v1")
    sessionStorage.removeItem("ostfront-advisor-v1")
  })
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForSelector("[data-testid=campaign-start-card]", { timeout: 30_000 })
  await page.waitForTimeout(300)
  const stats = await measure(page)
  console.log(`${size.name}:`, JSON.stringify(stats))
  if (size.assertCenter && !stats.ok) {
    await browser.close()
    throw new Error(`${size.name} controls not centered: ${JSON.stringify(stats)}`)
  }
  const path = join(outDir, `${size.name}.png`)
  await page.screenshot({ path, fullPage: false })
  console.log(`wrote ${path}`)
  await page.close()
}

await browser.close()
console.log("ok")
