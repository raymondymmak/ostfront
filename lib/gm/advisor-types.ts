import type { UnitKind } from "@/lib/types"

/** A player order the chief of staff may suggest. Prose is not an order. */
export type AdvisorOrder =
  | { type: "move"; unitId: string; to: string }
  | { type: "attack"; from: string; target: string; unitIds: string[] }
  | { type: "fortify"; provinceId: string }
  | { type: "recruit"; provinceId: string; unitKind: UnitKind }
  | { type: "cancelRecruit"; buildId: string }

export type AdvisorCard = {
  id: string
  order: AdvisorOrder
  label: string
  valid: boolean
  /** Engine rejection, when the order names real troops but breaks a rule. */
  note: string | null
  /** Combat preview from the engine, before the dice. */
  odds: string | null
  /** Strengths, supply, and rails copied from the engine. */
  detail: string | null
}

export type AdvisorChatMessage = {
  role: "user" | "advisor"
  content: string
}

export type AdvisorResponse = {
  reply: string
  source: "llm" | "rules"
  unavailable: boolean
  suggestions: AdvisorCard[]
  dropped: number
  ordersClosed: boolean
}
