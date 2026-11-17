"use client"

import { useEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { chronicleFollowsLatest } from "@/lib/chronicle-scroll"
import { logisticsForPhase, type FinalePhase } from "@/lib/finale"
import { FACTION_LABEL } from "@/lib/format"
import { routineLog, routineLogByTurn } from "@/lib/news/select"
import type { TurnRecord } from "@/lib/types"

type TimelinePanelProps = {
  log: TurnRecord[]
  active: number
  onActive: (index: number) => void
  phase?: FinalePhase
  variant?: "drawer" | "embedded"
}

export function TimelinePanel({
  log,
  active,
  onActive,
  phase = "playing",
  variant = "embedded",
}: TimelinePanelProps) {
  const record = log[active]
  const datesRef = useRef<HTMLDivElement>(null)
  const entryRef = useRef<HTMLDivElement>(null)
  const followDates = useRef(true)
  const [detailsForTurn, setDetailsForTurn] = useState<number | null>(null)
  const detailsOpen = detailsForTurn === active

  useEffect(() => {
    const dates = datesRef.current
    if (!dates) return
    const onScroll = () => {
      followDates.current = chronicleFollowsLatest(dates.scrollTop, dates.scrollHeight, dates.clientHeight)
    }
    dates.addEventListener("scroll", onScroll, { passive: true })
    return () => dates.removeEventListener("scroll", onScroll)
  }, [log.length])

  useEffect(() => {
    if (!followDates.current) return
    const dates = datesRef.current
    if (dates) dates.scrollTop = dates.scrollHeight
    if (entryRef.current) entryRef.current.scrollTop = 0
  }, [log.length])

  useEffect(() => {
    if (entryRef.current) entryRef.current.scrollTop = 0
  }, [active])

  const header = (
    <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
      <h2 className="font-display text-lg leading-none">Chronicle</h2>
      {record && (
        <Badge variant="outline">
          {record.gmSource === "llm" ? "Game master" : "Staff simulation"}
        </Badge>
      )}
    </div>
  )

  if (log.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col p-3 text-sm" data-testid="chronicle">
        {variant === "embedded" ? header : null}
        <p className="text-xs text-muted-foreground">No fortresses fallen yet — close a fortnight to open the log.</p>
      </div>
    )
  }

  if (variant === "drawer") {
    const groups = routineLogByTurn(log)
    const detailRecord = log[active]
    const drawerRecord = log[active]
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="chronicle">
        <ScrollArea className="min-h-0 flex-1" viewportRef={entryRef} viewportClassName="overscroll-contain">
          <article className="flex flex-col gap-3 p-3 text-sm">
            {drawerRecord ? (
              <Badge variant="outline" className="w-fit text-[10px]">
                {drawerRecord.gmSource === "llm" ? "Game master" : "Staff simulation"}
              </Badge>
            ) : null}
            <ul className="flex flex-wrap gap-1 border-b border-border pb-2">
              {log.map((entry, index) => (
                <li key={`${entry.turn}-${entry.date}`}>
                  <button
                    type="button"
                    onClick={() => onActive(index)}
                    className={`rounded-md border px-2 py-0.5 text-xs ${
                      index === active
                        ? "border-primary/50 bg-primary/15 text-foreground"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {entry.date}
                  </button>
                </li>
              ))}
            </ul>
            <ul className="flex flex-col gap-2" data-testid="chronicle-routine">
              {groups.map((group) => (
                <li key={`${group.turn}-${group.date}`} className="flex flex-col gap-1">
                  <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    {group.date}
                  </p>
                  <ul className="flex flex-col gap-1">
                    {group.lines.map((line) => (
                      <li
                        key={`${group.turn}-${line}`}
                        className="line-clamp-2 rounded border border-border/60 bg-muted/40 px-2 py-1 text-xs leading-snug text-foreground"
                      >
                        {line}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            {detailRecord?.warning && <GmWarning record={detailRecord} />}
            {groups.length > 0 && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-fit px-2 text-xs text-muted-foreground"
                  data-testid="chronicle-details-toggle"
                  aria-expanded={detailsOpen}
                  onClick={() => setDetailsForTurn(detailsOpen ? null : active)}
                >
                  {detailsOpen ? "Hide details" : "Details"}
                </Button>
                {detailsOpen && detailRecord && (
                  <div className="flex flex-col gap-2 border-t border-border pt-2" data-testid="chronicle-details">
                    <TurnDetails record={detailRecord} phase={phase} includeLogistics={false} />
                  </div>
                )}
              </>
            )}
          </article>
        </ScrollArea>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="chronicle">
      {header}
      <div className="grid min-h-0 flex-1 grid-cols-[9.5rem_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden">
        <ScrollArea
          className="h-full min-h-0 overflow-hidden border-r border-border"
          viewportClassName="overscroll-contain"
          viewportRef={datesRef}
        >
          <ul className="flex flex-col p-1">
            {log.map((entry, index) => (
              <li key={`${entry.turn}-${entry.date}`}>
                <button
                  type="button"
                  onClick={() => onActive(index)}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                    index === active ? "bg-muted text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {entry.date}
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
        {record && (
          <ScrollArea
            className="h-full min-h-0 overflow-hidden"
            viewportClassName="overscroll-contain"
            viewportRef={entryRef}
          >
            <article key={`${record.turn}-${record.date}`} className="flex flex-col gap-2 p-3 text-sm">
              {record.warning && <GmWarning record={record} />}
              <ul className="flex flex-col gap-1" data-testid="chronicle-routine">
                {routineLog(record).map((line) => (
                  <li
                    key={line}
                    className="truncate rounded border border-border/60 bg-muted/40 px-2 py-1 text-xs leading-snug text-foreground"
                    title={line}
                  >
                    {line}
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-fit px-2 text-xs text-muted-foreground"
                data-testid="chronicle-details-toggle"
                aria-expanded={detailsOpen}
                onClick={() => setDetailsForTurn(detailsOpen ? null : active)}
              >
                {detailsOpen ? "Hide details" : "Details"}
              </Button>
              {detailsOpen && (
                <div className="flex flex-col gap-3 border-t border-border pt-2" data-testid="chronicle-details">
                  <TurnDetails record={record} phase={phase} />
                </div>
              )}
            </article>
          </ScrollArea>
        )}
      </div>
    </div>
  )
}

function GmWarning({ record }: { record: TurnRecord }) {
  return (
    <div
      className="rounded-md border border-destructive/40 px-2.5 py-2 text-destructive"
      data-testid="gm-warning"
    >
      <p>{record.warning}</p>
      {record.gmDebug && (
        <p
          className="mt-1 font-mono text-[11px] leading-4 break-words text-destructive/80"
          data-testid="gm-debug"
        >
          {record.gmDebug}
        </p>
      )}
    </div>
  )
}

function TurnDetails({
  record,
  phase,
  includeLogistics = true,
}: {
  record: TurnRecord
  phase: FinalePhase
  includeLogistics?: boolean
}) {
  return (
    <>
      {record.narration.split(/\n\n/).map((paragraph) => (
        <p key={paragraph.slice(0, 24)} className="text-muted-foreground leading-6">
          {paragraph}
        </p>
      ))}
      {record.diplomacy.length > 0 && (
        <ul className="text-muted-foreground">
          {record.diplomacy.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {record.controlChanges.length > 0 && (
        <ul className="flex flex-col gap-1">
          {record.controlChanges.map((change) => (
            <li
              key={change.provinceId}
              className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5"
            >
              {change.name} passes from {FACTION_LABEL[change.from]} to {FACTION_LABEL[change.to]}.
            </li>
          ))}
        </ul>
      )}
      <ul className="flex flex-col gap-1.5" data-testid="resolution-log">
        {record.resolutions.map((item, index) => (
          <li
            key={`${item.summary}-${index}`}
            className={item.status === "rejected" ? "text-destructive" : "text-foreground"}
          >
            <span className="mr-2 text-xs tracking-wide uppercase">
              {item.status === "rejected" ? "Rejected" : "Resolved"}
            </span>
            {item.summary}
          </li>
        ))}
        {record.events.map((item, index) => (
          <li
            key={`${item.summary}-${index}`}
            className={item.status === "rejected" ? "text-destructive" : ""}
          >
            <span className="mr-2 text-xs tracking-wide uppercase">
              {item.status === "rejected" ? "Rejected" : "Event"}
            </span>
            {item.summary}
          </li>
        ))}
        {record.notes.map((note) => (
          <li key={note} className="text-destructive">
            <span className="mr-2 text-xs tracking-wide uppercase">Rejected</span>
            {note}
          </li>
        ))}
        {includeLogistics
          ? logisticsForPhase(record.logistics, phase).map((line) => (
              <li key={line} className="text-muted-foreground">
                {line}
              </li>
            ))
          : null}
      </ul>
    </>
  )
}