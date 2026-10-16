import { rebindState } from "@/lib/data/scenario"
import { resolveTurn } from "@/lib/engine/turn"
import { findUnit } from "@/lib/engine/turn"
import { interpretOrders } from "@/lib/gm/interpret"
import { llmAiTurn } from "@/lib/gm/llm"
import { mockAiTurn } from "@/lib/gm/mock"
import type {
  GameState,
  GMTurn,
  PlayerOrder,
  Proposal,
  TurnRecord,
} from "@/lib/types"

export async function playTurn(
  state: GameState,
  orders: PlayerOrder[],
): Promise<{ state: GameState; record: TurnRecord }> {
  const rebound = rebindState(state)
  const interpreted = interpretOrders(rebound, orders)
  let source: "mock" | "llm" = "mock"
  let warning: string | undefined
  let ai: GMTurn

  if (!process.env.LLM_API_KEY) {
    ai = mockAiTurn(rebound, orders)
  } else {
    try {
      ai = await llmAiTurn(rebound, orders)
      source = "llm"
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error"
      warning = `The game master could not be reached (${message}). The staff simulation took the turn.`
      ai = mockAiTurn(rebound, orders)
    }
  }

  const staff = ai.proposals
    .filter((proposal) => !isCentralAction(rebound, proposal))
    .filter((proposal) => !isDuplicate(proposal, interpreted.proposals))
    .slice(0, 12)

  const gm: GMTurn = {
    narration: ai.narration,
    proposals: [...interpreted.proposals, ...staff],
    events: ai.events.slice(0, 3),
    diplomacy: ai.diplomacy.slice(0, 3),
  }

  return resolveTurn(rebound, gm, {
    notes: interpreted.notes,
    gmSource: source,
    warning,
  })
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
  }
}
