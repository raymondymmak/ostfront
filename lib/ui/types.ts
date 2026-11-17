import type { EngagementPreview } from "@/lib/engine/turn"

export type LegalTargetBlock = {
  id: string
  reason: string
}

export type LegalTargets = {
  from: string
  move: string[]
  attack: string[]
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