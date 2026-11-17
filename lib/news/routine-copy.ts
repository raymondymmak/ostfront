import { battleRoutineLine } from "@/lib/news/battle"
import type { TurnRecord } from "@/lib/types"

function compressRoutineLine(line: string): string {
  const trimmed = line.replace(/\s+/g, " ").trim()
  const overCap = trimmed.match(/^(.+?): (\d+) strength exceeds supply capacity (\d+)/)
  if (overCap) return `${overCap[1]} over supply: ${overCap[2]}/${overCap[3]}`
  const below = trimmed.match(/^(.+?) drops below supply (\d+)\./)
  if (below) return `${below[1]} below supply ${below[2]}`
  const income = trimmed.match(/^(.+?) collect (\d+) manpower and (\d+) industry\./)
  if (income) return `${income[1]}: +${income[2]} mp, +${income[3]} ip`
  const cut = trimmed.match(/^(.+?) is cut off this fortnight/)
  if (cut) return `${cut[1]} cut off this fortnight`
  return trimmed
}

function linesFromRecord(record: TurnRecord): string[] {
  const rows: string[] = []
  for (const line of record.logistics) {
    if (
      /collect \d+ manpower/i.test(line) ||
      /reinforc/i.test(line) ||
      /refit/i.test(line) ||
      /supply|cut off|revolt|exceeds supply capacity|drops below supply/i.test(line)
    ) {
      rows.push(compressRoutineLine(line))
    }
  }
  for (const item of record.resolutions) {
    if (item.status !== "applied") continue
    if (item.battle) {
      rows.push(battleRoutineLine(item.battle, item.summary))
      continue
    }
    if (/income|treasury|raised|arrives|build/i.test(item.summary)) {
      rows.push(compressRoutineLine(item.summary))
    }
  }
  return rows
}

/** Compact, deduped routine rows for one fortnight. */
export function routineLog(record: TurnRecord): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of linesFromRecord(record)) {
    if (seen.has(line)) continue
    seen.add(line)
    out.push(line)
  }
  return out.slice(0, 8)
}

export type RoutineGroup = { turn: number; date: string; lines: string[] }

/** All fortnights, newest first, for the Log drawer. */
export function routineLogByTurn(log: TurnRecord[]): RoutineGroup[] {
  return [...log]
    .reverse()
    .map((record) => ({
      turn: record.turn,
      date: record.date,
      lines: routineLog(record),
    }))
    .filter((group) => group.lines.length > 0)
}