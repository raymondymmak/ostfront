import type { GameState, SaveGame } from "@/lib/types"

/** Remove combat RNG secrets before any browser-visible JSON. */
export function stripSeedFromState<T extends GameState>(state: T): Omit<T, "seed"> {
  const publicState = { ...state }
  delete publicState.seed
  return publicState
}

export function publicSavePayload(gameId: string, save: SaveGame): {
  gameId: string
  state: Omit<GameState, "seed">
  log: SaveGame["log"]
} {
  return {
    gameId,
    state: stripSeedFromState(save.state),
    log: save.log,
  }
}

export function jsonHasNoSeed(payload: unknown): boolean {
  const text = JSON.stringify(payload)
  return !/"seed"\s*:/.test(text)
}
