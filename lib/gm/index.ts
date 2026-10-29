import { rebindState } from "@/lib/data/scenario"
import { resolveTurn } from "@/lib/engine/turn"
import { buildStaffTurn, fetchGmWithCascade } from "@/lib/gm/cascade"
import { formatGmDebug } from "@/lib/gm/debug"
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
  let gmDebug: string | undefined

  const staff = mockAiTurn(rebound, orders)
  let gm
  if (!llmConfigured()) {
    gm = buildStaffTurn(rebound, staff, interpreted)
  } else {
    const fetched = await fetchGmWithCascade(rebound, orders, interpreted)
    if (fetched.ok) {
      source = "llm"
      const flavour = fetched.turn.diplomacy.map((line) => line.trim()).filter(Boolean).slice(0, 2)
      gm = buildStaffTurn(
        rebound,
        { ...staff, diplomacy: flavour.length ? flavour : staff.diplomacy },
        interpreted,
      )
      warning = fetched.warning
    } else {
      warning = `${fetched.warning} The staff simulation took the turn.`
      gmDebug = formatGmDebug(fetched.debug)
      gm = buildStaffTurn(rebound, staff, interpreted)
    }
  }

  return resolveTurn(rebound, gm, {
    notes: interpreted.notes,
    gmSource: source,
    warning,
    gmDebug,
  })
}
