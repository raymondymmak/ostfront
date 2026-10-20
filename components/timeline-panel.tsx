"use client"

import { useEffect, useRef } from "react"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { chronicleFollowsLatest } from "@/lib/chronicle-scroll"
import { BRIEFING } from "@/lib/data/scenario"
import { FACTION_LABEL } from "@/lib/format"
import type { TurnRecord } from "@/lib/types"

type TimelinePanelProps = {
  log: TurnRecord[]
  active: number
  onActive: (index: number) => void
  briefing?: string
}

export function TimelinePanel({ log, active, onActive, briefing = BRIEFING }: TimelinePanelProps) {
  const record = log[active]
  const datesRef = useRef<HTMLDivElement>(null)
  const entryRef = useRef<HTMLDivElement>(null)
  const followDates = useRef(true)

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

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="chronicle">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="font-display text-lg leading-none">Chronicle</h2>
        {record && (
          <Badge variant="outline">
            {record.gmSource === "llm" ? "Game master" : "Staff simulation"}
          </Badge>
        )}
      </div>
      {log.length === 0 ? (
        <ScrollArea
          className="min-h-0 flex-1 overflow-hidden"
          viewportClassName="overscroll-contain"
          viewportRef={entryRef}
        >
          <div className="p-4">
            <p className="font-display text-lg">2 May 1915, Gorlice–Tarnów</p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{briefing}</p>
          </div>
        </ScrollArea>
      ) : (
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
              <article className="flex flex-col gap-3 p-3 text-sm">
                {record.warning && (
                  <p className="rounded-md border border-destructive/40 px-2.5 py-2 text-destructive">
                    {record.warning}
                  </p>
                )}
                {record.narration.split(/\n\n/).map((paragraph) => (
                  <p key={paragraph.slice(0, 24)} className="leading-6">
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
                        {change.name} passes from {FACTION_LABEL[change.from]} to{" "}
                        {FACTION_LABEL[change.to]}.
                      </li>
                    ))}
                  </ul>
                )}
                <ul className="flex flex-col gap-1.5" data-testid="resolution-log">
                  {record.resolutions.map((item, index) => (
                    <li
                      key={`${item.summary}-${index}`}
                      className={
                        item.status === "rejected" ? "text-destructive" : "text-foreground"
                      }
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
                  {record.logistics.map((line) => (
                    <li key={line} className="text-muted-foreground">
                      {line}
                    </li>
                  ))}
                </ul>
              </article>
            </ScrollArea>
          )}
        </div>
      )}
    </div>
  )
}
