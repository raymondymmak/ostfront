import type { EngagementPreview } from "@/lib/engine/turn"

export type LegalTargetBlock = {
  id: string
  reason: string
}

export type LegalTargets = {
  from: string
  /** Legal march targets when `canOrder`; otherwise empty. */
  move: string[]
  /** Legal assault targets when `canOrder`; otherwise empty. */
  attack: string[]
  /** Neighbor highlights when orders are not available (reach preview). */
  reach: { move: string[]; attack: string[] }
  /** Central-held province with supply, formations, and permission to queue arrows. */
  canOrder: boolean
  blocked: LegalTargetBlock[]
  /** Legal targets that would empty a depot garrison without Ctrl+commit-all. */
  depotWarn: LegalTargetBlock[]
}

export type OddsBandTone = "good" | "even" | "bad" | "open"

export type OddsBand = {
  tone: OddsBandTone
  ratio: number
  label: string
  detail: string[]
}

export type { EngagementPreview }