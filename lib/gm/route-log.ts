import type { TurnTier } from "@/lib/gm/tier"

export type GmCallLog = {
  tag: "ostfront.gm.call"
  tier: TurnTier
  model: string
  latencyMs: number
  outcome:
    | "ok"
    | "zod_fail"
    | "http_error"
    | "timeout"
    | "empty"
    | "escalated_skip"
    | "mock"
  escalated: boolean
  attempt: number
  zodIssueCount?: number
  proposalCount?: number
  rejectedCount?: number
  rejectionRate?: number
  error?: string
}

export function logGmCall(entry: GmCallLog): void {
  console.log(JSON.stringify(entry))
}
