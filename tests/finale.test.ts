import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createInitialState } from "@/lib/data/scenario"
import { gradeLabel } from "@/lib/engine/victory"
import { decideFortnight } from "@/lib/engine/victory"
import {
  BACK_TO_MAP_LABEL,
  FINAL_POSITIONS_LABEL,
  SEE_RESULT_LABEL,
  finalePhase,
  logisticsForPhase,
  ordersLocked,
  statusLabel,
} from "@/lib/finale"
import { clearGame, freshGame, loadGame, saveGame } from "@/lib/storage"
import type { CampaignGrade, Province } from "@/lib/types"

const GRADES: CampaignGrade[] = ["brilliant", "decisive", "victory", "marginal", "draw", "defeat"]

function hold(state: { provinces: Province[] }, id: string, controller: Province["controller"]) {
  const province = state.provinces.find((item) => item.id === id)
  if (!province) throw new Error(`missing ${id}`)
  province.controller = controller
}

describe("finale", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("keeps a live campaign in play and a finished one on the map", () => {
    expect(finalePhase(false, false)).toBe("playing")
    expect(finalePhase(false, true)).toBe("playing")
    expect(finalePhase(true, false)).toBe("map")
    expect(finalePhase(true, true)).toBe("result")
    expect(ordersLocked(false)).toBe(false)
    expect(ordersLocked(true)).toBe(true)
  })

  it("lands the clock, a decisive sweep, and a Kraków defeat on the final map", () => {
    const clock = createInitialState()
    clock.turn = 5
    clock.date = "11 July 1915"
    const drawn = decideFortnight(clock)
    expect(drawn?.grade).toBe("draw")
    expect(drawn?.sudden).toBe(false)

    const sweep = createInitialState()
    sweep.turn = 4
    for (const id of ["lwow", "lublin", "wolyn"]) hold(sweep, id, "central")
    const decisive = decideFortnight(sweep)
    expect(decisive?.grade === "decisive" || decisive?.grade === "brilliant").toBe(true)

    const fallen = createInitialState()
    fallen.turn = 5
    fallen.date = "11 July 1915"
    hold(fallen, "krakow", "russia")
    const defeat = decideFortnight(fallen)
    expect(defeat?.grade).toBe("defeat")

    for (const result of [drawn, decisive, defeat]) {
      expect(result).not.toBeNull()
      expect(finalePhase(true, false)).toBe("map")
      expect(ordersLocked(true)).toBe(true)
      expect(statusLabel(true, result!.grade)).toBe(FINAL_POSITIONS_LABEL)
    }
  })

  it("does not put the grade on the final-map summary", () => {
    const summary = `${FINAL_POSITIONS_LABEL} · 11 July 1915 ${SEE_RESULT_LABEL}`
    for (const grade of GRADES) {
      expect(summary.toLowerCase()).not.toContain(gradeLabel(grade).toLowerCase())
      expect(statusLabel(false, grade)).toBe(gradeLabel(grade))
    }
    expect(BACK_TO_MAP_LABEL).toBe("Back to the map")
    expect(SEE_RESULT_LABEL).toBe("Campaign over — see the result")
  })

  it("holds the grade sentence out of the chronicle until the result screen", () => {
    const lines = [
      "Central Powers collect 12 manpower and 9 industry.",
      "The campaign ends: Victory. 6 victory points by the last fortnight. Score 594.",
      "Russia collects 8 manpower and 3 industry.",
    ]
    expect(logisticsForPhase(lines, "map")).toEqual([
      "Central Powers collect 12 manpower and 9 industry.",
      "Russia collects 8 manpower and 3 industry.",
    ])
    expect(logisticsForPhase(lines, "result")).toEqual(lines)
    expect(logisticsForPhase(lines, "playing")).toEqual(lines)
  })

  it("reloads a finished save onto the final map without wiping it", () => {
    const memory = new Map<string, string>()
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => memory.get(key) ?? null,
        setItem: (key: string, value: string) => {
          memory.set(key, value)
        },
        removeItem: (key: string) => {
          memory.delete(key)
        },
      },
    })

    const game = freshGame()
    game.state.turn = 5
    game.state.date = "11 July 1915"
    hold(game.state, "krakow", "russia")
    game.state.result = decideFortnight(game.state)
    game.log = [
      {
        turn: 5,
        date: "11 July 1915",
        narration: "Kraków has fallen.",
        diplomacy: [],
        resolutions: [],
        events: [],
        controlChanges: [],
        logistics: ["The campaign ends: Defeat. Russia holds Kraków when the campaign closes. Score 0."],
        notes: [],
        gmSource: "mock",
      },
    ]
    saveGame(game)

    const loaded = loadGame()
    expect(loaded?.state.result?.grade).toBe("defeat")
    expect(loaded?.state.date).toBe("11 July 1915")
    expect(loaded?.state.provinces.find((province) => province.id === "krakow")?.controller).toBe("russia")
    expect(loaded?.log).toHaveLength(1)
    expect(loaded?.log[0]?.narration).toBe("Kraków has fallen.")
    expect(finalePhase(Boolean(loaded?.state.result), false)).toBe("map")
    expect(logisticsForPhase(loaded?.log[0]?.logistics ?? [], "map")).toEqual([])
    clearGame()
  })

  it("wires the map banner, the result screen, and the order lock", () => {
    const app = readFileSync("components/game-app.tsx", "utf8")
    const hud = readFileSync("components/hud.tsx", "utf8")
    const orders = readFileSync("components/order-panel.tsx", "utf8")
    const province = readFileSync("components/province-panel.tsx", "utf8")
    const chronicle = readFileSync("components/timeline-panel.tsx", "utf8")

    expect(app).toContain('useState(false)')
    expect(app).toContain("finalePhase")
    expect(app).toContain('data-testid="see-result"')
    expect(app).toContain('data-testid="back-to-map"')
    expect(app).toContain('data-testid="finale-summary"')
    expect(app).toContain('phase === "result" && game.state.result && !setupOpen')
    expect(app).toContain("orderMode && !finished")
    expect(hud).toContain("statusLabel")
    expect(orders).toContain("ordersLocked")
    expect(orders).toContain("disabled={closed}")
    expect(province).toContain("ordersLocked")
    expect(chronicle).toContain("logisticsForPhase")
  })
})
