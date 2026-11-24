/**
 * Explicit campaign client lifecycle (setup vs table, begin/turn pending, stale, finale UI).
 * Replaces the former `setupOpen` × `busy` × `beginBusy` × `staleCampaign` × `resultOpen` lattice.
 */

export type CampaignShellState =
  | { kind: "setup"; begin: "idle" | "pending" }
  | {
      kind: "table"
      gameId: string
      turn: "idle" | "pending"
      stale: boolean
      resultOpen: boolean
    }

export type CampaignShellAction =
  | { type: "BEGIN_PENDING" }
  | { type: "BEGIN_SUCCESS"; gameId: string }
  | { type: "BEGIN_IDLE" }
  | { type: "TURN_PENDING" }
  | { type: "TURN_SUCCESS" }
  | { type: "TURN_FAILURE"; stale?: boolean }
  | { type: "TURN_BLOCKED_NO_GAME" }
  | { type: "CLEAR_STALE" }
  | { type: "OPEN_RESULT" }
  | { type: "CLOSE_RESULT" }
  | { type: "ENTER_SETUP" }

export function bootCampaignShell(gameId: string | undefined): CampaignShellState {
  if (gameId) {
    return { kind: "table", gameId, turn: "idle", stale: false, resultOpen: false }
  }
  return { kind: "setup", begin: "idle" }
}

export function campaignShellReducer(
  state: CampaignShellState,
  action: CampaignShellAction,
): CampaignShellState {
  switch (action.type) {
    case "BEGIN_PENDING":
      if (state.kind !== "setup" || state.begin === "pending") return state
      return { kind: "setup", begin: "pending" }
    case "BEGIN_IDLE":
      if (state.kind !== "setup") return state
      return { kind: "setup", begin: "idle" }
    case "BEGIN_SUCCESS": {
      if (!action.gameId) return state
      return {
        kind: "table",
        gameId: action.gameId,
        turn: "idle",
        stale: false,
        resultOpen: false,
      }
    }
    case "ENTER_SETUP":
      return { kind: "setup", begin: "idle" }
    case "TURN_PENDING":
      if (state.kind !== "table" || state.turn === "pending") return state
      return { ...state, turn: "pending" }
    case "TURN_SUCCESS":
      if (state.kind !== "table") return state
      return { ...state, turn: "idle", stale: false }
    case "TURN_FAILURE":
      if (state.kind !== "table") return state
      return {
        ...state,
        turn: "idle",
        stale: action.stale === true ? true : state.stale,
      }
    case "TURN_BLOCKED_NO_GAME":
      if (state.kind !== "table") return state
      return { ...state, turn: "idle", stale: true }
    case "CLEAR_STALE":
      if (state.kind !== "table") return state
      return { ...state, stale: false }
    case "OPEN_RESULT":
      if (state.kind !== "table") return state
      return { ...state, resultOpen: true }
    case "CLOSE_RESULT":
      if (state.kind !== "table") return state
      return { ...state, resultOpen: false }
    default:
      return state
  }
}

export function shellIsSetup(state: CampaignShellState): boolean {
  return state.kind === "setup"
}

export function shellBeginBusy(state: CampaignShellState): boolean {
  return state.kind === "setup" && state.begin === "pending"
}

export function shellTurnBusy(state: CampaignShellState): boolean {
  return state.kind === "table" && state.turn === "pending"
}

export function shellStale(state: CampaignShellState): boolean {
  return state.kind === "table" && state.stale
}

export function shellResultOpen(state: CampaignShellState): boolean {
  return state.kind === "table" && state.resultOpen
}