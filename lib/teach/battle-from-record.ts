import { battleForProvince } from "@/lib/news/battle"
import type { BattleFacts, TurnRecord } from "@/lib/types"

export type TeachBattle = {
  facts: BattleFacts
  summary: string
  applied: boolean
}

export function teachBattleOnTarget(record: TurnRecord, targetId: string): TeachBattle | null {
  const facts = battleForProvince(record, targetId)
  if (!facts) return null
  const line = record.resolutions.find(
    (item) => item.status === "applied" && item.battle?.targetId === targetId && item.battle.kind === "assault",
  )
  return {
    facts,
    summary: line?.summary ?? "",
    applied: line?.status === "applied",
  }
}