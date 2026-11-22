"use client"

import { useEffect } from "react"
import { TimelinePanel } from "@/components/timeline-panel"
import { Button } from "@/components/ui/button"
import type { FinalePhase } from "@/lib/finale"
import { chronicleHandlesEscapeKey } from "@/lib/news/overlay-stack"
import type { TurnRecord } from "@/lib/types"

type ChronicleDrawerProps = {
  open: boolean
  onOpen: (open: boolean) => void
  log: TurnRecord[]
  active: number
  onActive: (index: number) => void
  phase: FinalePhase
  newsCardsActive?: boolean
  /**
   * Map-corner Log control + drawer. Hidden on the desktop floating-window shell
   * (`lg+`); keep phone (<640) placement and lift Log above the legend on tablet
   * (640–1023) so they never overlap.
   */
  mapCorner?: boolean
}

export function ChronicleDrawer({
  open,
  onOpen,
  log,
  active,
  onActive,
  phase,
  newsCardsActive = false,
  mapCorner = true,
}: ChronicleDrawerProps) {
  useEffect(() => {
    if (!open || !mapCorner) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (!chronicleHandlesEscapeKey(newsCardsActive)) return
      event.stopPropagation()
      onOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [mapCorner, newsCardsActive, onOpen, open])

  if (!mapCorner) return null

  return (
    <>
      {/*
        Phone: bottom-14 clears the legend at bottom-3.
        Tablet (sm–lg): keep bottom-14 so Log never sits on the legend.
        Desktop shell hides this control entirely (mapCorner=false / lg:hidden).
      */}
      <div className="pointer-events-none absolute bottom-14 left-3 z-40 lg:hidden">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="pointer-events-auto h-8 border-border/80 bg-card/90 px-3 text-xs shadow-md backdrop-blur-sm"
          data-testid="chronicle-log-toggle"
          aria-expanded={open}
          disabled={newsCardsActive}
          onClick={() => {
            if (newsCardsActive) return
            onOpen(!open)
          }}
        >
          Log
          {log.length > 0 ? (
            <span className="text-muted-foreground ml-1.5 tabular-nums">({log.length})</span>
          ) : null}
        </Button>
      </div>
      {open ? (
        <div
          className="pointer-events-auto absolute bottom-14 left-3 z-40 flex w-[min(calc(100%-1.5rem),24rem)] max-h-[min(42dvh,20rem)] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl sm:max-h-[min(50vh,24rem)] lg:hidden"
          data-testid="chronicle-drawer"
          role="region"
          aria-label="Fortnight log"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <p className="font-display text-base leading-none">Chronicle</p>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onOpen(false)}>
              Close
            </Button>
          </div>
          <div className="min-h-0 flex-1" data-testid="mobile-chronicle-panel">
            <TimelinePanel log={log} active={active} onActive={onActive} phase={phase} variant="drawer" />
          </div>
        </div>
      ) : null}
    </>
  )
}
