/** Capture Chief-of-Staff tray screenshots (campaign desktop + phone). */
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

const BASE = process.env.DEMO_URL || "http://127.0.0.1:3456"
const OUT = process.env.OUT_DIR || "/opt/cursor/artifacts"
const TAG = process.env.SHOT_TAG || "before"
mkdirSync(OUT, { recursive: true })

function withPath(base, path) {
  const url = new URL(base)
  url.pathname = path
  return url.toString()
}

async function beginCampaign(page) {
  await page.goto(withPath(BASE, "/"), { waitUntil: "domcontentloaded", timeout: 60_000 })
  await page.evaluate(() => {
    localStorage.removeItem("ostfront-1915-v1")
    sessionStorage.clear()
  })
  await page.goto(withPath(BASE, "/"), { waitUntil: "domcontentloaded", timeout: 60_000 })
  await page.locator("[data-testid=begin-scenario]").waitFor({ state: "visible", timeout: 60_000 })
  await page.locator("[data-testid=begin-scenario]").click()
  await page.locator("[data-testid=war-map]").waitFor({ state: "visible", timeout: 60_000 })
  await page.waitForTimeout(1200)
}

async function shot(page, file) {
  const path = join(OUT, file)
  await page.screenshot({ path, fullPage: false })
  console.log("wrote", path)
}

async function restoreAdvisorDesktop(page) {
  const tab = page.locator("[data-testid=advisor-toggle]")
  if (await tab.count()) {
    // Desktop: Enter on focused stowed tab, or drag up. Prefer click+Enter.
    await tab.focus()
    await page.keyboard.press("Enter")
    await page.waitForTimeout(500)
  }
  const paper = page.locator('[role="dialog"][aria-label="Chief of Staff"]')
  if (await paper.isVisible().catch(() => false)) return true
  // Fallback: try restore via evaluation of tray restore is not available; drag up
  const box = await tab.boundingBox()
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y - 180, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(500)
  }
  return paper.isVisible().catch(() => false)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

try {
  // Desktop 1440
  await page.setViewportSize({ width: 1440, height: 900 })
  await beginCampaign(page)
  // Stow advisor if somehow open; capture tray with tab visible
  await page.keyboard.press("Escape")
  await page.waitForTimeout(200)
  // Ensure advisor is stowed so tab shows
  const advisorDialog = page.locator('[role="dialog"][aria-label="Chief of Staff"]')
  if (await advisorDialog.isVisible().catch(() => false)) {
    await advisorDialog.locator("[data-testid=floating-window-drag-handle]").click()
    await page.keyboard.press("Escape")
    await page.waitForTimeout(300)
  }
  await shot(page, `cos-${TAG}-campaign-1440x900-tray.png`)
  const opened = await restoreAdvisorDesktop(page)
  console.log("desktop advisor open", opened)
  await shot(page, `cos-${TAG}-campaign-1440x900-open.png`)

  // Phone 390
  await page.setViewportSize({ width: 390, height: 844 })
  await beginCampaign(page)
  await shot(page, `cos-${TAG}-campaign-390x844-tray.png`)
  const phoneTab = page.locator("[data-testid=advisor-toggle]")
  if (await phoneTab.count()) {
    await phoneTab.click()
    await page.waitForTimeout(400)
  } else {
    // before: button in HUD
    const hudBtn = page.getByRole("button", { name: "Chief of Staff" })
    if (await hudBtn.count()) await hudBtn.click()
    await page.waitForTimeout(400)
  }
  await shot(page, `cos-${TAG}-campaign-390x844-open.png`)

  // teach quick check (should not have CoS)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(withPath(BASE, "/teach"), { waitUntil: "domcontentloaded" })
  await page.evaluate(() => sessionStorage.clear())
  await page.goto(withPath(BASE, "/teach"), { waitUntil: "domcontentloaded" })
  await page.locator("[data-testid=teach-begin]").click()
  await page.locator("[data-testid=teach-app]").waitFor({ state: "visible" })
  await page.waitForTimeout(800)
  const teachHas = await page.locator("[data-testid=advisor-toggle]").count()
  console.log("teach advisor-toggle count", teachHas)
  await shot(page, `cos-${TAG}-teach-1440x900.png`)
} finally {
  await browser.close()
}
