import type { AdvisorChatMessage } from "@/lib/gm/advisor-types"
import type { CampaignCoachResponse } from "@/lib/gm/campaign-coach"
import type { GameState, PlayerOrder, TurnRecord } from "@/lib/types"

/** Engine-grounded facts the Layer 1 checker asserts against a coach reply. */
export type CoachEvalFacts = {
  /** Province display names the reply may cite for this board. */
  allowedProvinceNames: string[]
  /**
   * Odds figures the coach may quote (coach trimRatio form, e.g. "0.5" or "7.6").
   * Empty means any numeric X:1 odds figure is a grounding failure.
   */
  allowedOddsTrimmed: string[]
  /** When set, reply must name this fortnight (e.g. "fortnight 1"). */
  battleFortnight?: number
  /** When set, reply must include this chronicle date substring. */
  battleDate?: string
  /** Reply must include each substring (case-insensitive). */
  mustContain?: string[]
  /** Reply must not include each substring (case-insensitive). */
  mustNotContain?: string[]
}

export type CoachEvalFixture = {
  state: GameState
  log: TurnRecord[]
  messages: AdvisorChatMessage[]
  queuedOrders: PlayerOrder[]
  selectedProvinceId?: string | null
  facts: CoachEvalFacts
}

export type CoachEvalScenario = {
  id: string
  title: string
  /** Real mistake / trade-off the rubric grader should look for. */
  blindSpot: string
  build: () => CoachEvalFixture
}

export type HardRuleId =
  | "sentence_budget"
  | "ends_clean"
  | "question_first"
  | "no_banned_jargon"
  | "no_dangling_clause"
  | "no_filed_claims"
  | "grounded_odds"
  | "grounded_provinces"
  | "battle_fortnight"
  | "must_contain"
  | "must_not_contain"

export type HardRuleResult = {
  id: HardRuleId
  pass: boolean
  detail: string
}

export type PedagogyCriterionId =
  | "blind_spot"
  | "socratic"
  | "map_revelation"
  | "tone"

export type PedagogyCriterionResult = {
  id: PedagogyCriterionId
  pass: boolean
  rationale: string
}

export type PedagogyGrade = {
  criteria: PedagogyCriterionResult[]
  allPass: boolean
  raw?: string
  error?: string
}

export type ScenarioEvalResult = {
  id: string
  title: string
  blindSpot: string
  mode: "offline" | "live"
  source: CampaignCoachResponse["source"]
  reply: string
  followUp: string | null
  hardRules: HardRuleResult[]
  hardPass: boolean
  pedagogy: PedagogyGrade | null
}

export type CoachEvalReport = {
  mode: "offline" | "live"
  generatedAt: string
  coachModel: string | null
  judgeModel: string | null
  scenarios: ScenarioEvalResult[]
  hardPassCount: number
  hardFailCount: number
  pedagogyPassCount: number | null
  pedagogyFailCount: number | null
}
