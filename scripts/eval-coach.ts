/**
 * Scenario evaluation harness for the Phase 2E campaign coach.
 *
 *   npm run eval:coach -- --offline
 *   npm run eval:coach -- --json /tmp/coach-eval.json
 *   npm run eval:coach                 # live when LLM_API_KEY is set; else offline
 *
 * Layer 1 (always): deterministic hard-rule checks.
 * Layer 2 (live only): pedagogy rubric via the configured LLM / EVAL_JUDGE_MODEL.
 */
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  formatCoachEvalDetails,
  formatCoachEvalTable,
  runCoachEval,
} from "@/lib/gm/coach-eval"
import { llmConfigured } from "@/lib/gm/llm"

function parseArgs(argv: string[]) {
  let offline = false
  let jsonPath: string | null = null
  const scenarioIds: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!
    if (arg === "--offline") {
      offline = true
      continue
    }
    if (arg === "--json") {
      jsonPath = argv[++i] ?? null
      if (!jsonPath) throw new Error("--json requires a path")
      continue
    }
    if (arg === "--scenario") {
      const id = argv[++i]
      if (!id) throw new Error("--scenario requires an id")
      scenarioIds.push(id)
      continue
    }
    if (arg === "--help" || arg === "-h") {
      console.log(`Usage: eval-coach [--offline] [--json <path>] [--scenario <id>]...

  --offline    Validate fixtures + Layer 1 against rules/fallback (no API).
  --json path  Write the full report JSON for prompt-iteration diffs.
  --scenario   Run only the named scenario id (repeatable).
`)
      process.exit(0)
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  return { offline, jsonPath, scenarioIds }
}

async function main() {
  const { offline, jsonPath, scenarioIds } = parseArgs(process.argv.slice(2))
  const forceOffline = offline || !llmConfigured()

  if (offline) {
    console.log("Mode: offline (forced) — Layer 1 only\n")
  } else if (!llmConfigured()) {
    console.log("Mode: offline (LLM_API_KEY unset) — Layer 1 only\n")
  } else {
    console.log("Mode: live — Layer 1 + pedagogy rubric\n")
  }

  const report = await runCoachEval({
    offline: forceOffline,
    gradePedagogy: !forceOffline,
    scenarioIds: scenarioIds.length ? scenarioIds : undefined,
  })

  console.log(formatCoachEvalTable(report))
  console.log("")
  console.log(formatCoachEvalDetails(report))
  console.log(
    `Summary: hard ${report.hardPassCount}/${report.scenarios.length} pass` +
      (report.pedagogyPassCount != null
        ? `; pedagogy ${report.pedagogyPassCount}/${report.scenarios.length} pass`
        : "; pedagogy skipped"),
  )

  if (jsonPath) {
    const absolute = resolve(jsonPath)
    writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`, "utf8")
    console.log(`Wrote ${absolute}`)
  }

  // Offline / CI: fixture + hard-rule failures are the exit signal.
  // Live pedagogy misses are reported but do not fail the process (prompt iteration).
  if (report.hardFailCount > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
