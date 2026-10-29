export type Terrain = "plains" | "forest" | "marsh" | "mountain" | "urban"

export type Faction = "central" | "russia"

export type UnitKind = "infantry" | "cavalry" | "artillery"

/** Front, then army, then corps, then division. Today's units are armies. */
export type Echelon = "army" | "corps" | "division"

export type Unit = {
  id: string
  name: string
  faction: Faction
  strength: number
  morale: number
  kind: UnitKind
  /**
   * Missing means army. A name can already say which formation it is,
   * for example "German 11th Army (Mackensen)".
   */
  echelon?: Echelon
  /** Set when this formation is under another unit. Children are found by this link. */
  parentId?: string
  /** Strength this formation can be reinforced back to. Defaults to its current strength. */
  maxStrength?: number
}

export type ScenarioId = "gorlice"

export type Difficulty = "easy" | "normal" | "hard"

export type Purse = { mp: number; ip: number }

export type BuildJob = {
  id: string
  faction: Faction
  provinceId: string
  kind: UnitKind
  remaining: number
  name: string
  /** Raised formations are armies unless a later order nests them. */
  echelon?: Echelon
  parentId?: string
}

export type CampaignGrade =
  | "brilliant"
  | "decisive"
  | "victory"
  | "marginal"
  | "draw"
  | "defeat"

export type CampaignResult = {
  grade: CampaignGrade
  score: number
  reason: string
  captured: number
  available: number
  sudden: boolean
}

export type Province = {
  id: string
  name: string
  terrain: Terrain
  neighbors: string[]
  rail: string[]
  owner: Faction
  controller: Faction
  supply: number
  unrest: number
  fort: number
  units: Unit[]
  /** A depot feeds its faction only while that faction controls the province. */
  depot?: Faction
  /** Added to rail-computed supply. Decays toward 0. Clamped to ±40. */
  supplyModifier: number
}

export type GameState = {
  version: 1
  turn: number
  date: string
  seed: number
  provinces: Province[]
  scenario: ScenarioId
  difficulty: Difficulty
  treasury: { central: Purse; russia: Purse }
  queue: BuildJob[]
  result: CampaignResult | null
  /** Turn index when the Central Powers first held each eastern objective. */
  capturedOn: Record<string, number>
  /** A home victory city has been in Russian hands at a turn's end. */
  homeLost: boolean
  cpStrengthLost: number
}

export type MoveProposal = { type: "move"; unit: string; to: string }

export type AttackProposal = {
  type: "attack"
  from: string
  target: string
  units: string[]
}

export type FortifyProposal = { type: "fortify"; province: string }

export type ModifyProposal = {
  type: "modify"
  province: string
  field: "unrest" | "supply"
  delta: number
  reason: string
}

export type RecruitProposal = {
  type: "recruit"
  faction: Faction
  province: string
  kind: UnitKind
}

export type CancelRecruitProposal = { type: "cancelRecruit"; id: string }

export type Proposal =
  | MoveProposal
  | AttackProposal
  | FortifyProposal
  | ModifyProposal
  | RecruitProposal
  | CancelRecruitProposal

export type GameEvent = {
  type: "partisans" | "strike" | "epidemic" | "breakthrough"
  province: string
  note?: string
}

export type GMTurn = {
  narration: string
  proposals: Proposal[]
  events: GameEvent[]
  diplomacy: string[]
}

export type PlayerOrder =
  | { type: "move"; unitId: string; to: string }
  | { type: "attack"; from: string; target: string; unitIds: string[] }
  | { type: "fortify"; provinceId: string }
  | { type: "recruit"; provinceId: string; unitKind: UnitKind }
  | { type: "cancelRecruit"; buildId: string }
  | { type: "text"; text: string }

export type Resolution = {
  proposal: Proposal
  status: "applied" | "rejected"
  summary: string
}

export type EventResolution = {
  event: GameEvent
  status: "applied" | "rejected"
  summary: string
}

export type ControlChange = {
  provinceId: string
  name: string
  from: Faction
  to: Faction
}

export type TurnRecord = {
  turn: number
  date: string
  narration: string
  diplomacy: string[]
  resolutions: Resolution[]
  events: EventResolution[]
  controlChanges: ControlChange[]
  logistics: string[]
  notes: string[]
  gmSource: "mock" | "llm"
  warning?: string
  gmDebug?: string
}

export type SaveGame = {
  version: 2
  state: GameState
  log: TurnRecord[]
}
