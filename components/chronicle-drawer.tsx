"use client"

import { useEffect } from "react"
import { TimelinePanel } from "@/components/timeline-panel"
import { Button } from "@/components/ui/button"
import type { FinalePhase } from "@/lib/finale"
import type { TurnRecord } from "@/lib/types"

type ChronicleDrawerProps = {
  open: boolean
  onOpen: (open: boolean) => void
  log: TurnRecord[]
  active: number
  onActive: (index: number) => void
  phase: FinalePhase
}

export function ChronicleDrawer({ open, onOpen, log, active, onActive, phase }: ChronicleDrawerProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onOpen])

  return (
    <>
      <div className="pointer-events-none absolute bottom-3 left-3 z-20">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="pointer-events-auto h-8 border-border/80 bg-card/90 px-3 text-xs shadow-md backdrop-blur-sm"
          data-testid="chronicle-log-toggle"
          aria-expanded={open}
          onClick={() => onOpen(!open)}
        >
          Log
          {log.length > 0 ? (
            <span className="text-muted-foreground ml-1.5 tabular-nums">({log.length})</span>
          ) : null}
        </Button>
      </div>
      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[90] bg-black/30"
            aria-label="Close log"
            data-testid="chronicle-drawer-backdrop"
            onClick={() => onOpen(false)}
          />
          <div
            className="fixed bottom-14 left-3 z-[95] flex w-[min(calc(100vw-1.5rem),24rem)] max-h-[min(58dvh,22rem)] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl sm:absolute sm:bottom-12 sm:max-h-[min(50vh,24rem)]"
            data-testid="chronicle-drawer"
            role="dialog"
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
        </>
      ) : null}
    </>
  )
}