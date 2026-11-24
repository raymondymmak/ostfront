import {
  extractCoachOddsRatio,
  hasDanglingCoachClause,
  hasMissingQuestionMark,
  hasVerblessTrailingSubordinate,
  prescribesConcreteOrder,
  replyOpensWithOdds,
  scrubCoachFiledClaims,
  splitCoachSentences,
} from "@/lib/gm/campaign-coach"
import type { CoachEvalFacts, HardRuleResult } from "@/lib/gm/coach-eval/types"

const BANNED_JARGON =
  /\bbefore the dice\b|\bthe dice\b|\bcombined-odds board\b|\bstaff figures\b|\bledger\b|\bgmDebug\b|\braw supply\b|\bkey=value\b|\bUNIT_IDS?\b|\bDISPATCH\b|\bQUEUED_RESOLUTION_ODDS\b/i

const FILED_CLAIM =
  /\bfiled as noted\b|\bnoted as filed\b|\bi(?:'ve| have|'ll)?\s+(?:filed|noted|queued)\b|\bwe(?:'ve| have|'ll)?\s+(?:filed|noted|queued)\b|\b(?:order|orders)\s+(?:(?:was|were|has been|have been|is|are)\s+)?(?:filed|noted)\b|\b(?:it|that|this)\s+(?:(?:was|has been|is)\s+)?(?:filed|noted)\b/i

const ODDS_FIGURE =
  /\b(?:odds\s+(?:about\s+)?)?(?:\d+(?:\.\d+)?)\s*:\s*1\b|\babout\s+\d+(?:\.\d+)?\s*:\s*1\b/gi

function endsCleanly(reply: string): boolean {
  const trimmed = reply.trim()
  if (!trimmed) return false
  return /[.!?]$/.test(trimmed)
}

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

function provinceMentionsGrounded(reply: string, allowed: string[]): HardRuleResult {
  // Only flag clear catalog-style mismatches when the reply invents a ratio for a
  // place that is not on the board names list — names are matched case-insensitively.
  const lowerAllowed = new Set(allowed.map((name) => name.toLowerCase()))
  // Common English alias already folded into fixtures; scan for obvious invented labels.
  const suspicious = reply.match(/\b(?:Province|Sector)\s+[A-Z][a-z]+\b/g) ?? []
  for (const hit of suspicious) {
    const name = hit.replace(/^(?:Province|Sector)\s+/, "")
    if (!lowerAllowed.has(name.toLowerCase())) {
      return {
        id: "grounded_provinces",
        pass: false,
        detail: `Unexpected sector label ${JSON.stringify(hit)}`,
      }
    }
  }
  // If the reply quotes a known board name, it must be in the allowed set (always true
  // when allowed is the full catalog). Soft pass when no contradiction.
  void lowerAllowed
  return {
    id: "grounded_provinces",
    pass: true,
    detail: "No contradictory province labels detected",
  }
}

/**
 * Deterministic Layer 1 checks — run on every coach reply (offline and live).
 */
export function checkHardRules(reply: string, facts: CoachEvalFacts): HardRuleResult[] {
  const sentences = splitCoachSentences(reply)
  const results: HardRuleResult[] = []

  const budgetOk = sentences.length >= 1 && sentences.length <= 3
  results.push({
    id: "sentence_budget",
    pass: budgetOk,
    detail: budgetOk
      ? `${sentences.length} sentence(s)`
      : `Expected 1–3 sentences, found ${sentences.length}`,
  })

  const clean = endsCleanly(reply)
  results.push({
    id: "ends_clean",
    pass: clean,
    detail: clean ? "Ends on sentence punctuation" : "Reply is clipped or lacks terminal punctuation",
  })

  const first = sentences[0] ?? ""
  const questionFirst = first.includes("?") && !replyOpensWithOdds(first)
  results.push({
    id: "question_first",
    pass: questionFirst,
    detail: questionFirst
      ? "Opens with a question"
      : replyOpensWithOdds(first)
        ? `Odds figure leads the reply: ${JSON.stringify(first.slice(0, 80))}`
        : `First sentence is not a question: ${JSON.stringify(first.slice(0, 80))}`,
  })

  const jargon = BANNED_JARGON.test(reply)
  results.push({
    id: "no_banned_jargon",
    pass: !jargon,
    detail: jargon ? "Contains banned internal/debug jargon" : "No banned jargon",
  })

  const dangling =
    hasDanglingCoachClause(reply) ||
    sentences.some((sentence) => hasDanglingCoachClause(sentence)) ||
    sentences.some((sentence) => hasVerblessTrailingSubordinate(sentence)) ||
    hasMissingQuestionMark(reply) ||
    sentences.some((sentence) => hasMissingQuestionMark(sentence)) ||
    /\brising\s+to\s+if\b|\braise\s+it\s+to\s*[.!?]|\blift(?:ing)?\s+it\s+to\s*[.!?]|\bpools?\s+to\s+(?:only\s*)?[.!?]|\bmake\s+it\s+(?:two-pronged\s+)?at\s*[.!?]/i.test(
      reply,
    )
  results.push({
    id: "no_dangling_clause",
    pass: !dangling,
    detail: dangling
      ? "Dangling comparison / verbless subordinate / question missing ?"
      : "No dangling odds clauses",
  })

  const prescribed = sentences.some((sentence) => prescribesConcreteOrder(sentence)) || /\bi file no orders\b/i.test(reply)
  results.push({
    id: "no_order_prescription",
    pass: !prescribed,
    detail: prescribed
      ? "Reply prescribes a concrete order instead of asking the tradeoff"
      : "No concrete order prescribed",
  })

  const filed = FILED_CLAIM.test(reply)
  // Scrub helper must agree — if scrub would rewrite, treat as filed claim.
  const scrubbed = scrubCoachFiledClaims(reply)
  const filedViaScrub = scrubbed !== reply.trim() && /I do not file orders/i.test(scrubbed)
  results.push({
    id: "no_filed_claims",
    pass: !filed && !filedViaScrub,
    detail:
      filed || filedViaScrub
        ? "Reply claims an order was filed/noted/queued"
        : "No false filed/noted/queued claims",
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

  results.push(provinceMentionsGrounded(reply, facts.allowedProvinceNames))

  if (facts.mustContain?.length) {
    const lower = reply.toLowerCase()
    const missing = facts.mustContain.filter((needle) => !lower.includes(needle.toLowerCase()))
    results.push({
      id: "must_contain",
      pass: missing.length === 0,
      detail:
        missing.length === 0
          ? "Required phrases present"
          : `Missing: ${missing.join(", ")}`,
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
