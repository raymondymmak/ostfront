/** Capture HUD screenshots at required viewports (campaign + /teach). */
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

const BASE = process.env.DEMO_URL || "http://127.0.0.1:3456"
const OUT = process.env.OUT_DIR || "/opt/cursor/artifacts"
const TAG = process.env.SHOT_TAG || "before"
mkdirSync(OUT, { recursive: true })

const VIEWPORTS = [
  { w: 1440, h: 900 },
  { w: 1280, h: 800 },
  { w: 1024, h: 768 },
  { w: 390, h: 844 },
]

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

async function measureHud(page) {
  return page.evaluate(() => {
    const header = document.querySelector("header.table-hud") || document.querySelector("header")
    if (!header) return null
    const r = header.getBoundingClientRect()
    return { height: Math.round(r.height), width: Math.round(r.width) }
  })
}

async function shot(page, file) {
  const path = join(OUT, file)
  await page.screenshot({ path, fullPage: false })
  console.log("wrote", path)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const heights = {}

try {
  for (const { w, h } of VIEWPORTS) {
    await page.setViewportSize({ width: w, height: h })
    await beginCampaign(page)
    const m = await measureHud(page)
    heights[`campaign_${w}x${h}`] = m
    console.log(`campaign ${w}x${h} hud`, m)
    await shot(page, `hud-${TAG}-campaign-${w}x${h}.png`)

    // Open options menu on one viewport when present
    if (TAG === "after" && w === 1440) {
      const opts = page.locator("[data-testid=hud-options]")
      if (await opts.count()) {
        await opts.click()
        await page.waitForTimeout(300)
        await shot(page, `hud-${TAG}-campaign-${w}x${h}-options-open.png`)
        await page.keyboard.press("Escape")
      }
    }

    await beginTeach(page)
    const mt = await measureHud(page)
    heights[`teach_${w}x${h}`] = mt
    console.log(`teach ${w}x${h} hud`, mt)
    await shot(page, `hud-${TAG}-teach-${w}x${h}.png`)

    if (TAG === "after" && w === 1280) {
      const opts = page.locator("[data-testid=hud-options]")
      if (await opts.count()) {
        await opts.click()
        await page.waitForTimeout(300)
        await shot(page, `hud-${TAG}-teach-${w}x${h}-options-open.png`)
        await page.keyboard.press("Escape")
      }
    }
  }
  console.log("HEIGHTS_JSON", JSON.stringify(heights))
} finally {
  await browser.close()
}
