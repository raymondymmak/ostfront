/**
 * Playwright smoke path for QA and coding agents.
 * Usage: DEMO_URL=https://… npm run demo-check
 *        npm run demo-check -- --url https://…
 */
import { chromium } from "playwright"
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs"
import { join } from "node:path"

const DEFAULT_URL = "https://raymondymmak-ostfront.vercel.app"
const OUT_DIR = "demo-check-output"
const VIEWPORT = { width: 1440, height: 900 }
const MAP_SETTLE_MS = 3200
const TURN_TIMEOUT_MS = 140_000
const ADVISOR_TIMEOUT_MS = 45_000

function parseUrl(argv) {
  const flag = argv.indexOf("--url")
  if (flag !== -1 && argv[flag + 1]) return argv[flag + 1]
  if (process.env.DEMO_URL) return process.env.DEMO_URL
  return DEFAULT_URL
}

/** @param {string} raw */
function resolveTargets(raw) {
  const parsed = new URL(raw)
  const appUrl = `${parsed.origin}${parsed.pathname || "/"}`
  const shareEntryUrl = parsed.searchParams.has("_vercel_share") ? parsed.href : null
  return { appUrl, shareEntryUrl, displayUrl: raw }
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
      "Blocked by Vercel deployment protection. Set VERCEL_AUTOMATION_BYPASS_SECRET or pass DEMO_URL with _vercel_share=…",
    )
  }
}

/** @param {import('playwright').Page} page @param {{ appUrl: string, shareEntryUrl: string | null }} targets */
async function openApplication(page, targets) {
  if (targets.shareEntryUrl) {
    await page.goto(targets.shareEntryUrl, { waitUntil: "domcontentloaded", timeout: 90_000 })
    await assertReachable(page)
  }
  const current = new URL(page.url())
  const target = new URL(targets.appUrl)
  const onAppPath =
    current.origin === target.origin &&
    current.pathname === target.pathname &&
    !current.search &&
    !current.hash
  if (!onAppPath) {
    await page.goto(targets.appUrl, { waitUntil: "domcontentloaded", timeout: 90_000 })
    await assertReachable(page)
  }
}

const displayUrl = parseUrl(process.argv.slice(2))
const targets = resolveTargets(displayUrl)

mkdirSync(OUT_DIR, { recursive: true })
const logPath = join(OUT_DIR, "run.log")
writeFileSync(
  logPath,
  `demo-check ${new Date().toISOString()}\nURL: ${displayUrl}\nApp: ${targets.appUrl}\n`,
)

function log(line) {
  appendFileSync(logPath, `${line}\n`)
  console.log(line)
}

/** @type {{ id: string; name: string; run: (ctx: { page: import('playwright').Page }) => Promise<void> }[]} */
const steps = [
  {
    id: "01-load",
    name: "Load game (clean save)",
    async run({ page }) {
      await openApplication(page, targets)
      await page.evaluate(() => {
        localStorage.removeItem("ostfront-1915-v1")
        sessionStorage.removeItem("ostfront-advisor-v1")
      })
      await page.reload({ waitUntil: "domcontentloaded" })
      await assertReachable(page)
      await page.waitForSelector("[data-testid=scenario-picker]", { timeout: 60_000 })
    },
  },
  {
    id: "02-campaign",
    name: "Start campaign and pick difficulty",
    async run({ page }) {
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
    id: "05-map-modes",
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
    id: "06-rails",
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
    id: "07-province-panel",
    name: "Open Province tab and inspect Kraków",
    async run({ page }) {
      await page.locator("[data-testid=tab-province]").click()
      await expectText(page.locator("aside"), "Kraków")
    },
  },
  {
    id: "08-fortify",
    name: "Queue fortify province action",
    async run({ page }) {
      await page.locator("[data-testid=fortify-province]").click()
      await page.locator("[data-testid=tab-orders]").click()
      await expectText(page.locator("[data-testid=tab-orders]").locator("xpath=ancestor::aside"), "Fortify Kraków")
    },
  },
  {
    id: "09-recruit",
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
    id: "10-attack",
    name: "Queue attack via neighbor button",
    async run({ page }) {
      await page.locator("[data-testid=tab-province]").click()
      const attack = page.locator("aside button").filter({ hasText: "Lemberg" }).filter({ hasText: "Attack" })
      await attack.first().waitFor({ state: "visible", timeout: 10_000 })
      await attack.first().click()
      await page.locator("[data-testid=tab-orders]").click()
      const queue = page.locator("aside").getByText(/Attack Lemberg from/)
      await queue.first().waitFor({ state: "visible", timeout: 10_000 })
    },
  },
  {
    id: "11-draw-arrows",
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
    id: "12-directive",
    name: "Type directive preview",
    async run({ page }) {
      await page.locator("[data-testid=tab-orders]").click()
      const field = page.locator("[data-testid=directive]")
      await field.fill("Fortify Kraków.")
      await expectText(page.locator("aside"), "Will entrench Kraków")
    },
  },
  {
    id: "13-advisor",
    name: "Ask Falkenhayn (/api/advisor)",
    async run({ page }) {
      await page.locator("[data-testid=advisor-toggle]").click()
      await page.locator("[data-testid=advisor-panel]").waitFor({ state: "visible" })
      await page.locator("[data-testid=advisor-starter-weakest]").click()
      const reply = page.locator("[data-testid=advisor-reply]").last()
      await reply.waitFor({ state: "visible", timeout: ADVISOR_TIMEOUT_MS })
      const text = (await reply.textContent()) ?? ""
      if (/unavailable offline/i.test(text)) {
        throw new Error(`Advisor offline: ${text.slice(0, 120)}`)
      }
      if (!text.trim()) throw new Error("Empty advisor reply.")
    },
  },
  {
    id: "14-end-turn",
    name: "Close the fortnight (simultaneous resolution)",
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
      await page
        .locator("[data-testid=stavka-deliberating]")
        .waitFor({ state: "hidden", timeout: 10_000 })
        .catch(() => {})
      const banner = page.locator("[data-testid=gm-fallback]")
      if (await banner.isVisible()) {
        const msg = await banner.textContent()
        throw new Error(`GM fallback banner: ${msg?.slice(0, 200)}`)
      }
      const alert = page.locator('[role="alert"]')
      if (await alert.isVisible()) {
        const msg = ((await alert.textContent()) ?? "").trim()
        if (msg) throw new Error(`Turn error: ${msg.slice(0, 200)}`)
      }
    },
  },
  {
    id: "15-chronicle",
    name: "GM narration, diplomacy, resolution log",
    async run({ page }) {
      const chronicle = page.locator("[data-testid=chronicle]")
      await chronicle.waitFor({ state: "visible" })
      const article = chronicle.locator("article")
      await article.waitFor({ state: "visible", timeout: 10_000 })
      const body = (await article.textContent()) ?? ""
      if (body.length < 80) throw new Error("Chronicle entry too short after turn.")
      const gmWarn = chronicle.locator("[data-testid=gm-warning]")
      if (await gmWarn.isVisible()) {
        throw new Error(`GM warning in chronicle: ${((await gmWarn.textContent()) ?? "").slice(0, 200)}`)
      }
      await page.locator("[data-testid=resolution-log]").waitFor({ state: "visible", timeout: 10_000 })
    },
  },
]

async function expectText(locator, snippet) {
  await locator.getByText(snippet, { exact: false }).first().waitFor({ state: "visible", timeout: 15_000 })
}

async function expectAttr(locator, name, value) {
  await locator.waitFor({ state: "visible" })
  const got = await locator.getAttribute(name)
  if (got !== value) throw new Error(`Expected ${name}=${value}, got ${got}`)
}

const bypassHeaders = vercelBypassHeaders()
if (bypassHeaders) log("Vercel automation bypass headers: enabled")

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader"],
})

const context = await browser.newContext({
  viewport: VIEWPORT,
  ...(bypassHeaders ? { extraHTTPHeaders: bypassHeaders } : {}),
})
const page = await context.newPage()
const issues = []

page.on("console", (msg) => {
  if (msg.type() === "error") issues.push(`console: ${msg.text()}`)
})
page.on("pageerror", (err) => issues.push(`pageerror: ${err.message}`))
page.on("requestfailed", (req) => {
  issues.push(`requestfailed: ${req.method()} ${req.url()} — ${req.failure()?.errorText ?? "failed"}`)
})

const results = []
let failed = 0

for (const step of steps) {
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
    const message = err instanceof Error ? err.message : String(err)
    results.push({ id: step.id, name: step.name, ok: false, error: message })
    log(`FAIL  ${step.id}  ${step.name} — ${message}`)
  }
}

await context.close()
await browser.close()

if (issues.length) {
  log("\n--- console / network issues ---")
  for (const line of issues) log(line)
  writeFileSync(join(OUT_DIR, "issues.log"), issues.join("\n") + "\n")
}

writeFileSync(
  join(OUT_DIR, "summary.json"),
  JSON.stringify(
    {
      url: displayUrl,
      appUrl: targets.appUrl,
      vercelBypass: Boolean(bypassHeaders),
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
log(`\n${results.length - failed}/${results.length} steps passed. Output: ${OUT_DIR}/`)

process.exit(failed > 0 ? 1 : 0)
