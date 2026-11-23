/** Capture startup selection screenshots (campaign + teach). */
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
  await page.waitForTimeout(1500)
}

async function beginTeach(page) {
  await page.goto(withPath(BASE, "/teach"), { waitUntil: "domcontentloaded", timeout: 60_000 })
  await page.evaluate(() => sessionStorage.clear())
  await page.goto(withPath(BASE, "/teach"), { waitUntil: "domcontentloaded", timeout: 60_000 })
  await page.locator("[data-testid=teach-begin]").waitFor({ state: "visible", timeout: 60_000 })
  await page.locator("[data-testid=teach-begin]").click()
  await page.locator("[data-testid=teach-app]").waitFor({ state: "visible", timeout: 60_000 })
  await page.waitForTimeout(1500)
}

async function selectedId(page) {
  return page.evaluate(() => {
    const filter = window.__ostfrontMap?.getFilter?.("selected")
    return Array.isArray(filter) ? filter[2] : null
  })
}

async function shot(page, file) {
  const path = join(OUT, file)
  await page.screenshot({ path, fullPage: false })
  console.log("wrote", path)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

try {
  for (const { w, h } of [
    { w: 1440, h: 900 },
    { w: 390, h: 844 },
  ]) {
    await page.setViewportSize({ width: w, height: h })
    await beginCampaign(page)
    // Open Province so pre-fill (or empty prompt) is visible
    const provTab = page.locator("[data-testid=tab-province]")
    if (await provTab.isVisible().catch(() => false)) {
      const pressed = await provTab.getAttribute("aria-pressed")
      if (pressed != null) await provTab.click()
      else {
        await provTab.focus()
        await page.keyboard.press("Enter")
      }
      await page.waitForTimeout(400)
    }
    const sel = await selectedId(page)
    console.log(`campaign ${w}x${h} selected=`, sel)
    await shot(page, `startup-${TAG}-campaign-${w}x${h}.png`)

    await beginTeach(page)
    const teachSel = await selectedId(page)
    console.log(`teach ${w}x${h} selected=`, teachSel)
    await shot(page, `startup-${TAG}-teach-${w}x${h}.png`)
  }
} finally {
  await browser.close()
}
