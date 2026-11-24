/**
 * Playwright smoke path for QA and coding agents.
 *
 * DEMO_URL=https://… npm run demo-check
 * Optional flags: --continue --allow-fallback --force-fail
 * Avoid `--url` with share tokens (npm logs the command line); use DEMO_URL instead.
 * Exit 0 when all executed steps pass; skipped steps exit 0 only with --allow-fallback.
 * Login / protection / deployment-not-found / DNS errors abort immediately (even with --continue).
 */
import { chromium } from "playwright"
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs"
import { join } from "node:path"
import { configureRedaction, redactSensitiveText, redactUrl } from "./demo-check-redact.mjs"

const PRODUCTION_URL = "https://raymondymmak-ostfront.vercel.app"
const OUT_DIR = "demo-check-output"
const DESKTOP_VIEWPORT = { width: 1440, height: 900 }
const MOBILE_VIEWPORT = { width: 390, height: 844 }
const MAP_SETTLE_MS = 3200
const TURN_TIMEOUT_MS = 140_000
const ADVISOR_TIMEOUT_MS = 45_000
const KATOWICE_LON_LAT = [-0.375, -0.48]
const KRAKOW_LON_LAT = [-0.022, -0.632]
const KIELCE_LON_LAT = [-0.113, -0.385]

function parseCli(argv) {
  const flags = {
    continueOnFail: false,
    allowFallback: false,
    forceFail: false,
    url: null,
    explicitTarget: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--continue") flags.continueOnFail = true
    else if (arg === "--allow-fallback") flags.allowFallback = true
    else if (arg === "--force-fail") flags.forceFail = true
    else if (arg === "--url" && argv[i + 1]) {
      flags.url = argv[++i]
      flags.explicitTarget = true
      if (
        flags.url.includes("_vercel_share=") ||
        /x-vercel-protection-bypass=/i.test(flags.url)
      ) {
        console.warn(
          "WARNING: --url can expose share or bypass tokens in npm logs. Prefer DEMO_URL=… npm run demo-check instead.",
        )
      }
    }
  }
  if (process.env.DEMO_FORCE_FAIL === "1" || process.env.DEMO_FORCE_FAIL === "true") {
    flags.forceFail = true
  }
  let displayUrl = flags.url ?? process.env.DEMO_URL ?? null
  if (displayUrl) {
    flags.explicitTarget = true
  } else {
    console.warn(
      `WARNING: No DEMO_URL or --url set; testing production ${PRODUCTION_URL}. Agents should pass their preview URL.`,
    )
    displayUrl = PRODUCTION_URL
  }
  return { ...flags, displayUrl }
}

function shareTokenFromUrl(raw) {
  try {
    return new URL(raw).searchParams.get("_vercel_share")
  } catch {
    return null
  }
}

function resolveTargets(raw) {
  const parsed = new URL(raw)
  const appUrl = `${parsed.origin}${parsed.pathname || "/"}`
  const shareEntryUrl = parsed.searchParams.has("_vercel_share") ? parsed.href : null
  return { appUrl, shareEntryUrl }
}

function vercelBypassHeaders() {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim()
  if (!secret) return null
  return {
    "x-vercel-protection-bypass": secret,
    "x-vercel-set-bypass-cookie": "true",
  }
}

async function assertReachable(page) {
  const href = page.url()
  if (href.includes("vercel.com/login")) {
    throw new Error(
      "Preview is protected; set VERCEL_AUTOMATION_BYPASS_SECRET or a share URL in DEMO_URL.",
    )
  }
  const title = (await page.title()) ?? ""
  if (/log in to vercel/i.test(title)) {
    throw new Error(
      "Preview is protected; set VERCEL_AUTOMATION_BYPASS_SECRET or a share URL in DEMO_URL.",
    )
  }
  const body = (await page.textContent("body")) ?? ""
  if (/log in to vercel/i.test(body)) {
    throw new Error(
      "Preview is protected; set VERCEL_AUTOMATION_BYPASS_SECRET or a share URL in DEMO_URL.",
    )
  }
  if (body.includes("DEPLOYMENT_NOT_FOUND") || body.includes("The deployment could not be found")) {
    throw new Error("Deployment not found at this URL.")
  }
  if (/deployment has failed/i.test(body) || /deployment has failed/i.test(title)) {
    throw new Error("Vercel deployment failed at this URL (fix the build and redeploy).")
  }
  if (body.includes("Protected by Vercel Authentication")) {
    throw new Error(
      "Preview is protected; set VERCEL_AUTOMATION_BYPASS_SECRET or a share URL in DEMO_URL.",
    )
  }
}

/** @param {unknown} err */
function isFatalStepError(err) {
  const message = err instanceof Error ? err.message : String(err)
  return (
    message.includes("Preview is protected") ||
    message.includes("Deployment not found") ||
    message.includes("Vercel deployment failed") ||
    /HTTP [45]\d{2} loading/i.test(message) ||
    /ERR_NAME_NOT_RESOLVED/i.test(message) ||
    /getaddrinfo\s+ENOTFOUND/i.test(message) ||
    /ENOTFOUND/i.test(message)
  )
}

/** @param {import('playwright').Page} page @param {string} url */
async function gotoChecked(page, url) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 })
  const status = response?.status() ?? 0
  if (status >= 400) {
    throw new Error(`HTTP ${status} loading ${redactUrl(url)}`)
  }
  await assertReachable(page)
}

/** @param {import('playwright').Page} page @param {{ appUrl: string, shareEntryUrl: string | null }} targets */
async function openApplication(page, targets) {
  if (targets.shareEntryUrl) {
    await gotoChecked(page, targets.shareEntryUrl)
  }
  const current = new URL(page.url())
  const target = new URL(targets.appUrl)
  const onAppPath =
    current.origin === target.origin &&
    current.pathname === target.pathname &&
    !current.search &&
    !current.hash
  if (!onAppPath) {
    await gotoChecked(page, targets.appUrl)
  }
}

async function projectOnMap(page, lon, lat) {
  return page.evaluate(
    ([longitude, latitude]) => {
      const map = window.__ostfrontMap
      if (!map) return null
      const projected = map.project([longitude, latitude])
      const rect = map.getCanvas().getBoundingClientRect()
      return { x: rect.left + projected.x, y: rect.top + projected.y }
    },
    [lon, lat],
  )
}

/** @param {import('playwright').Page} page */
async function krakowIsSelected(page) {
  return page.evaluate(() => {
    const map = window.__ostfrontMap
    if (!map?.getFilter) return false
    const filter = map.getFilter("selected")
    return Array.isArray(filter) && filter[2] === "krakow"
  })
}

/**
 * Ensure Kraków is selected without toggling it off.
 * A second click on an already-selected province clears selection.
 * @param {import('playwright').Page} page
 */
/** Drag a floating paper's header into the document tray to file it. */
async function dragPaperIntoTray(page, dialog) {
  const handle = dialog.locator("[data-testid=floating-window-drag-handle]")
  const tray = page.locator("[data-testid=document-tray]")
  await handle.waitFor({ state: "visible", timeout: 5_000 })
  await tray.waitFor({ state: "visible", timeout: 5_000 })
  const box = await handle.boundingBox()
  const trayBox = await tray.boundingBox()
  if (!box || !trayBox) throw new Error("Missing paper handle or tray for drag-to-file")
  const startX = box.x + Math.min(60, box.width / 2)
  const startY = box.y + Math.min(10, box.height / 2)
  const endX = trayBox.x + trayBox.width / 2
  const endY = trayBox.y + trayBox.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(endX, endY, { steps: 12 })
  await page.waitForTimeout(80)
  await page.mouse.up()
  await page.waitForTimeout(150)
}

/**
 * Take a stowed tray tab out.
 * Desktop: Enter on the focused tab (no click-to-toggle).
 * Phone tray (aria-pressed): click still swaps the stacked panel.
 * No-op when the tab is already absent (paper is out).
 */
async function restoreTrayTab(page, testId) {
  const tab = page.locator(`[data-testid=${testId}]`)
  if (!(await tab.isVisible().catch(() => false))) return
  const pressed = await tab.getAttribute("aria-pressed")
  if (pressed != null) {
    await tab.click()
    await page.waitForTimeout(120)
    return
  }
  await tab.focus()
  await page.keyboard.press("Enter")
  await page.waitForTimeout(150)
}

/** File a desktop floating Province window so it cannot swallow map clicks. */
async function closeFloatingProvinceIfOpen(page) {
  const win = page.locator('[role="dialog"][aria-label="Province"]')
  if (!(await win.isVisible().catch(() => false))) return
  // Raise Province (phone tray click or focus) then Escape / drag into tray.
  const tab = page.locator("[data-testid=tab-province]")
  if (await tab.isVisible().catch(() => false)) {
    await tab.focus().catch(() => {})
  }
  await win.locator("[data-testid=floating-window-drag-handle]").click({ timeout: 3_000 }).catch(() => {})
  await page.keyboard.press("Escape")
  await win.waitFor({ state: "hidden", timeout: 3_000 }).catch(async () => {
    await dragPaperIntoTray(page, win)
    await win.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {})
  })
}

/** File open parchment papers that commonly cover western/central map clicks. */
async function stowPapersForMapClick(page) {
  // Escape files the topmost open paper (desktop shell); repeat until the map is clear.
  for (let i = 0; i < 8; i++) {
    const visible = await page
      .locator('[role="dialog"]')
      .evaluateAll((els) => els.filter((el) => el.getClientRects().length > 0).length)
    if (visible === 0) break
    await page.keyboard.press("Escape")
    await page.waitForTimeout(120)
  }
}

async function selectKrakowOnMap(page) {
  await stowPapersForMapClick(page)
  if (!(await krakowIsSelected(page))) {
    const point = await projectOnMap(page, KRAKOW_LON_LAT[0], KRAKOW_LON_LAT[1])
    if (!point) throw new Error("Map projection unavailable (__ostfrontMap missing).")
    await page.mouse.click(point.x, point.y)
    await page.waitForTimeout(400)
  }
  await restoreTrayTab(page, "tab-province")
  const provinceRoot = page.locator("[data-testid=province-window], aside").first()
  await provinceRoot.waitFor({ state: "visible", timeout: 10_000 })
  const title = provinceRoot.locator("h2").filter({ hasText: "Kraków" }).first()
  await title.waitFor({ state: "attached", timeout: 10_000 })
  await title.scrollIntoViewIfNeeded()
  await title.waitFor({ state: "visible", timeout: 10_000 })
}

async function expectText(locator, snippet) {
  await locator.getByText(snippet, { exact: false }).first().waitFor({ state: "visible", timeout: 15_000 })
}

/** @param {import('playwright').Page} page @param {string} aSel @param {string} bSel @param {string} label */
async function assertNoOverlap(page, aSel, bSel, label) {
  const result = await page.evaluate(
    ({ first, second }) => {
      const a = document.querySelector(first)
      const b = document.querySelector(second)
      if (!a || !b) return { ok: false, reason: `missing ${!a ? first : second}` }
      const ra = a.getBoundingClientRect()
      const rb = b.getBoundingClientRect()
      if (ra.width < 1 || ra.height < 1 || rb.width < 1 || rb.height < 1) {
        return { ok: false, reason: "zero-size rect" }
      }
      const hit = !(ra.right <= rb.left || ra.left >= rb.right || ra.bottom <= rb.top || ra.top >= rb.bottom)
      return { ok: !hit, reason: hit ? "rects overlap" : "clear" }
    },
    { first: aSel, second: bSel },
  )
  if (!result.ok) throw new Error(`${label}: ${result.reason}`)
}

/**
 * Start-card controls must share equal left/right insets inside the parchment card
 * (catches max-w without mx-auto / left-flush flex blocks under text-center).
 * @param {import('playwright').Page} page
 * @param {number} [tolerancePx]
 */
async function assertBriefingControlsCentered(page, tolerancePx = 1) {
  const result = await page.evaluate(
    ({ cardSel, controlSels, tol }) => {
      const card = document.querySelector(cardSel)
      if (!card) return { ok: false, reason: `missing ${cardSel}` }
      const cardRect = card.getBoundingClientRect()
      /** @type {{ sel: string, left: number, right: number, delta: number }[]} */
      const rows = []
      for (const sel of controlSels) {
        const el = document.querySelector(sel)
        if (!el) return { ok: false, reason: `missing ${sel}` }
        const rect = el.getBoundingClientRect()
        if (rect.width < 1 || rect.height < 1) return { ok: false, reason: `zero-size ${sel}` }
        const left = rect.left - cardRect.left
        const right = cardRect.right - rect.right
        const delta = Math.abs(left - right)
        rows.push({ sel, left, right, delta })
        if (delta > tol) {
          return {
            ok: false,
            reason: `${sel}: left ${left.toFixed(2)}px vs right ${right.toFixed(2)}px (Δ ${delta.toFixed(2)} > ${tol})`,
            rows,
          }
        }
      }
      const shell = document.querySelector("[data-testid=scenario-picker]")
      const main = shell?.querySelector("main")
      if (!shell || !main) return { ok: false, reason: "missing scenario-picker main", rows }
      const shellRect = shell.getBoundingClientRect()
      const mainRect = main.getBoundingClientRect()
      const cardCenterX = (cardRect.left + cardRect.right) / 2
      const shellCenterX = (shellRect.left + shellRect.right) / 2
      const cardCenterY = (cardRect.top + cardRect.bottom) / 2
      const mainCenterY = (mainRect.top + mainRect.bottom) / 2
      if (Math.abs(cardCenterX - shellCenterX) > tol + 1) {
        return {
          ok: false,
          reason: `card not horizontally centered in shell (Δx ${Math.abs(cardCenterX - shellCenterX).toFixed(2)})`,
          rows,
        }
      }
      if (Math.abs(cardCenterY - mainCenterY) > tol + 8) {
        return {
          ok: false,
          reason: `card not vertically centered in main (Δy ${Math.abs(cardCenterY - mainCenterY).toFixed(2)})`,
          rows,
        }
      }
      return { ok: true, rows }
    },
    {
      cardSel: "[data-testid=campaign-start-card]",
      controlSels: ["[data-testid=difficulty]", "[data-testid=campaign-start-actions]"],
      tol: tolerancePx,
    },
  )
  if (!result.ok) throw new Error(`Briefing controls centering: ${result.reason}`)
}

async function ensureAdvisorPanelOpen(page) {
  const panel = page.locator("[data-testid=advisor-panel]")
  if (await panel.isVisible().catch(() => false)) return
  await restoreTrayTab(page, "advisor-toggle")
  await panel.waitFor({ state: "visible", timeout: 10_000 })
}

/** @param {import('playwright').Page} page @param {number} repliesBefore */
async function waitForAdvisorReplyContainer(page, repliesBefore) {
  await page.waitForFunction(
    (before) => document.querySelectorAll("[data-testid=advisor-reply]").length > before,
    repliesBefore,
    { timeout: ADVISOR_TIMEOUT_MS },
  )
  const reply = page.locator("[data-testid=advisor-reply]").nth(repliesBefore)
  await reply.waitFor({ state: "visible", timeout: ADVISOR_TIMEOUT_MS })
  return reply.locator("xpath=..")
}

/** @param {import('playwright').Page} page @param {string} question */
async function sendAdvisorQuestion(page, question) {
  const repliesBefore = await page.locator("[data-testid=advisor-reply]").count()
  await page.locator("[data-testid=advisor-input]").fill(question)
  await page.locator("[data-testid=advisor-send]").click()
  return waitForAdvisorReplyContainer(page, repliesBefore)
}

/** @param {import('playwright').Page} page @param {string} pattern RegExp source or substring for fortify */
async function assertQueuedFortifyKrakow(page) {
  await restoreTrayTab(page, "tab-orders")
  const queue = page.locator("[data-testid=queued-orders]")
  const line = queue.getByText(/Fortify/i).filter({ hasText: /Kraków/i })
  try {
    await line.first().waitFor({ state: "visible", timeout: 5_000 })
  } catch {
    const snapshot = ((await queue.textContent()) ?? "").replace(/\s+/g, " ").trim()
    throw new Error(
      snapshot
        ? `Fortify Kraków not in queued orders. Queue: ${snapshot.slice(0, 240)}`
        : "Fortify Kraków not in queued orders (queue empty).",
    )
  }
}

async function expectAttr(locator, name, value) {
  await locator.waitFor({ state: "visible" })
  const got = await locator.getAttribute(name)
  if (got !== value) throw new Error(`Expected ${name}=${value}, got ${got}`)
}

/** @param {import('playwright').Page} page */
async function dismissNewsCardsIfOpen(page) {
  const overlay = page.locator('[data-testid="news-card-overlay"]')
  if (!(await overlay.isVisible().catch(() => false))) return
  const skip = page.getByRole("button", { name: "Skip all" })
  if (await skip.isVisible().catch(() => false)) {
    await skip.click()
  } else {
    await page.keyboard.press("Escape")
  }
  await overlay.waitFor({ state: "hidden", timeout: 15_000 })
}

/** @param {import('playwright').Page} page @param {boolean} allowFallback */
async function openChronicleDrawer(page) {
  await dismissNewsCardsIfOpen(page)
  const drawer = page.locator("[data-testid=chronicle-drawer]")
  if (await drawer.isVisible()) return
  await restoreTrayTab(page, "chronicle-log-toggle")
  await drawer.waitFor({ state: "visible", timeout: 10_000 })
}

async function assertGameMasterChronicle(page, allowFallback) {
  await openChronicleDrawer(page)
  const chronicle = page.locator("[data-testid=chronicle]")
  const gm = chronicle.getByText("Game master", { exact: true })
  const staff = chronicle.getByText("Staff simulation", { exact: true })
  if (await gm.isVisible()) return
  if (await staff.isVisible()) {
    if (allowFallback) return
    throw new Error(
      "Chronicle shows Staff simulation (GM fallback), not Game master. Re-run with --allow-fallback to allow staff mode.",
    )
  }
  throw new Error("Chronicle missing Game master badge (and no Staff simulation badge).")
}

/** @param {ReturnType<typeof parseCli>} cli @param {{ appUrl: string, shareEntryUrl: string | null }} targets */
function buildSteps(cli, targets) {
  return [
    {
      id: "01-load",
      name: "Load game (clean save)",
      async run({ page }) {
        await openApplication(page, targets)
        await page.evaluate(() => {
          localStorage.removeItem("ostfront-1915-v1")
          sessionStorage.removeItem("ostfront-advisor-v1")
          sessionStorage.removeItem("ostfront-windows-v1:campaign")
          sessionStorage.removeItem("ostfront-windows-v1:teach")
        })
        const reload = await page.reload({ waitUntil: "domcontentloaded" })
        const status = reload?.status() ?? 0
        if (status >= 400) throw new Error(`HTTP ${status} on reload`)
        await assertReachable(page)
        await page.waitForSelector("[data-testid=scenario-picker]", { timeout: 60_000 })
        const map = page.locator("[data-testid=war-map]")
        if ((await map.count()) > 0) {
          await map.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {
            throw new Error("Live war map must not render before Begin")
          })
        }
        await page.locator("[data-testid=briefing-task]").waitFor({ state: "visible", timeout: 10_000 })
        await page.locator("[data-testid=campaign-start-card]").waitFor({ state: "visible", timeout: 10_000 })
        try {
          await page.setViewportSize(MOBILE_VIEWPORT)
          await page.waitForTimeout(200)
          await assertBriefingControlsCentered(page, 1)
        } finally {
          await page.setViewportSize(DESKTOP_VIEWPORT)
          await page.waitForTimeout(200)
        }
      },
    },
    {
      id: "02-campaign",
      name: "Start campaign and pick difficulty",
      async run({ page }) {
        if (cli.forceFail) throw new Error("DEMO_FORCE_FAIL: deliberate failure for exit-code check")
        await page.locator("[data-testid=difficulty-normal]").click()
        await page.locator("[data-testid=begin-scenario]").click()
        await page.waitForSelector("[data-testid=war-map]", { timeout: 60_000 })
        await page.waitForTimeout(MAP_SETTLE_MS)
        await page.locator("[data-testid=scenario-picker]").waitFor({ state: "hidden", timeout: 10_000 })
        // No province auto-selected at Begin (Kraków used to be).
        // MapLibre selected filter uses "__none__" as a sentinel when nothing is selected.
        const selectedAtStart = await page.evaluate(() => {
          const filter = window.__ostfrontMap?.getFilter?.("selected")
          if (!Array.isArray(filter) || filter.length < 3) return null
          const id = filter[2]
          return id === "__none__" ? null : id
        })
        if (selectedAtStart) {
          throw new Error(`Expected no province selected at campaign start, got: ${selectedAtStart}`)
        }
      },
    },
    {
      id: "03-briefing",
      name: "Read campaign goal in Orders from OHL",
      async run({ page }) {
        const goal = page.locator("[data-testid=campaign-goal]")
        await goal.waitFor({ state: "visible", timeout: 15_000 })
        await expectText(goal, "Lemberg")
        await expectText(goal, "Kraków")
        await page.locator("[data-testid=ohl-orders-window]").waitFor({ state: "visible" })
      },
    },
    {
      id: "04-hud",
      name: "Top bar strength, VP, treasury, grade",
      async run({ page }) {
        await page.locator("[data-testid=objectives]").waitFor({ state: "visible" })
        await page.locator("[data-testid=treasury]").waitFor({ state: "visible" })
        await page.locator("[data-testid=grade]").waitFor({ state: "visible" })
        const hud = page.locator("[data-testid=table-hud]")
        await expectText(hud, "Strength")
        await expectText(hud, "VP")
        const hudText = await hud.innerText()
        if (/\bProvinces\b/.test(hudText)) throw new Error("Top bar still shows Provinces held")
        await openChronicleDrawer(page)
        await page.locator("[data-testid=map-legend]").waitFor({ state: "visible", timeout: 10_000 })
        await assertNoOverlap(
          page,
          "[data-testid=chronicle-drawer]",
          "[data-testid=map-legend]",
          "Desktop Log vs legend",
        )
        // File Log back into the tray (no Stow / toggle button).
        await page.locator("[data-testid=chronicle-drawer]").locator("[data-testid=floating-window-drag-handle]").click().catch(() => {})
        await page.keyboard.press("Escape")
        await page.locator("[data-testid=chronicle-drawer]").waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {})
      },
    },
    {
      id: "05-map-click",
      name: "Select province via map click",
      async run({ page }) {
        await stowPapersForMapClick(page)
        await page.waitForTimeout(300)
        const point = await projectOnMap(page, KATOWICE_LON_LAT[0], KATOWICE_LON_LAT[1])
        if (!point) throw new Error("Map projection unavailable (__ostfrontMap missing).")
        await page.mouse.click(point.x, point.y)
        await page.waitForFunction(
          () => {
            const filter = window.__ostfrontMap?.getFilter?.("selected")
            return Array.isArray(filter) && filter[2] === "katowice"
          },
          null,
          { timeout: 10_000 },
        )
        await restoreTrayTab(page, "tab-province")
        const title = page.locator("aside h2").filter({ hasText: "Katowice" }).first()
        await title.waitFor({ state: "attached", timeout: 10_000 })
        await title.scrollIntoViewIfNeeded()
        await title.waitFor({ state: "visible", timeout: 10_000 })
      },
    },
    {
      id: "06-map-modes",
      name: "Map modes Control / Supply / Unrest / Resources",
      async run({ page }) {
        // Overlay scale lives in the Legend paper — restore it after map-click stows.
        await restoreTrayTab(page, "legend-toggle")
        await page.locator("[data-testid=legend-window]").waitFor({ state: "visible", timeout: 5_000 })
        await page.locator("[data-testid=map-mode-supply]").click()
        await page.locator("[data-testid=overlay-scale]").waitFor({ state: "visible", timeout: 5_000 })
        await page.locator("[data-testid=map-mode-unrest]").click()
        await page.locator("[data-testid=overlay-scale]").waitFor({ state: "visible" })
        await page.locator("[data-testid=map-mode-resources]").click()
        const scale = page.locator("[data-testid=overlay-scale]")
        await scale.waitFor({ state: "visible" })
        const scaleText = ((await scale.innerText()) ?? "").replace(/\s+/g, " ")
        if (!/unrest\/100/i.test(scaleText)) {
          throw new Error(`Resources scale missing yield formula: ${scaleText.slice(0, 240)}`)
        }
        await page.locator("[data-testid=map-mode-none]").click()
        await page.locator("[data-testid=overlay-scale]").waitFor({ state: "hidden", timeout: 5_000 })
      },
    },
    {
      id: "06b-economy-breakdown",
      name: "Manpower and industry breakdown",
      async run({ page }) {
        const manpower = page.locator("[data-testid=economy-manpower]")
        await manpower.click()
        const panel = page.locator("[data-testid=economy-breakdown]")
        await panel.waitFor({ state: "visible", timeout: 5_000 })
        const text = ((await panel.innerText()) ?? "").replace(/\s+/g, " ")
        if (!text.includes("unrest/100")) throw new Error(`Breakdown missing unrest formula: ${text.slice(0, 280)}`)
        if (!text.includes("1.3")) throw new Error("Breakdown missing Central Powers industry ×1.3")
        if (!/per 4 strength/i.test(text)) throw new Error("Breakdown missing refit cost of 1 manpower per 4 strength")
        const incomeMp = await panel.getAttribute("data-income-mp")
        const incomeIp = await panel.getAttribute("data-income-ip")
        const refitMp = await panel.getAttribute("data-refit-mp")
        if (incomeMp == null || incomeIp == null || refitMp == null) {
          throw new Error("Breakdown is missing engine income or refit attributes")
        }
        await page.locator("[data-testid=economy-industry]").click()
        await panel.waitFor({ state: "visible" })
        const focused = await panel.getAttribute("data-economy-focus")
        if (focused !== "industry") throw new Error(`Expected industry focus, got ${focused}`)
        await page.keyboard.press("Escape")
        await panel.waitFor({ state: "hidden", timeout: 5_000 })
      },
    },
    {
      id: "07-rails",
      name: "Toggle railways in map legend",
      async run({ page }) {
        await page.locator("[data-testid=document-tray]").waitFor({ state: "visible", timeout: 10_000 })
        await restoreTrayTab(page, "legend-toggle")
        await page.locator("[data-testid=legend-window]").waitFor({ state: "visible", timeout: 5_000 })
        const toggle = page.locator("[data-testid=rail-toggle]")
        await toggle.waitFor({ state: "visible", timeout: 10_000 })
        const before = await toggle.textContent()
        await toggle.click()
        await page.waitForFunction(
          (prev) => {
            const el = document.querySelector("[data-testid=rail-toggle]")
            return el && el.textContent !== prev
          },
          before,
          { timeout: 5_000 },
        )
      },
    },
    {
      id: "07a0-ohl-tray-file",
      name: "Orders from OHL files into tray (no stuck-under-tray)",
      async run({ page }) {
        await page.locator("[data-testid=document-tray]").waitFor({ state: "visible", timeout: 5_000 })
        const ohl = page.locator("[data-testid=ohl-orders-window]")
        if (!(await ohl.isVisible().catch(() => false))) {
          await restoreTrayTab(page, "ohl-toggle")
        }
        await ohl.waitFor({ state: "visible", timeout: 5_000 })
        const tray = page.locator("[data-testid=document-tray]")
        const trayBox = await tray.boundingBox()
        const before = await ohl.boundingBox()
        if (!trayBox || !before) throw new Error("OHL or tray missing")
        const hx = before.x + Math.min(80, before.width / 2)
        const hy = before.y + 12
        await page.mouse.move(hx, hy)
        await page.mouse.down()
        // Drop at the tray edge (top of the bar) — must file, never stick under.
        await page.mouse.move(hx, trayBox.y + 2, { steps: 14 })
        await page.waitForTimeout(80)
        const over = await ohl.getAttribute("data-over-tray")
        const drop = await tray.getAttribute("data-drop-active")
        if (over !== "true" && drop !== "true") {
          throw new Error("Expected tray highlight while dragging OHL over the tray edge")
        }
        // Mid-drag: paper must paint above the tray (z-order), not behind it.
        const zOk = await page.evaluate(() => {
          const paper = document.querySelector('[data-testid=ohl-orders-window]')
          const bar = document.querySelector('[data-testid=document-tray]')
          if (!(paper instanceof HTMLElement) || !(bar instanceof HTMLElement)) return false
          const pz = Number(getComputedStyle(paper).zIndex) || 0
          const tz = Number(getComputedStyle(bar).zIndex) || 0
          // Tray wrapper is z-30; while dragging papers use PAPER_DRAG_Z (200).
          return pz >= 50 || pz > tz
        })
        if (!zOk) throw new Error("OHL z-index is not above the document tray while dragging")
        await page.mouse.up()
        await page.waitForTimeout(200)
        await ohl.waitFor({ state: "hidden", timeout: 5_000 })
        const tab = page.locator("[data-testid=ohl-toggle]")
        await expectAttr(tab, "data-stowed", "true")
        await restoreTrayTab(page, "ohl-toggle")
        await ohl.waitFor({ state: "visible", timeout: 5_000 })
        // Compare viewport boxes — offsetTop is not stage-relative for the tray wrapper.
        const restored = await ohl.boundingBox()
        const trayAfter = await tray.boundingBox()
        if (!restored || !trayAfter) throw new Error("OHL or tray missing after restore")
        if (restored.y + 36 > trayAfter.y + 1) {
          throw new Error(
            `OHL header still overlaps tray after restore: headerBottom=${restored.y + 36} trayTop=${trayAfter.y}`,
          )
        }
      },
    },
    {
      id: "07a-document-tray",
      name: "Document tray drag-to-file / Enter restore on campaign",
      async run({ page }) {
        await page.locator("[data-testid=document-tray]").waitFor({ state: "visible", timeout: 5_000 })
        await closeFloatingProvinceIfOpen(page)
        // Ensure Orders is out (Enter on tab if already filed).
        const orders = page.locator('[role="dialog"][aria-label="Orders"]')
        if (!(await orders.isVisible().catch(() => false))) {
          await restoreTrayTab(page, "tab-orders")
        }
        await orders.waitFor({ state: "visible", timeout: 5_000 })
        const beforeW = (await orders.boundingBox())?.width
        await dragPaperIntoTray(page, orders)
        await orders.waitFor({ state: "hidden", timeout: 5_000 })
        const tab = page.locator("[data-testid=tab-orders]")
        await expectAttr(tab, "data-stowed", "true")
        await restoreTrayTab(page, "tab-orders")
        await orders.waitFor({ state: "visible", timeout: 5_000 })
        // Desktop tabs for open papers are hidden; when visible again they are not stowed.
        const afterW = (await orders.boundingBox())?.width
        if (beforeW != null && afterW != null && Math.abs(afterW - beforeW) > 3) {
          throw new Error(`Orders width not retained after tray restore: ${beforeW} → ${afterW}`)
        }
      },
    },
    {
      id: "07b-window-drag",
      name: "Press-drag-release Orders; reach tray; size stable",
      async run({ page }) {
        await closeFloatingProvinceIfOpen(page)
        const orders = page.locator('[role="dialog"][aria-label="Orders"]')
        if (!(await orders.isVisible().catch(() => false))) {
          await restoreTrayTab(page, "tab-orders")
        }
        await orders.waitFor({ state: "visible", timeout: 5_000 })
        const handle = orders.locator("[data-testid=floating-window-drag-handle]")
        await handle.waitFor({ state: "visible" })
        const before = await orders.boundingBox()
        if (!before) throw new Error("Orders window missing bounding box")
        // If Enter restored a paper still sitting on the tray, lift it first.
        const trayBox0 = await page.locator("[data-testid=document-tray]").boundingBox()
        if (trayBox0 && before.y + 20 > trayBox0.y) {
          await page.mouse.move(before.x + 40, Math.max(40, trayBox0.y - 80))
          await page.mouse.down()
          await page.mouse.move(before.x + 40, 120, { steps: 6 })
          await page.mouse.up()
          await page.waitForTimeout(150)
        }
        const ready = await orders.boundingBox()
        if (!ready) throw new Error("Orders missing after lift")
        const startX = ready.x + Math.min(80, ready.width / 2)
        const startY = ready.y + 12
        // Use raw mouse coords (avoid hover — tray can intercept when papers sit low).
        await page.mouse.move(startX, startY)
        await page.mouse.down()
        await page.mouse.move(startX - 60, startY + 40, { steps: 8 })
        await page.mouse.up()
        await page.waitForTimeout(200)
        const after = await orders.boundingBox()
        if (!after) throw new Error("Orders window missing bounding box after drag")
        if (Math.abs(after.width - ready.width) > 2) {
          throw new Error(`Orders width changed on drag: ${ready.width} → ${after.width}`)
        }
        if (Math.abs(after.height - ready.height) > 2) {
          throw new Error(`Orders height changed on drag: ${ready.height} → ${after.height}`)
        }
        if (Math.abs(after.x - ready.x) < 20 && Math.abs(after.y - ready.y) < 20) {
          throw new Error(
            `Orders did not move on press-drag-release: before=${JSON.stringify(ready)} after=${JSON.stringify(after)}`,
          )
        }
        // No extra click-to-place: window stays put after mouseup.
        await page.waitForTimeout(150)
        const settled = await orders.boundingBox()
        if (!settled) throw new Error("Orders missing after settle")
        if (Math.abs(settled.x - after.x) > 2 || Math.abs(settled.y - after.y) > 2) {
          throw new Error("Orders kept moving after pointerup (expected press-drag-release)")
        }

        // Lower clamp: drag far down — header stays on-screen; body may reach the tray.
        const tray = page.locator("[data-testid=document-tray]")
        const trayBox = await tray.boundingBox()
        if (!trayBox) throw new Error("document-tray missing for lower-clamp check")
        const mid = await orders.boundingBox()
        if (!mid) throw new Error("Orders missing before lower drag")
        const hx = mid.x + Math.min(80, mid.width / 2)
        const hy = mid.y + 12
        try {
          await page.mouse.move(hx, hy)
          await page.mouse.down()
          await page.mouse.move(hx, trayBox.y + trayBox.height / 2, { steps: 16 })
          await page.waitForTimeout(80)
          const overTray = await orders.getAttribute("data-over-tray")
          const dropActive = await tray.getAttribute("data-drop-active")
          if (overTray !== "true" && dropActive !== "true") {
            throw new Error("Expected tray drop highlight while dragging Orders over the tray")
          }
          // Use layout top (not getBoundingClientRect) — tuck scale skews the visual box.
          const layout = await orders.evaluate((el) => ({
            top: el.offsetTop,
            height: el.offsetHeight,
            stageH: (el.offsetParent instanceof HTMLElement ? el.offsetParent.clientHeight : 0),
          }))
          if (layout.top < 0) throw new Error(`Orders header went off-screen: top=${layout.top}`)
          // Header grip must stay fully above the tray while dragging.
          if (layout.top + 36 > layout.stageH - 48 + 1) {
            throw new Error(
              `Orders header under tray while dragging: top=${layout.top} stageH=${layout.stageH}`,
            )
          }
          if (layout.top + layout.height < layout.stageH - 48 - 4) {
            throw new Error(
              `Orders could not reach tray band (old full-height clamp?): bottom=${layout.top + layout.height} stageH=${layout.stageH}`,
            )
          }
        } finally {
          await page.mouse.up().catch(() => {})
        }
        await page.waitForTimeout(200)
        // Released over tray → filed.
        await orders.waitFor({ state: "hidden", timeout: 5_000 })
        await expectAttr(page.locator("[data-testid=tab-orders]"), "data-stowed", "true")
        await restoreTrayTab(page, "tab-orders")
        await orders.waitFor({ state: "visible", timeout: 5_000 })

        // Viewport-bottom release: pointer at clientY === innerHeight must file.
        const readyBottom = await orders.boundingBox()
        if (!readyBottom) throw new Error("Orders missing before viewport-bottom file")
        const bx = readyBottom.x + Math.min(80, readyBottom.width / 2)
        const by = readyBottom.y + 12
        const vpH = page.viewportSize()?.height ?? 900
        await page.mouse.move(bx, by)
        await page.mouse.down()
        await page.mouse.move(bx, vpH, { steps: 18 })
        await page.mouse.up()
        await page.waitForTimeout(200)
        await orders.waitFor({ state: "hidden", timeout: 5_000 })
        await expectAttr(page.locator("[data-testid=tab-orders]"), "data-stowed", "true")
        await restoreTrayTab(page, "tab-orders")
        await orders.waitFor({ state: "visible", timeout: 5_000 })
      },
    },
    {
      id: "08-province-tab",
      name: "Open Province tab and inspect Kraków",
      async run({ page }) {
        await selectKrakowOnMap(page)
      },
    },
    {
      id: "09-fortify",
      name: "Queue fortify province action",
      async run({ page }) {
        await selectKrakowOnMap(page)
        const province = page.locator("[data-testid=province-window]").or(page.locator("aside")).first()
        const fortify = province.locator("[data-testid=fortify]")
        await fortify.waitFor({ state: "visible", timeout: 10_000 })
        if (await fortify.isDisabled()) {
          const label = ((await fortify.textContent()) ?? "").trim()
          if (/Fortify queued/i.test(label)) {
            await assertQueuedFortifyKrakow(page)
            return
          }
          const reason =
            (await province.locator("[data-testid=fortify-reason]").textContent())?.trim() ||
            "Fortify button disabled on Kraków province panel."
          throw new Error(reason)
        }
        await fortify.scrollIntoViewIfNeeded()
        await fortify.click()
        await assertQueuedFortifyKrakow(page)
      },
    },
    {
      id: "10-neighbor-move",
      name: "Queue move via neighbor button",
      async run({ page }) {
        await selectKrakowOnMap(page)
        const province = page.locator("[data-testid=province-window]").or(page.locator("aside")).first()
        const move = province.getByRole("button").filter({ hasText: "Katowice" }).filter({ hasText: "Move" })
        await move.first().waitFor({ state: "visible", timeout: 10_000 })
        await move.first().click()
        await restoreTrayTab(page, "tab-orders")
        const orders = page.locator("[data-testid=orders-window]").or(page.locator("aside")).first()
        await orders.getByText(/Move to Katowice/).first().waitFor({ state: "visible", timeout: 10_000 })
      },
    },
    {
      id: "11-recruit",
      name: "Queue recruit at depot yard",
      async run({ page }) {
        await selectKrakowOnMap(page)
        const recruit = page.locator("[data-testid=recruit-infantry]")
        await recruit.waitFor({ state: "visible", timeout: 10_000 })
        if (await recruit.isDisabled()) {
          throw new Error("Infantry recruit button is disabled (budget or supply).")
        }
        await recruit.click()
        await restoreTrayTab(page, "tab-orders")
        await expectText(page.locator("aside"), "Raise")
      },
    },
    {
      id: "12-attack",
      name: "Queue attack via neighbor button",
      async run({ page }) {
        await selectKrakowOnMap(page)
        const province = page.locator("[data-testid=province-window]").or(page.locator("aside")).first()
        const attack = province.getByRole("button").filter({ hasText: "Lemberg" }).filter({ hasText: "Attack" })
        await attack.first().waitFor({ state: "visible", timeout: 10_000 })
        await attack.first().click()
        await restoreTrayTab(page, "tab-orders")
        const orders = page.locator("[data-testid=orders-window]").or(page.locator("aside")).first()
        await orders.getByText(/Attack Lemberg from/).first().waitFor({ state: "visible", timeout: 10_000 })
      },
    },
    {
      id: "13-draw-arrows",
      name: "Toggle draw-arrows mode",
      async run({ page }) {
        await restoreTrayTab(page, "tab-orders")
        const btn = page.locator("[data-testid=draw-arrows]")
        await btn.click()
        await expectAttr(btn, "aria-pressed", "true")
        await btn.click()
        await expectAttr(btn, "aria-pressed", "false")
      },
    },
    {
      id: "14-directive",
      name: "Type directive preview",
      async run({ page }) {
        await restoreTrayTab(page, "tab-orders")
        const field = page.locator("[data-testid=directive]")
        await field.fill("Fortify Kraków.")
        await expectText(page.locator("aside"), "Will entrench Kraków")
      },
    },
    {
      id: "15-advisor-starter",
      name: "Ask Falkenhayn coach starter (/api/advisor)",
      async run({ page }) {
        await restoreTrayTab(page, "advisor-toggle")
        await page.locator("[data-testid=advisor-panel]").waitFor({ state: "visible" })
        await page.locator("[data-testid=advisor-starter-plan]").click()
        const reply = page.locator("[data-testid=advisor-reply]").last()
        await reply.waitFor({ state: "visible", timeout: ADVISOR_TIMEOUT_MS })
        const text = (await reply.textContent()) ?? ""
        if (/unavailable offline/i.test(text) && !/map|dispatch|queue|chronicle/i.test(text)) {
          throw new Error("Advisor offline fallback (no model key).")
        }
        if (!text.trim()) throw new Error("Empty advisor reply.")
        if (await page.locator("[data-testid=advisor-suggestion]").count()) {
          throw new Error("Coach must not show order suggestion cards.")
        }
      },
    },
    {
      id: "16-advisor-send-coach",
      name: "Typed coach question, Send, no Accept cards",
      async run({ page, log }) {
        await ensureAdvisorPanelOpen(page)
        const container = await sendAdvisorQuestion(page, "What do you make of my queued plan?")
        const reply = container.locator("[data-testid=advisor-reply]").last()
        await reply.waitFor({ state: "visible", timeout: ADVISOR_TIMEOUT_MS })
        const text = ((await reply.textContent()) ?? "").trim()
        log(`step 16 coach reply length=${text.length}`)
        if (!text) throw new Error("Empty coach reply.")
        const cards = await container.locator("[data-testid=advisor-suggestion]").count()
        if (cards > 0) throw new Error(`Coach returned ${cards} forbidden suggestion card(s).`)
        if (await page.locator("[data-testid=advisor-accept]").count()) {
          throw new Error("Coach must not expose Accept.")
        }
      },
    },
    {
      id: "17-mobile-chronicle",
      name: "Mobile Log drawer (390×844) and tablet Log/legend clearance",
      async run({ page }) {
        try {
          await page.setViewportSize(MOBILE_VIEWPORT)
          await openChronicleDrawer(page)
          await page.locator("[data-testid=mobile-chronicle-panel] [data-testid=chronicle]").waitFor({
            state: "visible",
            timeout: 10_000,
          })
          // Drawer covers the map-corner Log toggle; close via chrome, not the buried button.
          await page.locator("[data-testid=chronicle-drawer]").getByRole("button", { name: "Close" }).click()
          await page.locator("[data-testid=chronicle-drawer]").waitFor({ state: "hidden", timeout: 10_000 })
          await page.setViewportSize({ width: 768, height: 1024 })
          await page.waitForTimeout(500)
          await page.locator("[data-testid=chronicle-log-toggle]").waitFor({ state: "visible", timeout: 10_000 })
          await page.locator("[data-testid=map-legend]").waitFor({ state: "visible", timeout: 10_000 })
          await assertNoOverlap(
            page,
            "[data-testid=chronicle-log-toggle]",
            "[data-testid=map-legend]",
            "Tablet Log button vs legend",
          )
        } finally {
          await page.setViewportSize(DESKTOP_VIEWPORT)
          await page.waitForTimeout(400)
        }
      },
    },
    {
      id: "18-end-turn",
      name: "Close the fortnight (button)",
      async run({ page }) {
        await restoreTrayTab(page, "tab-orders")
        // File Chief of Staff if open so Orders End turn stays reachable.
        const advisor = page.locator('[role="dialog"][aria-label="Chief of Staff"]')
        if (await advisor.isVisible().catch(() => false)) {
          await advisor.locator("[data-testid=floating-window-drag-handle]").click().catch(() => {})
          await page.keyboard.press("Escape")
          await advisor.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {})
        }
        await openChronicleDrawer(page)
        const logBefore = await page.locator("[data-testid=chronicle] ul li button").count()
        await page.locator("[data-testid=end-turn]").click()
        await page
          .locator("[data-testid=stavka-deliberating]")
          .waitFor({ state: "visible", timeout: 5_000 })
          .catch(() => {})
        await page
          .locator("[data-testid=stavka-deliberating]")
          .waitFor({ state: "hidden", timeout: TURN_TIMEOUT_MS })
          .catch(() => {})
        await dismissNewsCardsIfOpen(page)
        await openChronicleDrawer(page)
        await page.waitForFunction(
          (before) => document.querySelectorAll("[data-testid=chronicle] ul li button").length > before,
          logBefore,
          { timeout: TURN_TIMEOUT_MS },
        )
        const banner = page.locator("[data-testid=gm-fallback]")
        if (await banner.isVisible()) {
          throw new Error("GM fallback banner visible after turn.")
        }
        const alert = page.locator('[role="alert"]')
        if (await alert.isVisible()) {
          const msg = ((await alert.textContent()) ?? "").trim()
          if (msg) throw new Error(`Turn error: ${msg.slice(0, 200)}`)
        }
      },
    },
    {
      id: "19-chronicle-gm",
      name: "GM narration and Game master badge",
      async run({ page }) {
        await openChronicleDrawer(page)
        const chronicle = page.locator("[data-testid=chronicle]")
        await chronicle.locator("article").waitFor({ state: "visible", timeout: 10_000 })
        await page.locator("[data-testid=chronicle-details-toggle]").click()
        await page.locator("[data-testid=chronicle-details]").waitFor({ state: "visible", timeout: 10_000 })
        const body = (await chronicle.locator("article").textContent()) ?? ""
        if (body.length < 80) throw new Error("Chronicle entry too short after turn.")
        const gmWarn = chronicle.locator("[data-testid=gm-warning]")
        if (await gmWarn.isVisible()) {
          throw new Error("GM warning in chronicle (staff fallback).")
        }
        await page.locator("[data-testid=resolution-log]").waitFor({ state: "visible", timeout: 10_000 })
        await assertGameMasterChronicle(page, cli.allowFallback)
      },
    },
    {
      id: "20-ctrl-enter",
      name: "Close a fortnight with Ctrl+Enter",
      async run({ page }) {
        await restoreTrayTab(page, "tab-orders")
        await openChronicleDrawer(page)
        const logBefore = await page.locator("[data-testid=chronicle] ul li button").count()
        await page.keyboard.press("Control+Enter")
        await page
          .locator("[data-testid=stavka-deliberating]")
          .waitFor({ state: "hidden", timeout: TURN_TIMEOUT_MS })
          .catch(() => {})
        await dismissNewsCardsIfOpen(page)
        await openChronicleDrawer(page)
        await page.waitForFunction(
          (before) => document.querySelectorAll("[data-testid=chronicle] ul li button").length > before,
          logBefore,
          { timeout: TURN_TIMEOUT_MS },
        )
        await assertGameMasterChronicle(page, cli.allowFallback)
      },
    },
    {
      id: "21-restart",
      name: "Restart campaign (confirm)",
      async run({ page }) {
        await dismissNewsCardsIfOpen(page)
        await stowPapersForMapClick(page)
        await page.locator("[data-testid=hud-options]").click()
        await page.locator("[data-testid=hud-options-restart]").click({ force: true })
        await page.locator("[data-testid=hud-options-restart]").getByText("Confirm restart").waitFor({
          state: "visible",
          timeout: 5_000,
        })
        await page.locator("[data-testid=hud-options-restart]").click()
        await page.locator("[data-testid=scenario-picker]").waitFor({ state: "visible", timeout: 15_000 })
      },
    },
    {
      id: "22-teach-load",
      name: "Open converging-attacks teaching drill",
      async run({ page }) {
        await page.setViewportSize(DESKTOP_VIEWPORT)
        const base = targets.appUrl.replace(/\/$/, "")
        await gotoChecked(page, `${base}/teach`)
        await page.locator("[data-testid=teach-begin]").click()
        const app = page.locator("[data-testid=teach-app]")
        await app.waitFor({ state: "visible", timeout: 60_000 })
        await page.locator("[data-testid=teach-question]").waitFor({ state: "visible", timeout: 15_000 })
        await page.waitForTimeout(MAP_SETTLE_MS)
        const teachSelectedAtStart = await page.evaluate(() => {
          const filter = window.__ostfrontMap?.getFilter?.("selected")
          if (!Array.isArray(filter) || filter.length < 3) return null
          const id = filter[2]
          return id === "__none__" ? null : id
        })
        if (teachSelectedAtStart) {
          throw new Error(`Expected no province selected at /teach start, got: ${teachSelectedAtStart}`)
        }
        const shell = await app.getAttribute("data-teach-shell")
        if (shell !== "desktop") {
          throw new Error(`Expected desktop teach shell at 1440×900, got: ${shell ?? "(none)"}`)
        }
        const teachGoal = page.locator("[data-testid=teach-goal]")
        await teachGoal.waitFor({ state: "visible", timeout: 5_000 })
        const goalText = (await teachGoal.innerText()).trim()
        if (!/converging attacks on lublin/i.test(goalText)) {
          throw new Error(`Expected lesson goal in HUD, got: ${goalText || "(empty)"}`)
        }
        if (await page.locator("[data-testid=campaign-goal]").count()) {
          throw new Error("Campaign goal still shown on /teach HUD")
        }
        if (await page.locator("[data-testid=treasury]").count()) {
          throw new Error("Campaign treasury scoring still shown on /teach HUD")
        }
        await page.locator("[data-testid=document-tray]").waitFor({ state: "visible", timeout: 10_000 })
        await page.locator("[data-testid=teach-lesson-window]").waitFor({ state: "visible", timeout: 10_000 })
        await page.locator("[data-testid=teach-orders-window]").waitFor({ state: "visible", timeout: 5_000 })
        await page.locator("[data-testid=legend-window]").waitFor({ state: "visible", timeout: 5_000 })
        const resolveCount = await page.locator("[data-testid=teach-resolve]").count()
        if (resolveCount !== 1) {
          throw new Error(`Expected exactly one teach-resolve control, got ${resolveCount}`)
        }
        const resolveLabelCount = await page
          .locator("button")
          .evaluateAll((els) =>
            els.filter((el) => /resolve this fortnight/i.test(el.textContent || "")).length,
          )
        if (resolveLabelCount !== 1) {
          throw new Error(
            `Expected exactly one "Resolve this fortnight" button on /teach, got ${resolveLabelCount}`,
          )
        }
        if (await page.locator("[data-testid=end-turn]").count()) {
          throw new Error("Orders end-turn control should be absent on /teach")
        }
        const lessonBox = await page.locator("[data-testid=teach-lesson-window]").boundingBox()
        const legendBox = await page.locator("[data-testid=legend-window]").boundingBox()
        const ordersBox = await page.locator("[data-testid=teach-orders-window]").boundingBox()
        if (!lessonBox || !legendBox || !ordersBox) {
          throw new Error("Missing teach window bounding boxes for overlap check")
        }
        const overlap = (a, b) =>
          !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)
        if (overlap(lessonBox, legendBox) || overlap(lessonBox, ordersBox) || overlap(legendBox, ordersBox)) {
          throw new Error(
            `Teach windows overlap at 1440×900: lesson=${JSON.stringify(lessonBox)} legend=${JSON.stringify(legendBox)} orders=${JSON.stringify(ordersBox)}`,
          )
        }
        // Legend defaults under Lesson in the left column (same edge, below).
        if (Math.abs(legendBox.x - lessonBox.x) > 12) {
          throw new Error(
            `Expected Legend on the left under Lesson (same x), got lesson.x=${lessonBox.x} legend.x=${legendBox.x}`,
          )
        }
        if (legendBox.y < lessonBox.y + lessonBox.height - 2) {
          throw new Error(
            `Expected Legend below Lesson, got lesson bottom=${lessonBox.y + lessonBox.height} legend.y=${legendBox.y}`,
          )
        }
        // Left column should stay clear of mid-map targets (Kraków/Kielce/Lublin).
        if (lessonBox.x + lessonBox.width > 1440 * 0.45) {
          throw new Error(
            `Left teach column reaches too far right (covers targets): right edge=${lessonBox.x + lessonBox.width}`,
          )
        }
        const resolveBox = await page.locator("[data-testid=teach-resolve]").boundingBox()
        if (!resolveBox) throw new Error("teach-resolve missing bounding box")
        if (
          resolveBox.y < lessonBox.y ||
          resolveBox.y + resolveBox.height > lessonBox.y + lessonBox.height + 2
        ) {
          throw new Error(
            `Resolve should be visible inside Lesson without scrolling: resolve=${JSON.stringify(resolveBox)} lesson=${JSON.stringify(lessonBox)}`,
          )
        }
        const map = page.locator("[data-testid=war-map]")
        await map.waitFor({ state: "visible", timeout: 15_000 })
        const lessonHighlights = await map.getAttribute("data-lesson-highlights")
        if (
          !lessonHighlights?.includes("target:lublin") ||
          !lessonHighlights.includes("source:krakow") ||
          !lessonHighlights.includes("kielce")
        ) {
          throw new Error(
            `Expected lesson target+source highlights (lublin / krakow,kielce), got: ${lessonHighlights ?? "(none)"}`,
          )
        }
        if ((await map.getAttribute("data-lesson-focus")) !== "true") {
          throw new Error("Expected data-lesson-focus=true on teach map")
        }
        // Wait until MapLibre has applied source filters (lessonFocus can race map load).
        await page.waitForFunction(
          () => {
            const m = window.__ostfrontMap
            if (!m?.getLayer?.("lesson-source-outline")) return false
            const filter = JSON.stringify(m.getFilter("lesson-source-outline") || [])
            return filter.includes("krakow") && filter.includes("kielce")
          },
          null,
          { timeout: 15_000 },
        )
        const sourceFilter = await page.evaluate(() =>
          JSON.stringify(window.__ostfrontMap?.getFilter?.("lesson-source-outline") || []),
        )
        if (!sourceFilter.includes("krakow") || !sourceFilter.includes("kielce")) {
          throw new Error(`Expected source outline filter for krakow/kielce, got: ${sourceFilter}`)
        }
        const targetFilter = await page.evaluate(() =>
          JSON.stringify(window.__ostfrontMap?.getFilter?.("lesson-target-outline") || []),
        )
        if (!targetFilter.includes("lublin")) {
          throw new Error(`Expected target outline filter for lublin, got: ${targetFilter}`)
        }

        // Tray drag-to-file / Enter restore + press-drag-release on /teach (after layout asserts).
        const ordersWin = page.locator("[data-testid=teach-orders-window]")
        await dragPaperIntoTray(page, ordersWin)
        await ordersWin.waitFor({ state: "hidden", timeout: 5_000 })
        await restoreTrayTab(page, "tab-orders")
        await ordersWin.waitFor({ state: "visible", timeout: 5_000 })
        const beforeDrag = await ordersWin.boundingBox()
        if (!beforeDrag) throw new Error("teach Orders missing box before drag")
        const ox = beforeDrag.x + Math.min(70, beforeDrag.width / 2)
        const oy = beforeDrag.y + 12
        await page.mouse.move(ox, oy)
        await page.mouse.down()
        await page.mouse.move(ox - 40, oy + 30, { steps: 6 })
        await page.mouse.up()
        await page.waitForTimeout(150)
        const afterDrag = await ordersWin.boundingBox()
        if (!afterDrag) throw new Error("teach Orders missing box after drag")
        if (Math.abs(afterDrag.height - beforeDrag.height) > 3) {
          throw new Error(
            `Teach Orders height changed on drag: ${beforeDrag.height} → ${afterDrag.height}`,
          )
        }
        if (Math.abs(afterDrag.x - beforeDrag.x) < 10 && Math.abs(afterDrag.y - beforeDrag.y) < 10) {
          throw new Error("Teach Orders did not move on press-drag-release")
        }

        // Phone stacked shell: Resolve must stay in the viewport without page scroll.
        try {
          await page.setViewportSize(MOBILE_VIEWPORT)
          await page.waitForFunction(
            () => window.matchMedia("(min-width: 1024px)").matches === false,
            null,
            { timeout: 5_000 },
          )
          await page.waitForFunction(
            () => document.querySelector("[data-testid=teach-app]")?.getAttribute("data-teach-shell") === "stacked",
            null,
            { timeout: 5_000 },
          )
          const phoneShell = await app.getAttribute("data-teach-shell")
          if (phoneShell !== "stacked") {
            throw new Error(`Expected stacked teach shell at 390×844, got: ${phoneShell ?? "(none)"}`)
          }
          await page.locator("[data-testid=teach-lesson-stack]").waitFor({ state: "visible", timeout: 5_000 })
          await page.locator("[data-testid=document-tray]").waitFor({ state: "visible", timeout: 5_000 })
          const phoneResolve = await page.locator("[data-testid=teach-resolve]").boundingBox()
          if (!phoneResolve) throw new Error("teach-resolve missing at 390×844")
          if (phoneResolve.y < 0 || phoneResolve.y + phoneResolve.height > MOBILE_VIEWPORT.height + 1) {
            throw new Error(
              `Resolve below the fold at 390×844: box=${JSON.stringify(phoneResolve)} viewport=${MOBILE_VIEWPORT.height}`,
            )
          }
        } finally {
          await page.setViewportSize(DESKTOP_VIEWPORT)
          await page.waitForFunction(
            () => window.matchMedia("(min-width: 1024px)").matches === true,
            null,
            { timeout: 5_000 },
          )
          await page.waitForTimeout(300)
        }
      },
    },
    {
      id: "23-teach-hint",
      name: "Request coach hint (province-anchored)",
      async run({ page }) {
        await restoreTrayTab(page, "teach-lesson-toggle")
        await page.locator("[data-testid=teach-panel]").waitFor({ state: "visible", timeout: 5_000 })
        await page.locator("[data-testid=teach-request-hint]").click()
        await page.waitForTimeout(300)
        const map = page.locator("[data-testid=war-map]")
        const highlights = await map.getAttribute("data-coach-highlights")
        if (!highlights?.includes("lublin")) {
          throw new Error(`Expected coach highlight on lublin, got: ${highlights ?? "(none)"}`)
        }
      },
    },
    {
      id: "24-teach-queue-converging",
      name: "Queue two-prong attack on Lublin",
      async run({ page }) {
        await stowPapersForMapClick(page)
        const krakow = await projectOnMap(page, KRAKOW_LON_LAT[0], KRAKOW_LON_LAT[1])
        const kielce = await projectOnMap(page, KIELCE_LON_LAT[0], KIELCE_LON_LAT[1])
        if (!krakow || !kielce) throw new Error("Map projection unavailable for teaching drill.")
        await page.mouse.click(krakow.x, krakow.y)
        await page.waitForTimeout(350)
        await restoreTrayTab(page, "tab-province")
        await page.locator("[data-testid=teach-province-window]").waitFor({ state: "visible", timeout: 5_000 })
        const attackLublin = page
          .locator("[data-testid=teach-province-window]")
          .getByRole("button", { name: /Attack/i })
          .filter({ hasText: /Lublin/i })
        await attackLublin.first().click()
        await page.mouse.click(kielce.x, kielce.y)
        await page.waitForTimeout(350)
        await restoreTrayTab(page, "tab-province")
        await attackLublin.first().click()
        await restoreTrayTab(page, "tab-orders")
        await expectText(page.locator("[data-testid=queued-orders]"), "Lublin")
      },
    },
    {
      id: "25-teach-discuss",
      name: "Discuss reasoning with coach (guided)",
      async run({ page }) {
        await restoreTrayTab(page, "teach-lesson-toggle")
        await page.locator("[data-testid=teach-lesson-window]").waitFor({ state: "visible", timeout: 5_000 })
        await page.locator("[data-testid=teach-pedagogy-notice]").waitFor({ state: "visible" })
        await page.locator("[data-testid=teach-reasoning]").fill(
          "Two separate battles from Kraków and Kielce.",
        )
        await page.locator("[data-testid=teach-discuss-plan]").click()
        const reply = page.locator("[data-testid=teach-coach-reply]")
        await reply.waitFor({ state: "visible", timeout: 30_000 })
        const stance = await reply.getAttribute("data-coach-stance")
        if (stance !== "misconception" && stance !== "partial" && stance !== "unclear" && stance !== "fallback") {
          throw new Error(`Expected coach to challenge separate-battle reasoning, got stance=${stance}`)
        }
      },
    },
    {
      id: "26-teach-resolve",
      name: "Resolve teaching fortnight with engine feedback",
      async run({ page }) {
        await page.locator("[data-testid=teach-reasoning]").fill(
          "Combine both prongs into one converging assault.",
        )
        await page.locator("[data-testid=teach-prediction]").fill(
          "Merged battle on Lublin; converging odds favour us before the teaching die.",
        )
        await page.locator("[data-testid=teach-resolve]").click()
        await page.locator("[data-testid=teach-feedback]").waitFor({ state: "visible", timeout: 30_000 })
        const kind = await page.locator("[data-testid=teach-feedback] p").first().getAttribute("data-feedback-kind")
        if (kind !== "sound_converging_unlucky" && kind !== "sound_converging_success") {
          throw new Error(`Unexpected teach feedback kind: ${kind ?? "missing"}`)
        }
        await page.locator("[data-testid=teach-evidence]").getByText(/roll \d/i).waitFor({ state: "visible" })
      },
    },
    {
      id: "27-teach-silent",
      name: "Silent variation shows no coach hints",
      async run({ page }) {
        await page.locator("[data-testid=teach-start-silent]").click()
        await page
          .locator("[data-testid=teach-panel][data-teach-variant=silent]")
          .waitFor({ state: "visible", timeout: 60_000 })
        await page.locator("[data-testid=teach-silent-banner]").waitFor({ state: "visible", timeout: 10_000 })
        const beliefRecall = page.locator("[data-testid=teach-belief-recall]")
        if (await beliefRecall.count()) {
          await beliefRecall.waitFor({ state: "visible", timeout: 5000 })
        }
        if (await page.locator("[data-testid=teach-request-hint]").count()) {
          throw new Error("Hint control visible in silent mode")
        }
        await stowPapersForMapClick(page)
        const krakow = await projectOnMap(page, KRAKOW_LON_LAT[0], KRAKOW_LON_LAT[1])
        const kielce = await projectOnMap(page, KIELCE_LON_LAT[0], KIELCE_LON_LAT[1])
        if (!krakow || !kielce) throw new Error("Map projection unavailable for silent drill.")
        await page.mouse.click(krakow.x, krakow.y)
        await page.waitForTimeout(350)
        await restoreTrayTab(page, "tab-province")
        await page.locator("[data-testid=teach-province-window]").waitFor({ state: "visible", timeout: 5_000 })
        await page
          .locator("[data-testid=teach-province-window]")
          .getByRole("button", { name: /Attack/i })
          .filter({ hasText: /Lublin/i })
          .first()
          .click()
        await page.mouse.click(kielce.x, kielce.y)
        await page.waitForTimeout(350)
        await restoreTrayTab(page, "tab-province")
        await page
          .locator("[data-testid=teach-province-window]")
          .getByRole("button", { name: /Attack/i })
          .filter({ hasText: /Lublin/i })
          .first()
          .click()
        await restoreTrayTab(page, "teach-lesson-toggle")
        await page.locator("[data-testid=teach-reasoning]").fill("Silent plan: Kraków and Kielce together.")
        await page.locator("[data-testid=teach-prediction]").fill(
          "Still one merged battle; odds may hurt us on roll 4 but convergence is sound.",
        )
        await page.locator("[data-testid=teach-resolve]").click()
        const feedback = page.locator("[data-testid=teach-feedback]")
        await feedback.waitFor({ state: "visible", timeout: 30_000 })
        await page.locator("[data-testid=teach-attempt-id]").waitFor({ state: "visible" })
        await page.locator("[data-testid=teach-coach-post]").waitFor({ state: "visible" })
        const beliefLine = page.locator("[data-testid=teach-belief-stored]")
        if (await beliefLine.count()) {
          await beliefLine.waitFor({ state: "visible" })
        }
      },
    },
    {
      id: "28-teach-supply",
      name: "Supply lesson with map overlay and prediction",
      async run({ page }) {
        const base = targets.appUrl.replace(/\/$/, "")
        await gotoChecked(page, `${base}/teach`)
        await page.locator("[data-testid=teach-begin-supply]").click()
        await page.locator("[data-testid=teach-app]").waitFor({ state: "visible", timeout: 60_000 })
        await page.locator("[data-testid=teach-goal]").getByText(/supply vs headcount/i).waitFor({
          state: "visible",
          timeout: 10_000,
        })
        await page.waitForTimeout(MAP_SETTLE_MS)
        const map = page.locator("[data-testid=war-map]")
        const supplyHighlights = await map.getAttribute("data-lesson-highlights")
        if (
          !supplyHighlights?.includes("target:kielce") ||
          !supplyHighlights.includes("source:katowice") ||
          !supplyHighlights.includes("krakow")
        ) {
          throw new Error(
            `Expected supply lesson highlights (kielce / katowice,krakow), got: ${supplyHighlights ?? "(none)"}`,
          )
        }
        if ((await page.locator("[data-testid=teach-resolve]").count()) !== 1) {
          throw new Error("Expected exactly one teach-resolve on supply lesson")
        }
        const supplyResolveLabels = await page
          .locator("button")
          .evaluateAll((els) =>
            els.filter((el) => /resolve this fortnight/i.test(el.textContent || "")).length,
          )
        if (supplyResolveLabels !== 1) {
          throw new Error(
            `Expected exactly one Resolve button on supply lesson, got ${supplyResolveLabels}`,
          )
        }
        if (await page.locator("[data-testid=end-turn]").count()) {
          throw new Error("Orders end-turn should stay absent on supply lesson")
        }
        await page.waitForFunction(
          () => {
            const m = window.__ostfrontMap
            if (!m?.getLayer?.("lesson-source-outline")) return false
            const filter = JSON.stringify(m.getFilter("lesson-source-outline") || [])
            return filter.includes("katowice") && filter.includes("krakow")
          },
          null,
          { timeout: 15_000 },
        )
        await selectKrakowOnMap(page)
        await page.getByRole("button").filter({ hasText: /Kielce/ }).first().click()
        await restoreTrayTab(page, "tab-orders")
        await page.locator("[data-testid=queued-orders]").getByText(/Kielce/i).waitFor({ state: "visible", timeout: 15_000 })
        await restoreTrayTab(page, "legend-toggle")
        await page.locator("[data-testid=legend-window]").waitFor({ state: "visible", timeout: 5_000 })
        await page.locator("[data-testid=map-mode-supply]").click()
        await page.locator("[data-testid=overlay-scale]").waitFor({ state: "visible", timeout: 10_000 })
        // selectKrakowOnMap stows papers — bring Lesson back for reasoning / Resolve.
        await restoreTrayTab(page, "teach-lesson-toggle")
        await page.locator("[data-testid=teach-lesson-window]").waitFor({ state: "visible", timeout: 5_000 })
        await page.locator("[data-testid=teach-reasoning]").fill(
          "Fed corps from Kraków hits harder than the starved heavy stack at Katowice because supply scales attack power.",
        )
        await page.locator("[data-testid=teach-prediction]").fill(
          "Lean column takes Kielce; engine preview favours well-supplied attack over raw headcount.",
        )
        await page.locator("[data-testid=teach-resolve]").click()
        const feedback = page.locator("[data-testid=teach-feedback]")
        await feedback.waitFor({ state: "visible", timeout: 30_000 })
        const kind = await feedback.locator("p").first().getAttribute("data-feedback-kind")
        if (kind !== "supply_chose_starved_stack" && kind !== "supply_sound_fed_column") {
          throw new Error(`Unexpected supply feedback kind: ${kind ?? "missing"}`)
        }
        await page.locator("[data-testid=teach-evidence]").getByText(/ratio/i).first().waitFor({ state: "visible" })
      },
    },
  ]
}

const cli = parseCli(process.argv.slice(2))
configureRedaction({
  bypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
  shareToken: shareTokenFromUrl(cli.displayUrl) ?? undefined,
})
const targets = resolveTargets(cli.displayUrl)
const redactedDisplayUrl = redactUrl(cli.displayUrl)
const redactedAppUrl = redactUrl(targets.appUrl)

mkdirSync(OUT_DIR, { recursive: true })
const logPath = join(OUT_DIR, "run.log")
writeFileSync(
  logPath,
  `demo-check ${new Date().toISOString()}\nURL: ${redactedDisplayUrl}\nApp: ${redactedAppUrl}\n`,
)

function log(line) {
  const safe = redactSensitiveText(line)
  appendFileSync(logPath, `${safe}\n`)
  console.log(safe)
}

const bypassHeaders = vercelBypassHeaders()
if (bypassHeaders) log("Vercel deployment protection bypass configured.")

const steps = buildSteps(cli, targets)

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader"],
})

const context = await browser.newContext({
  viewport: DESKTOP_VIEWPORT,
  ...(bypassHeaders ? { extraHTTPHeaders: bypassHeaders } : {}),
})
const page = await context.newPage()
const issues = []

page.on("console", (msg) => {
  if (msg.type() === "error") {
    issues.push(redactSensitiveText(`console: ${msg.text()}`))
  }
})
page.on("pageerror", (err) => issues.push(redactSensitiveText(`pageerror: ${err.message}`)))
page.on("requestfailed", (req) => {
  issues.push(
    redactSensitiveText(
      `requestfailed: ${req.method()} ${redactUrl(req.url())} — ${req.failure()?.errorText ?? "failed"}`,
    ),
  )
})

const results = []
let failed = 0
let passed = 0
let skipped = 0
let stop = false
/** @type {string | null} */
let abortReason = null

for (const step of steps) {
  if (stop) break
  const shot = join(OUT_DIR, `${step.id}.png`)
  try {
    const outcome = await step.run({ page, log })
    await page.screenshot({ path: shot, fullPage: false })
    if (typeof outcome === "string" && outcome.startsWith("skipped:")) {
      const note = outcome.slice("skipped:".length).trim()
      results.push({ id: step.id, name: step.name, ok: false, status: "skipped", note })
      skipped += 1
      log(`SKIP  ${step.id}  ${step.name} — ${note}`)
    } else {
      results.push({ id: step.id, name: step.name, ok: true })
      passed += 1
      log(`PASS  ${step.id}  ${step.name}`)
    }
  } catch (err) {
    failed += 1
    try {
      await page.screenshot({ path: shot, fullPage: false })
    } catch {
      /* ignore */
    }
    const message = redactSensitiveText(err instanceof Error ? err.message : String(err))
    results.push({ id: step.id, name: step.name, ok: false, error: message })
    log(`FAIL  ${step.id}  ${step.name} — ${message}`)
    if (!cli.continueOnFail || isFatalStepError(err)) {
      stop = true
      if (isFatalStepError(err)) abortReason = message
    }
  }
}

await context.close()
await browser.close()

if (abortReason) {
  log(`aborted: ${abortReason}`)
}

if (issues.length) {
  log("\n--- console / network issues ---")
  for (const line of issues) log(line)
  writeFileSync(join(OUT_DIR, "issues.log"), issues.map((line) => `${line}\n`).join(""))
}

writeFileSync(
  join(OUT_DIR, "summary.json"),
  JSON.stringify(
    {
      url: redactedDisplayUrl,
      appUrl: redactedAppUrl,
      protectionBypassConfigured: Boolean(bypassHeaders),
      allowFallback: cli.allowFallback,
      passed,
      skipped,
      failed,
      results,
      issueCount: issues.length,
    },
    null,
    2,
  ),
)

log("\n=== Summary ===")
for (const row of results) {
  const tag = row.status === "skipped" ? "SKIP" : row.ok ? "PASS" : "FAIL"
  const detail = row.status === "skipped" ? row.note : row.error
  log(`${tag}  ${row.id}  ${row.name}${detail ? ` — ${detail}` : ""}`)
}
if (stop && failed > 0 && !cli.continueOnFail) {
  log(`\nStopped after first failure (${failed} failed, ${results.length} executed). Pass --continue to run all steps.`)
}
log(`\n${passed} passed, ${skipped} skipped, ${failed} failed (${results.length} executed). Output: ${OUT_DIR}/`)

const exitOk = failed === 0 && (skipped === 0 || cli.allowFallback)
process.exit(exitOk ? 0 : 1)
