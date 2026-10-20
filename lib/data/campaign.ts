import type { Difficulty, GameState, Purse } from "@/lib/types"

export const OPENING_PURSE: { central: Purse; russia: Purse } = {
  central: { mp: 8, ip: 6 },
  russia: { mp: 10, ip: 4 },
}

export function blankCampaign(difficulty: Difficulty = "normal"): Pick<
  GameState,
  | "scenario"
  | "difficulty"
  | "treasury"
  | "queue"
  | "result"
  | "capturedOn"
  | "homeLost"
  | "cpStrengthLost"
> {
  return {
    scenario: "gorlice",
    difficulty,
    treasury: {
      central: { ...OPENING_PURSE.central },
      russia: { ...OPENING_PURSE.russia },
    },
    queue: [],
    result: null,
    capturedOn: {},
    homeLost: false,
    cpStrengthLost: 0,
  }
}

export function copyPurse(purse: Purse): Purse {
  return { mp: purse.mp, ip: purse.ip }
}
