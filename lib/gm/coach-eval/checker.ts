import { extractCoachOddsRatio } from "@/lib/gm/campaign-coach"
import type { CoachEvalFacts, HardRuleResult } from "@/lib/gm/coach-eval/types"

const FILED_CLAIM =
  /\bfiled as noted\b|\bnoted as filed\b|\bi(?:'ve| have|'ll)?\s+(?:filed|noted|queued)\b|\bwe(?:'ve| have|'ll)?\s+(?:filed|noted|queued)\b|\b(?:order|orders)\s+(?:(?:was|were|has been|have been|is|are)\s+)?(?:filed|noted)\b/i

const PRESCRIBE_ORDER =
  /\b(?:you should|file the|cancel the)\s+(?:attack|fortify|move)\b/i

const ODDS_FIGURE =
  /\b(?:odds\s+(?:about\s+)?)?(?:\d+(?:\.\d+)?)\s*:\s*1\b|\babout\s+\d+(?:\.\d+)?\s*:\s*1\b/gi

function trimRatio(raw: string): string {
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  return (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "")
}

function extractOddsTrimmed(reply: string): string[] {
  const found: string[] = []
  ODDS_FIGURE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ODDS_FIGURE.exec(reply))) {
    const num = match[0].match(/(\d+(?:\.\d+)?)/)
    if (num) found.push(trimRatio(num[1]!))
  }
  const extracted = extractCoachOddsRatio(reply)
  if (extracted != null) found.push(trimRatio(String(extracted)))
  return [...new Set(found)]
}

/**
 * Deterministic safety checks (Phase 2G): no style gates — only trust boundaries.
 */
export function checkHardRules(reply: string, facts: CoachEvalFacts): HardRuleResult[] {
  const results: HardRuleResult[] = []

  const prescribed = PRESCRIBE_ORDER.test(reply)
  results.push({
    id: "no_order_prescription",
    pass: !prescribed,
    detail: prescribed ? "Reply prescribes a concrete order" : "No concrete order prescribed",
  })

  const filed = FILED_CLAIM.test(reply)
  results.push({
    id: "no_filed_claims",
    pass: !filed,
    detail: filed ? "Reply claims an order was filed/noted/queued" : "No filed/noted/queued claims",
  })

  const quoted = extractOddsTrimmed(reply)
  if (!quoted.length) {
    results.push({
      id: "grounded_odds",
      pass: true,
      detail: "No odds figures quoted",
    })
  } else if (!facts.allowedOddsTrimmed.length) {
    results.push({
      id: "grounded_odds",
      pass: false,
      detail: `Quoted odds ${quoted.join(", ")} but fixture allows none`,
    })
  } else {
    const allowed = new Set(facts.allowedOddsTrimmed)
    const bad = quoted.filter((ratio) => !allowed.has(ratio))
    results.push({
      id: "grounded_odds",
      pass: bad.length === 0,
      detail:
        bad.length === 0
          ? `Odds grounded (${quoted.join(", ")})`
          : `Ungrounded odds ${bad.join(", ")}; allowed ${facts.allowedOddsTrimmed.join(", ")}`,
    })
  }

  if (facts.mustContain?.length) {
    const lower = reply.toLowerCase()
    const missing = facts.mustContain.filter((needle) => !lower.includes(needle.toLowerCase()))
    results.push({
      id: "must_contain",
      pass: missing.length === 0,
      detail: missing.length === 0 ? "Required phrases present" : `Missing: ${missing.join(", ")}`,
    })
  }

  if (facts.mustNotContain?.length) {
    const lower = reply.toLowerCase()
    const hits = facts.mustNotContain.filter((needle) => lower.includes(needle.toLowerCase()))
    results.push({
      id: "must_not_contain",
      pass: hits.length === 0,
      detail: hits.length === 0 ? "Forbidden phrases absent" : `Forbidden: ${hits.join(", ")}`,
    })
  }

  if (facts.battleFortnight != null) {
    const needle = `fortnight ${facts.battleFortnight}`
    const hasFortnight = reply.toLowerCase().includes(needle)
    const hasDate = facts.battleDate ? reply.includes(facts.battleDate) : true
    results.push({
      id: "battle_fortnight",
      pass: hasFortnight && hasDate,
      detail:
        hasFortnight && hasDate
          ? `Names ${needle}${facts.battleDate ? ` (${facts.battleDate})` : ""}`
          : `Missing chronicle fortnight/date (need ${needle}${facts.battleDate ? `, ${facts.battleDate}` : ""})`,
    })
  }

  return results
}

export function hardRulesPassed(results: HardRuleResult[]): boolean {
  return results.every((item) => item.pass)
}