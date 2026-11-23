"use client"

import { useEffect, useRef, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { scenarioSpec } from "@/lib/data/objectives"
import { gradeLabel } from "@/lib/engine/victory"
import { BACK_TO_MAP_LABEL } from "@/lib/finale"
import {
  handleNewsFocusTrapKeydown,
  refocusIntoContainer,
} from "@/lib/news/modal-focus"
import { ENDGAME_OVERLAY_Z } from "@/lib/ui/table-windows"
import type { CampaignResult, GameState } from "@/lib/types"

type EndgameModalProps = {
  state: GameState
  result: CampaignResult
  onBackToMap: () => void
  onPlayAgain: () => void
}

/**
 * Grade screen: portaled above every paper / HUD / tray so the dim covers the table.
 * Final map stays undimmed until the player opens this (parent gates on resultOpen).
 */
export function EndgameModal({ state, result, onBackToMap, onPlayAgain }: EndgameModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const overlay = overlayRef.current
      if (overlay && handleNewsFocusTrapKeydown(event, overlay)) return
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        onBackToMap()
      }
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [onBackToMap])

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const overlay = overlayRef.current
      if (!overlay) return
      refocusIntoContainer(overlay, event.target)
    }
    document.addEventListener("focusin", onFocusIn, true)
    return () => document.removeEventListener("focusin", onFocusIn, true)
  }, [])

  if (!mounted) return null

  const fortnight = Math.min(state.turn + 1, scenarioSpec(state.scenario).length)
  const length = scenarioSpec(state.scenario).length

  const overlay = (
    <div
      ref={overlayRef}
      className="fixed inset-0 flex items-center justify-center bg-leather/45 p-4 backdrop-blur-[1px]"
      style={{ zIndex: ENDGAME_OVERLAY_Z }}
      data-testid="endgame"
      data-endgame-z={ENDGAME_OVERLAY_Z}
      role="dialog"
      aria-modal="true"
      aria-labelledby="endgame-title"
    >
      <div className="w-full max-w-md rounded-sm border border-leather/50 bg-paper p-6 text-ink shadow-[0_18px_40px_rgba(36,28,20,0.35)]">
        <p className="text-xs tracking-wide text-muted-foreground uppercase">
          {result.sudden ? "Sudden death" : "Campaign over"}
        </p>
        <h2 id="endgame-title" className="mt-2 font-display text-4xl leading-none">
          {gradeLabel(result.grade)}
        </h2>
        <p className="mt-3 text-sm leading-6">{result.reason}</p>
        <p className="mt-3 text-sm text-muted-foreground">
          {state.date} · Fortnight {fortnight} / {length}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Score {result.score} · ★ {result.captured}/{result.available} victory points
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" variant="outline" data-testid="back-to-map" onClick={onBackToMap} autoFocus>
            {BACK_TO_MAP_LABEL}
          </Button>
          <Button type="button" onClick={onPlayAgain}>
            Play again
          </Button>
        </div>
      </div>
    </div>
  )

  return createPortal(overlay, document.body)
}
