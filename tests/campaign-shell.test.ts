import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  bootCampaignShell,
  campaignShellReducer,
  shellBeginBusy,
  shellIsSetup,
  shellResultOpen,
  shellStale,
  shellTurnBusy,
  type CampaignShellState,
} from "@/lib/ui/campaign-shell"
import { clearGame, freshGame, loadGame, peekSave, saveGame } from "@/lib/storage"

const TABLE_IDLE: CampaignShellState = {
  kind: "table",
  gameId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  turn: "idle",
  stale: false,
  resultOpen: false,
}

describe("campaign shell reducer", () => {
  it("boots to setup without a game id and to the table when one exists", () => {
    expect(bootCampaignShell(undefined)).toEqual({ kind: "setup", begin: "idle" })
    expect(bootCampaignShell("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")).toEqual({
      kind: "table",
      gameId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      turn: "idle",
      stale: false,
      resultOpen: false,
    })
  })

  it("runs the begin flow and ignores illegal begin actions", () => {
    let state = bootCampaignShell(undefined)
    state = campaignShellReducer(state, { type: "BEGIN_PENDING" })
    expect(state).toEqual({ kind: "setup", begin: "pending" })
    expect(shellBeginBusy(state)).toBe(true)

    const pendingAgain = campaignShellReducer(state, { type: "BEGIN_PENDING" })
    expect(pendingAgain).toBe(state)

    state = campaignShellReducer(state, {
      type: "BEGIN_SUCCESS",
      gameId: "cccccccccccccccccccccccccccccccc",
    })
    expect(shellIsSetup(state)).toBe(false)
    expect(state).toMatchObject({ kind: "table", gameId: "cccccccccccccccccccccccccccccccc" })

    const beginOnTable = campaignShellReducer(state, { type: "BEGIN_PENDING" })
    expect(beginOnTable).toBe(state)

    state = bootCampaignShell(undefined)
    state = campaignShellReducer(state, { type: "BEGIN_PENDING" })
    state = campaignShellReducer(state, { type: "BEGIN_IDLE" })
    expect(state).toEqual({ kind: "setup", begin: "idle" })
  })

  it("runs turn pending / success / failure and blocks without a game id", () => {
    let state: CampaignShellState = TABLE_IDLE
    state = campaignShellReducer(state, { type: "TURN_PENDING" })
    expect(shellTurnBusy(state)).toBe(true)

    const doublePending = campaignShellReducer(state, { type: "TURN_PENDING" })
    expect(doublePending).toBe(state)

    state = campaignShellReducer(state, { type: "TURN_SUCCESS" })
    expect(shellTurnBusy(state)).toBe(false)
    expect(shellStale(state)).toBe(false)

    state = campaignShellReducer(state, { type: "TURN_FAILURE", stale: true })
    expect(shellStale(state)).toBe(true)

    state = campaignShellReducer(state, { type: "TURN_SUCCESS" })
    expect(shellStale(state)).toBe(false)

    state = campaignShellReducer(state, { type: "TURN_BLOCKED_NO_GAME" })
    expect(shellStale(state)).toBe(true)
    expect(shellTurnBusy(state)).toBe(false)
  })

  it("ignores turn and stale actions on the setup screen", () => {
    const setup = bootCampaignShell(undefined)
    expect(campaignShellReducer(setup, { type: "TURN_PENDING" })).toBe(setup)
    expect(campaignShellReducer(setup, { type: "CLEAR_STALE" })).toBe(setup)
    expect(campaignShellReducer(setup, { type: "OPEN_RESULT" })).toBe(setup)
  })

  it("toggles finale result UI only on the table", () => {
    let state: CampaignShellState = TABLE_IDLE
    state = campaignShellReducer(state, { type: "OPEN_RESULT" })
    expect(shellResultOpen(state)).toBe(true)
    state = campaignShellReducer(state, { type: "CLOSE_RESULT" })
    expect(shellResultOpen(state)).toBe(false)

    const setup = bootCampaignShell(undefined)
    expect(campaignShellReducer(setup, { type: "OPEN_RESULT" })).toBe(setup)
  })

  it("enters setup from anywhere and clears begin / turn flags", () => {
    const fromTable = campaignShellReducer(
      { ...TABLE_IDLE, turn: "pending", stale: true, resultOpen: true },
      { type: "ENTER_SETUP" },
    )
    expect(fromTable).toEqual({ kind: "setup", begin: "idle" })
  })
})

describe("campaign shell boot vs localStorage", () => {
  afterEach(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      clearGame()
    }
    vi.unstubAllGlobals()
  })

  it("peeks an orphan save without gameId but keeps loadGame strict", () => {
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

    const orphan = { ...freshGame(), version: 2 as const }
    saveGame(orphan)
    expect(peekSave()).not.toBeNull()
    expect(peekSave()?.gameId).toBeUndefined()
    expect(loadGame()).toBeNull()
    expect(bootCampaignShell(peekSave()?.gameId)).toEqual({ kind: "setup", begin: "idle" })
  })

  it("loads a persisted server id into the table boot state", () => {
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

    const withId = {
      ...freshGame(),
      gameId: "dddddddddddddddddddddddddddddddd",
    }
    saveGame(withId)
    expect(loadGame()?.gameId).toBe(withId.gameId)
    expect(bootCampaignShell(loadGame()?.gameId)?.kind).toBe("table")
  })
})

describe("game-app wires the campaign shell", () => {
  it("uses the reducer instead of setup/begin/turn boolean lattice", () => {
    const app = readFileSync("components/game-app.tsx", "utf8")
    expect(app).toContain("campaignShellReducer")
    expect(app).toContain("bootCampaignShell")
    expect(app).toContain("shellIsSetup")
    expect(app).not.toContain("setSetupOpen")
    expect(app).not.toContain("setStaleCampaign")
    expect(app).not.toContain("setBeginBusy")
    expect(app).not.toMatch(/const \[busy, setBusy\]/)
    expect(app).not.toMatch(/useState\(\(\) => loadGame\(\) === null\)/)
  })
})