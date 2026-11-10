import { playTurn } from "@/lib/gm"
import type { PlayerOrder, SaveGame, TurnRecord } from "@/lib/types"

export type ServerTurnResult =
  | { ok: true; save: SaveGame; record: TurnRecord }
  | { ok: false; status: number; error: string; code?: string }

export async function resolveCampaignTurn(
  save: SaveGame,
  expectedTurn: number,
  orders: PlayerOrder[],
): Promise<ServerTurnResult> {
  if (save.state.turn !== expectedTurn) {
    return {
      ok: false,
      status: 409,
      code: "stale_turn",
      error: `Expected fortnight ${expectedTurn}, but the server holds fortnight ${save.state.turn}. Reload or start a new campaign.`,
    }
  }
  if (save.state.result) {
    return {
      ok: false,
      status: 409,
      code: "campaign_closed",
      error: "This campaign is already decided. Start a new campaign to play again.",
    }
  }
  const gameId = save.gameId
  if (!gameId) {
    return {
      ok: false,
      status: 400,
      code: "missing_game",
      error: "This save is not tied to a server campaign. Start a new campaign.",
    }
  }

  const result = await playTurn(save.state, orders)
  const nextSave: SaveGame = {
    version: 2,
    gameId,
    state: result.state,
    log: [...save.log, result.record],
  }
  return { ok: true, save: nextSave, record: result.record }
}
