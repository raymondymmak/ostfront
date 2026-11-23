/** Capture Part 7 tray UX screenshots — OHL under-tray fix + drag-first tray. */
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

async function dragPaperTowardTray(page, dialog, { release = true, edge = false } = {}) {
  const handle = dialog.locator("[data-testid=floating-window-drag-handle]")
  const tray = page.locator("[data-testid=document-tray]")
  const box = await handle.boundingBox()
  const trayBox = await tray.boundingBox()
  if (!box || !trayBox) throw new Error("missing handle/tray")
  const sx = box.x + Math.min(60, box.width / 2)
  const sy = box.y + 10
  const ex = trayBox.x + trayBox.width / 2
  // Prefer the tray edge so short papers (OHL) stay mostly on-screen while highlighting.
  const ey = edge ? trayBox.y + 2 : trayBox.y + 6
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(ex, ey, { steps: 14 })
  await page.waitForTimeout(120)
  if (release) {
    await page.mouse.up()
    await page.waitForTimeout(200)
  }
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

try {
  await page.setViewportSize({ width: 1440, height: 900 })
  await beginCampaign(page)

  const ohl = page.locator("[data-testid=ohl-orders-window]")
  await ohl.waitFor({ state: "visible", timeout: 10_000 })
  // File other papers first so the mid-drag OHL shot is uncluttered (keep OHL out).
  for (const label of ["Orders", "Legend"]) {
    const win = page.locator(`[role="dialog"][aria-label="${label}"]`)
    if (!(await win.isVisible().catch(() => false))) continue
    await win.locator("[data-testid=floating-window-drag-handle]").click().catch(() => {})
    await page.keyboard.press("Escape")
    await win.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {})
  }
  await ohl.waitFor({ state: "visible", timeout: 5_000 })
  await dragPaperTowardTray(page, ohl, { release: false })
  await page.waitForFunction(
    () =>
      document.querySelector("[data-testid=ohl-orders-window]")?.getAttribute("data-over-tray") === "true" ||
      document.querySelector("[data-testid=document-tray]")?.getAttribute("data-drop-active") === "true",
    null,
    { timeout: 5_000 },
  )
  await shot(page, "part7-ohl-mid-drag-tray-1440x900.png")
  await page.mouse.up()
  await page.waitForTimeout(250)
  await ohl.waitFor({ state: "hidden", timeout: 5_000 })
  await shot(page, "part7-ohl-filed-1440x900.png")

  // Take Orders out and drop at the tray edge.
  const ordersTab = page.locator("[data-testid=tab-orders]")
  if (await ordersTab.isVisible().catch(() => false)) {
    await ordersTab.focus()
    await page.keyboard.press("Enter")
    await page.waitForTimeout(200)
  }
  const orders = page.locator('[role="dialog"][aria-label="Orders"]')
  await orders.waitFor({ state: "visible", timeout: 10_000 })
  await dragPaperTowardTray(page, orders, { release: true, edge: true })
  await shot(page, "part7-orders-tray-edge-filed-1440x900.png")

  // Bottom-edge release: drag to clientY === viewport height, shoot mid-drag, then result.
  if (await ordersTab.isVisible().catch(() => false)) {
    await ordersTab.focus()
    await page.keyboard.press("Enter")
    await page.waitForTimeout(200)
  }
  await orders.waitFor({ state: "visible", timeout: 10_000 })
  {
    const handle = orders.locator("[data-testid=floating-window-drag-handle]")
    const box = await handle.boundingBox()
    if (!box) throw new Error("Orders handle missing for bottom-edge shot")
    const sx = box.x + Math.min(60, box.width / 2)
    const sy = box.y + 10
    const vpH = 900
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    await page.mouse.move(sx, vpH, { steps: 18 })
    await page.waitForTimeout(120)
    await shot(page, "part7-orders-bottom-edge-release-1440x900.png")
    await page.mouse.up()
    await page.waitForTimeout(250)
    await orders.waitFor({ state: "hidden", timeout: 5_000 })
    await shot(page, "part7-orders-bottom-edge-filed-1440x900.png")
  }

  // Viewport sweep: papers open at each size (campaign + teach phone).
  for (const vp of [
    { w: 1440, h: 900 },
    { w: 1280, h: 800 },
    { w: 1024, h: 768 },
  ]) {
    await page.setViewportSize({ width: vp.w, height: vp.h })
    await beginCampaign(page)
    await shot(page, `part7-campaign-papers-${vp.w}x${vp.h}.png`)
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await beginTeach(page)
  await shot(page, "part7-teach-390x844.png")
} finally {
  await browser.close()
}

console.log("done")
