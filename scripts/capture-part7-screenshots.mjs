/** Capture Part 7 tray UX screenshots for / and /teach (drag-first tray). */
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

const BASE = process.env.DEMO_URL || "http://127.0.0.1:3456"
const OUT = process.env.OUT_DIR || "/opt/cursor/artifacts"
mkdirSync(OUT, { recursive: true })

function withPath(base, path) {
  const url = new URL(base)
  url.pathname = path
  return url.toString()
}

async function beginCampaign(page) {
  // Visit share URL first so protection cookies stick, then clear game storage
  // without dropping the share query (reload alone can lose Vercel share auth).
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

async function beginTeach(page) {
  await page.goto(withPath(BASE, "/teach"), { waitUntil: "domcontentloaded", timeout: 60_000 })
  await page.evaluate(() => sessionStorage.clear())
  await page.goto(withPath(BASE, "/teach"), { waitUntil: "domcontentloaded", timeout: 60_000 })
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

async function dragTowardTray(page, dialog, { release = true } = {}) {
  const handle = dialog.locator("[data-testid=floating-window-drag-handle]")
  const tray = page.locator("[data-testid=document-tray]")
  const box = await handle.boundingBox()
  const trayBox = await tray.boundingBox()
  if (!box || !trayBox) throw new Error("missing handle/tray")
  const sx = box.x + Math.min(60, box.width / 2)
  const sy = box.y + 10
  const ex = trayBox.x + trayBox.width / 2
  const ey = trayBox.y + trayBox.height / 2
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(ex, ey, { steps: 14 })
  await page.waitForTimeout(120)
  if (release) {
    await page.mouse.up()
    await page.waitForTimeout(200)
  }
}

async function fileAllViaEscape(page) {
  for (let i = 0; i < 8; i++) {
    const visible = await page
      .locator('[role="dialog"]')
      .evaluateAll((els) => els.filter((el) => el.getClientRects().length > 0).length)
    if (visible === 0) break
    await page.keyboard.press("Escape")
    await page.waitForTimeout(100)
  }
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

try {
  await page.setViewportSize({ width: 1440, height: 900 })
  await beginCampaign(page)
  await shot(page, "part7-feedback-papers-out-1440x900.png")

  // Mid-drag over highlighted tray (Orders).
  const orders = page.locator('[role="dialog"][aria-label="Orders"]')
  await orders.waitFor({ state: "visible", timeout: 10_000 })
  await dragTowardTray(page, orders, { release: false })
  await shot(page, "part7-feedback-drag-over-tray-1440x900.png")
  await page.mouse.up()
  await page.waitForTimeout(250)

  await fileAllViaEscape(page)
  await shot(page, "part7-feedback-all-filed-1440x900.png")

  await page.setViewportSize({ width: 390, height: 844 })
  await beginTeach(page)
  await shot(page, "part7-feedback-teach-390x844.png")
} finally {
  await browser.close()
}

console.log("done")
