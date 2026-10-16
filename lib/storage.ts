import { createInitialState } from "@/lib/data/scenario"
import type { SaveGame } from "@/lib/types"

const KEY = "ostfront-1915-v1"

export function freshGame(): SaveGame {
  return { version: 1, state: createInitialState(), log: [] }
}

export function loadGame(): SaveGame | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SaveGame
    if (parsed?.version !== 1 || parsed.state?.provinces?.length !== 40) return null
    return parsed
  } catch {
    return null
  }
}

export function saveGame(game: SaveGame) {
  window.localStorage.setItem(KEY, JSON.stringify(game))
}

export function clearGame() {
  window.localStorage.removeItem(KEY)
}
