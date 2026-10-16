export type Terrain = "plains" | "forest" | "marsh" | "mountain" | "urban"

export type Faction = "central" | "russia"

export type UnitKind = "infantry" | "cavalry" | "artillery"

export type Unit = {
  id: string
  name: string
  faction: Faction
  strength: number
  morale: number
  kind: UnitKind
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

export type Proposal =
  | MoveProposal
  | AttackProposal
  | FortifyProposal
  | ModifyProposal

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
}

export type SaveGame = {
  version: 1
  state: GameState
  log: TurnRecord[]
}
