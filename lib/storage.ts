import { blankCampaign } from "@/lib/data/campaign"
import { CATALOG_BY_ID, PROVINCE_COUNT } from "@/lib/data/catalog"
import { createInitialState, createScenario } from "@/lib/data/scenario"
import type { Difficulty, GameState, Province, SaveGame, ScenarioId } from "@/lib/types"

const KEY = "ostfront-1915-v1"

export function freshGame(scenario: ScenarioId = "campaign-1915", difficulty: Difficulty = "normal"): SaveGame {
  return { version: 2, state: createScenario(scenario, difficulty), log: [] }
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
function withCampaign(state: GameState): GameState {
  const blank = blankCampaign(state.difficulty ?? "normal")
  return {
    ...blank,
    ...state,
    scenario: state.scenario ?? blank.scenario,
    difficulty: state.difficulty ?? blank.difficulty,
    treasury: state.treasury ?? blank.treasury,
    queue: state.queue ?? [],
    result: state.result ?? null,
    capturedOn: state.capturedOn ?? {},
    homeLost: state.homeLost ?? false,
    cpStrengthLost: state.cpStrengthLost ?? 0,
  }
}

function migrateSave(parsed: { state: GameState; log?: SaveGame["log"] }): SaveGame | null {
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
    version: 2,
    log: parsed.log ?? [],
    state: rebindTopology(withCampaign({ ...parsed.state, provinces })),
  }
}

export function loadGame(): SaveGame | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { version?: number; state?: GameState; log?: SaveGame["log"] }
    if ((parsed?.version !== 1 && parsed?.version !== 2) || !parsed.state?.provinces) return null
    const state = parsed.state
    const save = state.provinces.length !== PROVINCE_COUNT ? migrateSave({ state, log: parsed.log }) : {
      version: 2 as const,
      log: parsed.log ?? [],
      state: rebindTopology(withCampaign(state)),
    }
    return save
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
