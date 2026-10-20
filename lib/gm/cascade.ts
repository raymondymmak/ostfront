import { resolveTurn } from "@/lib/engine/turn"
import { findUnit } from "@/lib/engine/turn"
import type { InterpretedOrders } from "@/lib/gm/interpret"
import { llmAiTurn, resolveLlmModels } from "@/lib/gm/llm"
import { logGmCall } from "@/lib/gm/route-log"
import { scoreTurn, type TurnTier } from "@/lib/gm/tier"
import type {
  GameState,
  GMTurn,
  PlayerOrder,
  Proposal,
} from "@/lib/types"

export const REJECTION_ESCALATION_RATE = 0.3
export const GM_TURN_BUDGET_MS = 28_000
export const GM_SINGLE_CALL_TIMEOUT_MS = 14_000

export type CascadePlan = {
  tier: TurnTier
  primaryModel: string
  mayEscalate: boolean
  escalationModel: string | null
}

export function planCascade(
  state: GameState,
  orders: PlayerOrder[],
  models = resolveLlmModels(),
): CascadePlan {
  const { tier } = scoreTurn(state, orders)
  const useStrongFirst =
    models.strong !== null && (tier === "important" || tier === "critical")
  const primaryModel = useStrongFirst ? models.strong! : models.cheap
  const mayEscalate = models.strong !== null && primaryModel !== models.strong
  return {
    tier,
    primaryModel,
    mayEscalate,
    escalationModel: mayEscalate ? models.strong : null,
  }
}

export type CascadeOutcome =
  | { ok: true; turn: GMTurn; warning?: string }
  | { ok: false; warning: string }

export async function fetchGmWithCascade(
  state: GameState,
  orders: PlayerOrder[],
  interpreted: InterpretedOrders,
): Promise<CascadeOutcome> {
  const models = resolveLlmModels()
  const plan = planCascade(state, orders, models)
  const deadline = Date.now() + GM_TURN_BUDGET_MS

  const firstTimeout = timeoutForAttempt(deadline, plan.mayEscalate)
  const first = await llmAiTurn(state, orders, {
    model: plan.primaryModel,
    timeoutMs: firstTimeout,
  })

  logGmCall({
    tag: "ostfront.gm.call",
    tier: plan.tier,
    model: plan.primaryModel,
    latencyMs: first.latencyMs,
    outcome: first.ok ? "ok" : outcomeFromFailure(first),
    escalated: false,
    attempt: 1,
    zodIssueCount: first.ok ? 0 : first.zodIssueCount,
    error: first.ok ? undefined : sanitizeError(first.message),
  })

  if (first.ok) {
    const rejection = measureRejectionRate(state, first.turn, interpreted)
    if (
      plan.mayEscalate &&
      plan.escalationModel &&
      shouldEscalateOnRejections(rejection.rate)
    ) {
      const secondTimeout = timeoutForAttempt(deadline, false)
      if (secondTimeout < 3000) {
        logGmCall({
          tag: "ostfront.gm.call",
          tier: plan.tier,
          model: plan.escalationModel,
          latencyMs: 0,
          outcome: "escalated_skip",
          escalated: true,
          attempt: 2,
          rejectionRate: rejection.rate,
          rejectedCount: rejection.rejected,
          proposalCount: rejection.total,
          error: "time budget exhausted",
        })
        return { ok: true, turn: first.turn }
      }

      const second = await llmAiTurn(state, orders, {
        model: plan.escalationModel,
        timeoutMs: secondTimeout,
      })
      logGmCall({
        tag: "ostfront.gm.call",
        tier: plan.tier,
        model: plan.escalationModel,
        latencyMs: second.latencyMs,
        outcome: second.ok ? "ok" : outcomeFromFailure(second),
        escalated: true,
        attempt: 2,
        zodIssueCount: second.ok ? 0 : second.zodIssueCount,
        proposalCount: rejection.total,
        rejectedCount: rejection.rejected,
        rejectionRate: rejection.rate,
        error: second.ok ? undefined : sanitizeError(second.message),
      })
      if (second.ok) return { ok: true, turn: second.turn }
      return {
        ok: false,
        warning: `Strong model retry failed (${second.message}).`,
      }
    }
    return { ok: true, turn: first.turn }
  }

  if (
    plan.mayEscalate &&
    plan.escalationModel &&
    (first.kind === "zod" || first.kind === "empty")
  ) {
    const secondTimeout = timeoutForAttempt(deadline, false)
    if (secondTimeout < 3000) {
      return {
        ok: false,
        warning: `Game master validation failed and there was no time to retry (${first.message}).`,
      }
    }
    const second = await llmAiTurn(state, orders, {
      model: plan.escalationModel,
      timeoutMs: secondTimeout,
    })
    logGmCall({
      tag: "ostfront.gm.call",
      tier: plan.tier,
      model: plan.escalationModel,
      latencyMs: second.latencyMs,
      outcome: second.ok ? "ok" : outcomeFromFailure(second),
      escalated: true,
      attempt: 2,
      zodIssueCount: second.ok ? 0 : second.zodIssueCount,
      error: second.ok ? undefined : sanitizeError(second.message),
    })
    if (second.ok) return { ok: true, turn: second.turn }
    return {
      ok: false,
      warning: `Game master could not produce valid JSON (${second.message}).`,
    }
  }

  return {
    ok: false,
    warning: `The game master could not be reached (${first.message}).`,
  }
}

export function shouldEscalateOnRejections(rate: number): boolean {
  return rate > REJECTION_ESCALATION_RATE
}

export function measureRejectionRate(
  state: GameState,
  ai: GMTurn,
  interpreted: InterpretedOrders,
): { total: number; rejected: number; rate: number } {
  const gm = buildStaffTurn(state, ai, interpreted)
  const { record } = resolveTurn(structuredClone(state), gm, { gmSource: "llm" })
  const total = record.resolutions.length
  const rejected = record.resolutions.filter(
    (item) => item.status === "rejected",
  ).length
  const rate = total === 0 ? 0 : rejected / total
  return { total, rejected, rate }
}

export function buildStaffTurn(
  state: GameState,
  ai: GMTurn,
  interpreted: InterpretedOrders,
): GMTurn {
  const staff = ai.proposals
    .filter((proposal) => !isCentralAction(state, proposal))
    .filter((proposal) => !isDuplicate(proposal, interpreted.proposals))
    .slice(0, 12)

  return {
    narration: ai.narration,
    proposals: [...interpreted.proposals, ...staff],
    events: ai.events.slice(0, 3),
    diplomacy: ai.diplomacy.slice(0, 3),
  }
}

function timeoutForAttempt(deadline: number, anotherMayFollow: boolean): number {
  const remaining = deadline - Date.now()
  if (anotherMayFollow) {
    const half = Math.floor(remaining / 2)
    return Math.min(GM_SINGLE_CALL_TIMEOUT_MS, Math.max(3000, half))
  }
  return Math.min(GM_SINGLE_CALL_TIMEOUT_MS, Math.max(3000, remaining))
}

function outcomeFromFailure(
  result: Extract<Awaited<ReturnType<typeof llmAiTurn>>, { ok: false }>,
): "zod_fail" | "http_error" | "timeout" | "empty" {
  if (result.kind === "zod") return "zod_fail"
  if (result.kind === "timeout") return "timeout"
  if (result.kind === "empty") return "empty"
  return "http_error"
}

function sanitizeError(message: string): string {
  return message.slice(0, 200)
}

function isCentralAction(state: GameState, proposal: Proposal): boolean {
  if (proposal.type === "move") {
    return findUnit(state, proposal.unit)?.unit.faction === "central"
  }
  if (proposal.type === "attack") {
    return proposal.units.some(
      (id) => findUnit(state, id)?.unit.faction === "central",
    )
  }
  if (proposal.type === "fortify") {
    return (
      state.provinces.find((province) => province.id === proposal.province)
        ?.controller === "central"
    )
  }
  if (proposal.type === "recruit") return proposal.faction === "central"
  if (proposal.type === "cancelRecruit") {
    return state.queue.some((job) => job.id === proposal.id && job.faction === "central")
  }
  if (proposal.type === "modify") {
    return (
      state.provinces.find((province) => province.id === proposal.province)?.controller ===
      "central"
    )
  }
  return false
}

function isDuplicate(proposal: Proposal, existing: Proposal[]): boolean {
  const key = proposalKey(proposal)
  return existing.some((item) => proposalKey(item) === key)
}

function proposalKey(proposal: Proposal): string {
  switch (proposal.type) {
    case "move":
      return `move:${proposal.unit}:${proposal.to}`
    case "attack":
      return `attack:${proposal.from}:${proposal.target}:${[...proposal.units].sort().join(",")}`
    case "fortify":
      return `fortify:${proposal.province}`
    case "modify":
      return `modify:${proposal.province}:${proposal.field}:${proposal.delta}`
    case "recruit":
      return `recruit:${proposal.faction}:${proposal.province}:${proposal.kind}`
    case "cancelRecruit":
      return `cancel:${proposal.id}`
  }
}
