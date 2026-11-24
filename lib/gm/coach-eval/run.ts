import { coachCampaign } from "@/lib/gm/campaign-coach"
import { llmConfigured, resolveProviderChain } from "@/lib/gm/llm"
import { targetFromProvider } from "@/lib/gm/providers"
import { checkHardRules, hardRulesPassed } from "@/lib/gm/coach-eval/checker"
import { gradePedagogy, resolveJudgeModel } from "@/lib/gm/coach-eval/rubric"
import { COACH_EVAL_SCENARIOS } from "@/lib/gm/coach-eval/scenarios"
import type {
  CoachEvalReport,
  ScenarioEvalResult,
} from "@/lib/gm/coach-eval/types"

export type RunCoachEvalOptions = {
  /** Force rules/fallback path (also the default when no LLM key). */
  offline?: boolean
  /** Run Layer 2 rubric when live LLM is available. */
  gradePedagogy?: boolean
  scenarioIds?: string[]
}

export async function runCoachEval(options: RunCoachEvalOptions = {}): Promise<CoachEvalReport> {
  const offline = Boolean(options.offline) || !llmConfigured()
  const wantPedagogy = options.gradePedagogy !== false && !offline && llmConfigured()
  const primary = offline ? null : (resolveProviderChain()[0] ?? null)
  const coachModel = primary?.model ?? null
  const judgeModel = coachModel ? resolveJudgeModel(coachModel) : null

  const selected = options.scenarioIds?.length
    ? COACH_EVAL_SCENARIOS.filter((scenario) => options.scenarioIds!.includes(scenario.id))
    : COACH_EVAL_SCENARIOS

  if (options.scenarioIds?.length && selected.length !== options.scenarioIds.length) {
    const known = new Set(COACH_EVAL_SCENARIOS.map((scenario) => scenario.id))
    const missing = options.scenarioIds.filter((id) => !known.has(id))
    throw new Error(`Unknown scenario id(s): ${missing.join(", ")}`)
  }

  // Offline / CI: ensure no accidental live calls even if a key is present.
  const previousKey = process.env.LLM_API_KEY
  const previousOpenAI = process.env.OPENAI_API_KEY
  if (offline) {
    delete process.env.LLM_API_KEY
    delete process.env.OPENAI_API_KEY
  }

  const scenarios: ScenarioEvalResult[] = []
  try {
    for (const scenario of selected) {
      const fixture = scenario.build()
      const response = await coachCampaign({
        state: fixture.state,
        log: fixture.log,
        messages: fixture.messages,
        queuedOrders: fixture.queuedOrders,
        selectedProvinceId: fixture.selectedProvinceId,
      })

      const hardRules = checkHardRules(response.reply, fixture.facts)
      const result: ScenarioEvalResult = {
        id: scenario.id,
        title: scenario.title,
        blindSpot: scenario.blindSpot,
        mode: offline ? "offline" : "live",
        source: response.source,
        reply: response.reply,
        followUp: response.followUp,
        hardRules,
        hardPass: hardRulesPassed(hardRules),
        pedagogy: null,
      }

      if (wantPedagogy && judgeModel) {
        const playerMessages = fixture.messages
          .filter((message) => message.role === "user")
          .map((message) => message.content)
        result.pedagogy = await gradePedagogy({
          scenarioId: scenario.id,
          title: scenario.title,
          blindSpot: scenario.blindSpot,
          playerMessages,
          reply: response.reply,
          judgeModel,
          target: primary ? targetFromProvider(primary) : undefined,
        })
      }

      scenarios.push(result)
    }
  } finally {
    if (offline) {
      if (previousKey === undefined) delete process.env.LLM_API_KEY
      else process.env.LLM_API_KEY = previousKey
      if (previousOpenAI === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = previousOpenAI
    }
  }

  const hardPassCount = scenarios.filter((item) => item.hardPass).length
  const pedagogyGraded = scenarios.filter((item) => item.pedagogy && !item.pedagogy.error)
  return {
    mode: offline ? "offline" : "live",
    generatedAt: new Date().toISOString(),
    coachModel: offline ? null : coachModel,
    judgeModel: wantPedagogy ? judgeModel : null,
    scenarios,
    hardPassCount,
    hardFailCount: scenarios.length - hardPassCount,
    pedagogyPassCount: pedagogyGraded.length
      ? pedagogyGraded.filter((item) => item.pedagogy!.allPass).length
      : null,
    pedagogyFailCount: pedagogyGraded.length
      ? pedagogyGraded.filter((item) => !item.pedagogy!.allPass).length
      : null,
  }
}

export function formatCoachEvalTable(report: CoachEvalReport): string {
  const rows = report.scenarios.map((scenario) => {
    const hard = scenario.hardPass ? "PASS" : "FAIL"
    const ped =
      scenario.pedagogy == null
        ? "—"
        : scenario.pedagogy.error
          ? "ERR"
          : scenario.pedagogy.allPass
            ? "PASS"
            : "FAIL"
    const fails = scenario.hardRules
      .filter((rule) => !rule.pass)
      .map((rule) => rule.id)
      .join(",")
    return {
      id: scenario.id,
      hard,
      ped,
      source: scenario.source,
      fails: fails || "—",
    }
  })

  const idWidth = Math.max(4, ...rows.map((row) => row.id.length))
  const lines = [
    `${"ID".padEnd(idWidth)}  HARD  PED   SOURCE    FAILS`,
    `${"-".repeat(idWidth)}  ----  ----  --------  -----`,
    ...rows.map(
      (row) =>
        `${row.id.padEnd(idWidth)}  ${row.hard.padEnd(4)}  ${row.ped.padEnd(4)}  ${row.source.padEnd(8)}  ${row.fails}`,
    ),
  ]
  return lines.join("\n")
}

export function formatCoachEvalDetails(report: CoachEvalReport): string {
  const blocks: string[] = []
  for (const scenario of report.scenarios) {
    blocks.push(`## ${scenario.id} — ${scenario.title}`)
    blocks.push(`Blind spot: ${scenario.blindSpot}`)
    blocks.push(`Source: ${scenario.source} | Hard: ${scenario.hardPass ? "PASS" : "FAIL"}`)
    blocks.push(`Reply: ${scenario.reply}`)
    if (scenario.followUp) blocks.push(`Follow-up: ${scenario.followUp}`)
    for (const rule of scenario.hardRules) {
      blocks.push(`  [${rule.pass ? "ok" : "FAIL"}] ${rule.id}: ${rule.detail}`)
    }
    if (scenario.pedagogy?.error) {
      blocks.push(`  Pedagogy error: ${scenario.pedagogy.error}`)
    } else if (scenario.pedagogy) {
      for (const criterion of scenario.pedagogy.criteria) {
        blocks.push(
          `  [${criterion.pass ? "ok" : "FAIL"}] ${criterion.id}: ${criterion.rationale}`,
        )
      }
    }
    blocks.push("")
  }
  return blocks.join("\n")
}
