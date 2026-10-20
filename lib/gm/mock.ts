import { stavkaTurn } from "@/lib/ai/stavka"
import type { GameState, GMTurn, PlayerOrder } from "@/lib/types"

/** Deterministic Stavka. The live site has no model key, so this is the opponent. */
export function mockAiTurn(state: GameState, orders: PlayerOrder[]): GMTurn {
  return stavkaTurn(state, orders)
}
