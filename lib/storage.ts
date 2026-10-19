import { CATALOG_BY_ID, PROVINCE_COUNT } from "@/lib/data/catalog"
import { createInitialState } from "@/lib/data/scenario"
import type { GameState, Province, SaveGame } from "@/lib/types"

const KEY = "ostfront-1915-v1"

export function freshGame(): SaveGame {
  return { version: 1, state: createInitialState(), log: [] }
}

function rebindTopology(state: GameState): GameState {
  return {
    ...state,
    provinces: state.provinces.map((province) => {
      const catalog = CATALOG_BY_ID[province.id]
      if (!catalog) return province
      return {
        ...province,
        neighbors: catalog.neighbors.slice(),
        rail: catalog.rail.slice(),
      }
    }),
  }
}

/** Keep campaign progress when the catalog topology changes but province ids stay the same. */
function migrateSave(parsed: SaveGame): SaveGame | null {
  const fresh = createInitialState()
  const savedById = new Map(parsed.state.provinces.map((province) => [province.id, province]))
  const provinces: Province[] = fresh.provinces.map((template) => {
    const saved = savedById.get(template.id)
    if (!saved) return template
    const catalog = CATALOG_BY_ID[template.id]
    return {
      ...saved,
      neighbors: catalog?.neighbors ?? template.neighbors,
      rail: catalog?.rail ?? template.rail,
    }
  })
  if (provinces.length !== PROVINCE_COUNT) return null
  return {
    ...parsed,
    state: rebindTopology({ ...parsed.state, provinces }),
  }
}

export function loadGame(): SaveGame | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SaveGame
    if (parsed?.version !== 1 || !parsed.state?.provinces) return null
    if (parsed.state.provinces.length !== PROVINCE_COUNT) {
      return migrateSave(parsed)
    }
    return { ...parsed, state: rebindTopology(parsed.state) }
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
