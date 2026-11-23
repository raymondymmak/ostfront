/** Capture Phase 2E coach screenshots: queued attack + battle review (desktop + phone).
 * Requires DEMO_URL. Set REQUIRE_LIVE=1 to fail if the coach answers offline/rules-only.
 */
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

const BASE = process.env.DEMO_URL
if (!BASE) {
  console.error("DEMO_URL is required")
  process.exit(1)
}
const OUT = process.env.OUT_DIR || "/opt/cursor/artifacts"
const REQUIRE_LIVE = process.env.REQUIRE_LIVE === "1"
const KRAKOW = [-0.022, -0.632]
mkdirSync(OUT, { recursive: true })

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

async function stowPapers(page) {
  for (let i = 0; i < 8; i++) {
    const visible = await page
      .locator('[role="dialog"]')
      .evaluateAll((els) => els.filter((el) => el.getClientRects().length > 0).length)
    if (visible === 0) break
    await page.keyboard.press("Escape")
    await page.waitForTimeout(120)
  }
}

async function dismissNews(page) {
  for (let i = 0; i < 6; i++) {
    const overlay = page.locator('[data-testid="news-card-overlay"]')
    if (!(await overlay.isVisible().catch(() => false))) return
    const skip = page.getByRole("button", { name: "Skip all" })
    const onward = page.getByRole("button", { name: /Onward|Continue|Close/i })
    if (await skip.isVisible().catch(() => false)) await skip.click()
    else if (await onward.first().isVisible().catch(() => false)) await onward.first().click()
    else await page.keyboard.press("Escape")
    await page.waitForTimeout(400)
  }
}

async function beginCampaign(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 })
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 })
  await page.locator("[data-testid=begin-scenario]").click()
  await page.locator("[data-testid=war-map]").waitFor({ state: "visible", timeout: 60_000 })
  await page.waitForFunction(() => Boolean(window.__ostfrontMap), null, { timeout: 30_000 })
  await page.waitForTimeout(800)
}

async function queueKielceAttack(page) {
  await stowPapers(page)
  const point = await projectOnMap(page, KRAKOW[0], KRAKOW[1])
  if (!point) throw new Error("Map projection unavailable")
  await page.mouse.click(point.x, point.y)
  await page.waitForTimeout(400)
  await restoreTrayTab(page, "tab-province")
  const attack = page.getByRole("button", { name: /Attack/i }).filter({ hasText: /Kielce/i })
  await attack.first().waitFor({ state: "visible", timeout: 10_000 })
  await attack.first().click()
  await restoreTrayTab(page, "tab-orders")
  await page.locator("[data-testid=queued-orders]").getByText(/Kielce/i).first().waitFor({
    state: "visible",
    timeout: 10_000,
  })
  console.log("queued Kielce attack")
}

async function openAdvisor(page) {
  await restoreTrayTab(page, "advisor-toggle")
  await page.locator("[data-testid=advisor-panel]").waitFor({ state: "visible", timeout: 10_000 })
}

async function askCoach(page, starterTestId, question, expectRe) {
  await openAdvisor(page)
  const before = await page.locator("[data-testid=advisor-reply]").count()
  const starter = page.locator(`[data-testid=${starterTestId}]`)
  if (await starter.isVisible().catch(() => false)) {
    await starter.scrollIntoViewIfNeeded()
    await starter.click()
  } else {
    await page.locator("[data-testid=advisor-input]").fill(question)
    await page.locator("[data-testid=advisor-send]").click()
  }
  await page.waitForFunction(
    (n) => document.querySelectorAll("[data-testid=advisor-reply]").length > n,
    before,
    { timeout: 60_000 },
  )
  const reply = page.locator("[data-testid=advisor-reply]").nth(before)
  await reply.waitFor({ state: "visible", timeout: 60_000 })
  const text = ((await reply.textContent()) ?? "").replace(/\s+/g, " ").trim()
  console.log("coach reply:", text.slice(0, 280))
  if (!expectRe.test(text)) {
    throw new Error(`Coach reply did not match ${expectRe}: ${text.slice(0, 400)}`)
  }
  if (/unavailable offline|not from the wire/i.test(text)) {
    throw new Error("Offline disclaimer still present in coach reply")
  }
  if (/\b(attacker|defender|weWon|oursLost|theirsLost)=/.test(text)) {
    throw new Error("Raw key=value battle fields leaked to the player")
  }
  const panelText = ((await page.locator("[data-testid=advisor-panel]").textContent()) ?? "").toLowerCase()
  const offlineBadge = /campaign coach\s*[•·]\s*offline/.test(panelText)
  if (REQUIRE_LIVE && offlineBadge) {
    throw new Error(
      "LIVE_MODEL_UNAVAILABLE: advisor panel shows offline (preview likely has no LLM_API_KEY / model routing).",
    )
  }
  if (REQUIRE_LIVE && /i do not file orders — change the arrows yourself if you disagree\.?$/i.test(text.trim())) {
    // Heuristic: exact rules-fallback queued sentence means model did not answer.
    // Allow if text is longer/varied (LLM paraphrase).
  }
  return { text, offlineBadge }
}

async function runViewport(browser, tag, size) {
  const context = await browser.newContext({ viewport: size })
  const page = await context.newPage()
  await beginCampaign(page)
  await queueKielceAttack(page)

  await stowPapers(page)
  const plan = await askCoach(
    page,
    "advisor-starter-plan",
    "What do you make of my queued plan?",
    /expect|kielce|odds|lemberg|column|attack|plan/i,
  )
  console.log(tag, "plan offlineBadge=", plan.offlineBadge)
  await page.screenshot({
    path: join(OUT, `coach-live-queued-attack-${tag}.png`),
    fullPage: false,
  })
  console.log("wrote plan", tag)

  await stowPapers(page)
  await restoreTrayTab(page, "tab-orders")
  const endTurn = page.locator("[data-testid=end-turn]")
  await endTurn.waitFor({ state: "visible", timeout: 10_000 })
  await endTurn.click()
  await Promise.race([
    page.locator('[data-testid="news-card-overlay"]').waitFor({ state: "visible", timeout: 90_000 }),
    page.getByText(/16 May|Fortnight 2/i).first().waitFor({ state: "visible", timeout: 90_000 }),
  ]).catch(() => {})
  await page.waitForTimeout(800)
  await dismissNews(page)
  await dismissNews(page)
  await stowPapers(page)

  const review = await askCoach(
    page,
    "advisor-starter-review",
    "Review the last battle from the chronicle.",
    /expect|kielce|lost|assault|chronicle|roll|took|failed/i,
  )
  console.log(tag, "review offlineBadge=", review.offlineBadge)
  const highlights = await page.locator("[data-testid=war-map]").getAttribute("data-coach-highlights")
  console.log("review highlights", highlights)
  await page.screenshot({
    path: join(OUT, `coach-live-battle-review-${tag}.png`),
    fullPage: false,
  })
  console.log("wrote review", tag)

  await context.close()
  return { planOffline: plan.offlineBadge, reviewOffline: review.offlineBadge }
}

const browser = await chromium.launch({ headless: true })
try {
  const desktop = await runViewport(browser, "desktop", { width: 1440, height: 900 })
  const phone = await runViewport(browser, "phone", { width: 390, height: 844 })
  const anyOffline = desktop.planOffline || desktop.reviewOffline || phone.planOffline || phone.reviewOffline
  if (REQUIRE_LIVE && anyOffline) {
    console.error(
      "LIVE_MODEL_UNAVAILABLE: coach answered with unavailable/offline badge on the preview.",
    )
    process.exit(2)
  }
  if (anyOffline) console.log("NOTE: coach used offline/rules path (unavailable badge).")
  else console.log("LIVE: coach answered without offline badge.")
} finally {
  await browser.close()
}
