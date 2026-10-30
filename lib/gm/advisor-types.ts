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
  /**
   * Further orders Accept files with `order`. A concentric attack is several
   * attacks on one province, each already accepted by the engine.
   */
  companions: AdvisorOrder[]
  label: string
  valid: boolean
  /** Engine rejection, when the order names real troops but breaks a rule. */
  note: string | null
  /** Combat preview from the engine, before the dice. */
  odds: string | null
  /** Strengths, supply, and rails copied from the engine. */
  detail: string | null
  /**
   * How the card sits against the player's queue.
   * `duplicate` is the same order already queued. `conflict` reuses a division
   * for a different order. `new` does not touch the queue.
   */
  queue: AdvisorQueueState
  /** Queued order text when `queue` is `conflict`. */
  conflict: string | null
}

export type AdvisorQueueState = "new" | "duplicate" | "conflict"

/** What the suggestion card may do. Duplicates stay visible with Accept disabled. */
export function advisorCardAction(card: Pick<AdvisorCard, "valid" | "queue">): "accept" | "override" | "disabled" {
  if (!card.valid || card.queue === "duplicate") return "disabled"
  if (card.queue === "conflict") return "override"
  return "accept"
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
