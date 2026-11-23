/** Capture Part 7 tray UX screenshots for / and /teach. */
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

const BASE = process.env.DEMO_URL || "http://127.0.0.1:3456"
const OUT = process.env.OUT_DIR || "/opt/cursor/artifacts"
mkdirSync(OUT, { recursive: true })

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "390x844", width: 390, height: 844 },
]

async function beginCampaign(page) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" })
  await page.evaluate(() => {
    localStorage.removeItem("ostfront-1915-v1")
    sessionStorage.clear()
  })
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.locator("[data-testid=begin-scenario]").waitFor({ state: "visible", timeout: 60_000 })
  await page.locator("[data-testid=begin-scenario]").click()
  await page.locator("[data-testid=war-map]").waitFor({ state: "visible", timeout: 60_000 })
  await page.waitForTimeout(1200)
}

async function beginTeach(page) {
  await page.goto(`${BASE}/teach`, { waitUntil: "domcontentloaded" })
  await page.evaluate(() => sessionStorage.clear())
  await page.locator("[data-testid=teach-begin]").waitFor({ state: "visible", timeout: 60_000 })
  await page.locator("[data-testid=teach-begin]").click()
  await page.locator("[data-testid=teach-app]").waitFor({ state: "visible", timeout: 60_000 })
  await page.waitForTimeout(1200)
}

async function shot(page, file) {
  const path = join(OUT, file)
  await page.screenshot({ path, fullPage: false })
  console.log("wrote", path)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

try {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await beginCampaign(page)
    await shot(page, `part7-campaign-${vp.name}.png`)
    if (vp.width >= 1024) {
      // Stow open papers for a tray-only shot.
      for (const label of ["Orders", "Legend", "Orders from OHL"]) {
        const win = page.locator(`[role="dialog"][aria-label="${label}"]`)
        if (await win.isVisible().catch(() => false)) {
          await win.getByRole("button", { name: `Stow ${label}` }).click().catch(() => {})
          await page.waitForTimeout(200)
        }
      }
      await shot(page, `part7-campaign-tray-stowed-${vp.name}.png`)
    }
  }

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await beginTeach(page)
    await shot(page, `part7-teach-${vp.name}.png`)
    if (vp.width >= 1024) {
      for (const label of ["Lesson", "Orders", "Legend"]) {
        const win = page.locator(`[role="dialog"][aria-label="${label}"]`)
        if (await win.isVisible().catch(() => false)) {
          await win.getByRole("button", { name: `Stow ${label}` }).click().catch(() => {})
          await page.waitForTimeout(200)
        }
      }
      await shot(page, `part7-teach-tray-stowed-${vp.name}.png`)
    }
  }
} finally {
  await browser.close()
}

console.log("done")
