import { rebindState } from "@/lib/data/scenario"
import { resolveTurn } from "@/lib/engine/turn"
import { buildStaffTurn, fetchGmWithCascade } from "@/lib/gm/cascade"
import { interpretOrders } from "@/lib/gm/interpret"
import { llmConfigured } from "@/lib/gm/llm"
import { mockAiTurn } from "@/lib/gm/mock"
import type {
  GameState,
  PlayerOrder,
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

  let gm
  if (!llmConfigured()) {
    gm = buildStaffTurn(rebound, mockAiTurn(rebound, orders), interpreted)
  } else {
    const fetched = await fetchGmWithCascade(rebound, orders, interpreted)
    if (fetched.ok) {
      source = "llm"
      gm = buildStaffTurn(rebound, fetched.turn, interpreted)
      warning = fetched.warning
    } else {
      warning = `${fetched.warning} The staff simulation took the turn.`
      gm = buildStaffTurn(rebound, mockAiTurn(rebound, orders), interpreted)
    }
  }

  return resolveTurn(rebound, gm, {
    notes: interpreted.notes,
    gmSource: source,
    warning,
  })
}
