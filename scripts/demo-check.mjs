/**
 * Playwright smoke path for QA and coding agents.
 *
 * DEMO_URL=https://… npm run demo-check
 * npm run demo-check -- --url https://… [--continue] [--allow-fallback] [--force-fail]
 */
import { chromium } from "playwright"
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs"
import { join } from "node:path"
import { redactSensitiveText, redactUrl } from "./demo-check-redact.mjs"

const PRODUCTION_URL = "https://raymondymmak-ostfront.vercel.app"
const OUT_DIR = "demo-check-output"
const DESKTOP_VIEWPORT = { width: 1440, height: 900 }
const MOBILE_VIEWPORT = { width: 390, height: 844 }
const MAP_SETTLE_MS = 3200
const TURN_TIMEOUT_MS = 140_000
const ADVISOR_TIMEOUT_MS = 45_000
const KRAKOW_LON_LAT = [-0.022, -0.632]

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

/** @param {string} raw */
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
  const body = (await page.textContent("body")) ?? ""
  if (body.includes("DEPLOYMENT_NOT_FOUND") || body.includes("The deployment could not be found")) {
    throw new Error("Deployment not found at this URL.")
  }
  if (body.includes("Protected by Vercel Authentication")) {
    throw new Error(
      "Blocked by Vercel deployment protection. Set VERCEL_AUTOMATION_BYPASS_SECRET or pass DEMO_URL with _vercel_share=REDACTED in docs only.",
    )
  }
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

async function expectText(locator, snippet) {
  await locator.getByText(snippet, { exact: false }).first().waitFor({ state: "visible", timeout: 15_000 })
}

async function expectAttr(locator, name, value) {
  await locator.waitFor({ state: "visible" })
  const got = await locator.getAttribute(name)
  if (got !== value) throw new Error(`Expected ${name}=${value}, got ${got}`)
}

/** @param {import('playwright').Page} page @param {boolean} allowFallback */
async function assertGameMasterChronicle(page, allowFallback) {
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
        })
        const reload = await page.reload({ waitUntil: "domcontentloaded" })
        const status = reload?.status() ?? 0
        if (status >= 400) throw new Error(`HTTP ${status} on reload`)
        await assertReachable(page)
        await page.waitForSelector("[data-testid=scenario-picker]", { timeout: 60_000 })
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
      },
    },
    {
      id: "03-briefing",
      name: "Read opening briefing in Chronicle",
      async run({ page }) {
        const chronicle = page.locator("[data-testid=chronicle]")
        await chronicle.waitFor({ state: "visible", timeout: 15_000 })
        await expectText(chronicle, "2 May 1915")
        await expectText(chronicle, "Gorlice")
      },
    },
    {
      id: "04-hud",
      name: "Top bar strength, provinces, VP, treasury, grade",
      async run({ page }) {
        await page.locator("[data-testid=objectives]").waitFor({ state: "visible" })
        await page.locator("[data-testid=treasury]").waitFor({ state: "visible" })
        await page.locator("[data-testid=grade]").waitFor({ state: "visible" })
        const hud = page.locator("header")
        await expectText(hud, "Strength")
        await expectText(hud, "Provinces")
        await expectText(hud, "VP")
      },
    },
    {
      id: "05-map-click",
      name: "Select province via map click",
      async run({ page }) {
        const point = await projectOnMap(page, KRAKOW_LON_LAT[0], KRAKOW_LON_LAT[1])
        if (!point) throw new Error("Map projection unavailable (__ostfrontMap missing).")
        await page.mouse.click(point.x, point.y)
        await page.waitForTimeout(400)
        await page.locator("[data-testid=tab-province]").click()
        await expectText(page.locator("aside"), "Kraków")
      },
    },
    {
      id: "06-map-modes",
      name: "Map modes Control / Supply / Unrest",
      async run({ page }) {
        await page.locator("[data-testid=map-mode-supply]").click()
        await page.locator("[data-testid=overlay-scale]").waitFor({ state: "visible", timeout: 5_000 })
        await page.locator("[data-testid=map-mode-unrest]").click()
        await page.locator("[data-testid=overlay-scale]").waitFor({ state: "visible" })
        await page.locator("[data-testid=map-mode-none]").click()
        await page.locator("[data-testid=overlay-scale]").waitFor({ state: "hidden", timeout: 5_000 })
      },
    },
    {
      id: "07-rails",
      name: "Toggle railways in map legend",
      async run({ page }) {
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
      id: "08-province-tab",
      name: "Open Province tab and inspect Kraków",
      async run({ page }) {
        await page.locator("[data-testid=tab-province]").click()
        await expectText(page.locator("aside"), "Kraków")
      },
    },
    {
      id: "09-fortify",
      name: "Queue fortify province action",
      async run({ page }) {
        await page.locator("[data-testid=fortify]").click()
        await page.locator("[data-testid=tab-orders]").click()
        await expectText(page.locator("aside"), "Fortify Kraków")
      },
    },
    {
      id: "10-neighbor-move",
      name: "Queue move via neighbor button",
      async run({ page }) {
        await page.locator("[data-testid=tab-province]").click()
        const move = page.locator("aside button").filter({ hasText: "Katowice" }).filter({ hasText: "Move" })
        await move.first().waitFor({ state: "visible", timeout: 10_000 })
        await move.first().click()
        await page.locator("[data-testid=tab-orders]").click()
        await page.locator("aside").getByText(/Move to Katowice/).first().waitFor({ state: "visible", timeout: 10_000 })
      },
    },
    {
      id: "11-recruit",
      name: "Queue recruit at depot yard",
      async run({ page }) {
        await page.locator("[data-testid=tab-province]").click()
        const recruit = page.locator("[data-testid=recruit-infantry]")
        await recruit.waitFor({ state: "visible", timeout: 10_000 })
        if (await recruit.isDisabled()) {
          throw new Error("Infantry recruit button is disabled (budget or supply).")
        }
        await recruit.click()
        await page.locator("[data-testid=tab-orders]").click()
        await expectText(page.locator("aside"), "Raise")
      },
    },
    {
      id: "12-attack",
      name: "Queue attack via neighbor button",
      async run({ page }) {
        await page.locator("[data-testid=tab-province]").click()
        const attack = page.locator("aside button").filter({ hasText: "Lemberg" }).filter({ hasText: "Attack" })
        await attack.first().waitFor({ state: "visible", timeout: 10_000 })
        await attack.first().click()
        await page.locator("[data-testid=tab-orders]").click()
        await page.locator("aside").getByText(/Attack Lemberg from/).first().waitFor({ state: "visible", timeout: 10_000 })
      },
    },
    {
      id: "13-draw-arrows",
      name: "Toggle draw-arrows mode",
      async run({ page }) {
        await page.locator("[data-testid=tab-orders]").click()
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
        await page.locator("[data-testid=tab-orders]").click()
        const field = page.locator("[data-testid=directive]")
        await field.fill("Fortify Kraków.")
        await expectText(page.locator("aside"), "Will entrench Kraków")
      },
    },
    {
      id: "15-advisor-starter",
      name: "Ask Falkenhayn starter (/api/advisor)",
      async run({ page }) {
        await page.locator("[data-testid=advisor-toggle]").click()
        await page.locator("[data-testid=advisor-panel]").waitFor({ state: "visible" })
        await page.locator("[data-testid=advisor-starter-weakest]").click()
        const reply = page.locator("[data-testid=advisor-reply]").last()
        await reply.waitFor({ state: "visible", timeout: ADVISOR_TIMEOUT_MS })
        const text = (await reply.textContent()) ?? ""
        if (/unavailable offline/i.test(text)) {
          throw new Error("Advisor offline fallback (no model key).")
        }
        if (!text.trim()) throw new Error("Empty advisor reply.")
      },
    },
    {
      id: "16-advisor-send-accept",
      name: "Typed advisor question, Send, Accept suggestion",
      async run({ page }) {
        await page.locator("[data-testid=advisor-input]").fill("Which neighbor is weakest?")
        await page.locator("[data-testid=advisor-send]").click()
        await page.locator("[data-testid=advisor-reply]").last().waitFor({ state: "visible", timeout: ADVISOR_TIMEOUT_MS })
        const accept = page.locator("[data-testid=advisor-accept]").first()
        await accept.waitFor({ state: "visible", timeout: ADVISOR_TIMEOUT_MS })
        await accept.click()
        await page.locator("[data-testid=tab-orders]").click()
      },
    },
    {
      id: "17-mobile-chronicle",
      name: "Mobile Chronicle tab (390×844)",
      async run({ page }) {
        await page.setViewportSize(MOBILE_VIEWPORT)
        await page.locator("[data-testid=tab-chronicle]").click()
        const chronicle = page.locator("[data-testid=chronicle]")
        await chronicle.waitFor({ state: "visible", timeout: 10_000 })
        await expectText(chronicle, "2 May 1915")
        await page.setViewportSize(DESKTOP_VIEWPORT)
      },
    },
    {
      id: "18-end-turn",
      name: "Close the fortnight (button)",
      async run({ page }) {
        await page.locator("[data-testid=tab-orders]").click()
        await page.locator("[data-testid=advisor-toggle]").click()
        const logBefore = await page.locator("[data-testid=chronicle] ul li button").count()
        await page.locator("[data-testid=end-turn]").click()
        await page
          .locator("[data-testid=stavka-deliberating]")
          .waitFor({ state: "visible", timeout: 5_000 })
          .catch(() => {})
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
        const chronicle = page.locator("[data-testid=chronicle]")
        await chronicle.locator("article").waitFor({ state: "visible", timeout: 10_000 })
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
        await page.locator("[data-testid=tab-orders]").click()
        const logBefore = await page.locator("[data-testid=chronicle] ul li button").count()
        await page.keyboard.press("Control+Enter")
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
        await page.getByRole("button", { name: "Restart" }).click()
        await page.getByRole("button", { name: "Confirm restart" }).click()
        await page.locator("[data-testid=scenario-picker]").waitFor({ state: "visible", timeout: 15_000 })
      },
    },
  ]
}

const cli = parseCli(process.argv.slice(2))
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
let stop = false

for (const step of steps) {
  if (stop) break
  const shot = join(OUT_DIR, `${step.id}.png`)
  try {
    await step.run({ page })
    await page.screenshot({ path: shot, fullPage: false })
    results.push({ id: step.id, name: step.name, ok: true })
    log(`PASS  ${step.id}  ${step.name}`)
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
    if (!cli.continueOnFail) stop = true
  }
}

await context.close()
await browser.close()

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
      results,
      issueCount: issues.length,
    },
    null,
    2,
  ),
)

log("\n=== Summary ===")
for (const row of results) {
  log(`${row.ok ? "PASS" : "FAIL"}  ${row.id}  ${row.name}${row.error ? ` — ${row.error}` : ""}`)
}
if (stop && failed > 0 && !cli.continueOnFail) {
  log(`\nStopped after first failure (${failed} failed, ${results.length} executed). Pass --continue to run all steps.`)
}
log(`\n${results.length - failed}/${results.length} steps passed. Output: ${OUT_DIR}/`)

process.exit(failed > 0 ? 1 : 0)
