"use client"

import { useRef, useState } from "react"
import type { TrayItemSpec } from "@/lib/ui/document-tray"
import { pointerMovedEnough } from "@/lib/ui/document-tray"
import { DOCUMENT_TRAY_HEIGHT } from "@/lib/ui/window-drag"

type DocumentTrayProps<Id extends string> = {
  items: TrayItemSpec<Id>[]
  /** open=true means paper is out on the table; false = stowed tab. */
  openById: Partial<Record<Id, boolean>>
  /** Active tab highlight for phone stacked swap (optional). */
  activeId?: Id | null
  /** Desktop: Enter / drag-up takes a stowed paper out. Phone: click swaps panel. */
  onRestore: (id: Id) => void
  /** Drag a stowed tab upward onto the map to restore at a drop point. */
  onRestoreAt?: (id: Id, clientX: number, clientY: number) => void
  /** Highlight when a paper is dragged over the tray (desktop file target). */
  dropHighlight?: boolean
  className?: string
  /** Compact strip for phone stacked layout. */
  variant?: "desktop" | "phone"
}

/**
 * Bottom parchment tray: stowed papers sit as tabs.
 * Desktop — drag a tab up onto the map (or Enter) to take it out; drop highlight
 * while filing a paper in. Not a row of show/hide toggles.
 * Phone — tab strip that swaps the stacked panel.
 */
export function DocumentTray<Id extends string>({
  items,
  openById,
  activeId = null,
  onRestore,
  onRestoreAt,
  dropHighlight = false,
  className = "",
  variant = "desktop",
}: DocumentTrayProps<Id>) {
  const drag = useRef<{
    id: Id
    pointerId: number
    startX: number
    startY: number
    moved: boolean
  } | null>(null)
  const [lifting, setLifting] = useState<Id | null>(null)

  const desktopItems =
    variant === "desktop" ? items.filter((item) => !openById[item.id]) : items

  return (
    <nav
      data-testid="document-tray"
      aria-label="Document tray"
      data-drop-active={dropHighlight ? "true" : undefined}
      className={`pointer-events-auto flex w-full items-end gap-1.5 overflow-x-auto border-t px-2 py-1.5 transition-[box-shadow,background-color,border-color] duration-150 ${className} ${
        dropHighlight
          ? "border-brass bg-brass/25 shadow-[0_-6px_20px_rgba(122,92,40,0.35)]"
          : "border-leather/45 bg-paper-deep"
      }`}
      style={{
        minHeight: DOCUMENT_TRAY_HEIGHT,
        width: "100%",
        backgroundImage: dropHighlight
          ? "linear-gradient(180deg, rgba(198,161,90,0.35) 0%, rgba(246,241,228,0.85) 55%)"
          : "linear-gradient(180deg, rgba(255,252,245,0.4) 0%, transparent 55%), linear-gradient(0deg, rgba(74,63,51,0.14), transparent 50%)",
        boxShadow: dropHighlight ? undefined : "0 -4px 14px rgba(36,28,20,0.14)",
      }}
    >
      {desktopItems.length === 0 && variant === "desktop" ? (
        <p className="px-2 py-1 font-display text-xs text-ink-muted select-none">
          {dropHighlight ? "Release to file" : "Drag a paper here to file it"}
        </p>
      ) : null}
      {desktopItems.map((item) => {
        const out = Boolean(openById[item.id])
        const pressed = activeId != null ? activeId === item.id : out
        const stowed = !out
        return (
          <button
            key={item.id}
            type="button"
            data-testid={item.testId}
            data-tray-id={item.id}
            data-stowed={stowed ? "true" : "false"}
            aria-pressed={variant === "phone" ? pressed : undefined}
            aria-label={
              variant === "phone"
                ? `Show ${item.title ?? item.label}`
                : `Take out ${item.title ?? item.label}`
            }
            title={item.title ?? item.label}
            className={`document-tray-tab relative shrink-0 rounded-t-[3px] border border-b-0 px-3 py-1.5 font-display text-sm leading-none transition-[transform,box-shadow] duration-150 ease-out touch-none ${
              variant === "phone" && pressed
                ? "z-[1] border-brass/70 bg-paper text-ink shadow-[0_-2px_8px_rgba(36,28,20,0.18)]"
                : "border-leather/40 bg-paper text-ink shadow-[0_-1px_4px_rgba(36,28,20,0.12)] hover:bg-paper-deep"
            } ${lifting === item.id ? "motion-safe:-translate-y-2 motion-safe:scale-105" : ""}`}
            style={{
              backgroundImage:
                "linear-gradient(180deg, rgba(255,250,240,0.7) 0%, rgba(243,234,215,0.35) 100%)",
            }}
            onClick={() => {
              if (drag.current?.moved) return
              if (variant === "phone") {
                onRestore(item.id)
              }
              // Desktop: click focuses the tab for keyboard; Enter takes it out.
            }}
            onKeyDown={(event) => {
              if (variant === "phone") return
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onRestore(item.id)
              }
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              if (variant === "phone") return
              drag.current = {
                id: item.id,
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                moved: false,
              }
              setLifting(item.id)
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              const state = drag.current
              if (!state || state.pointerId !== event.pointerId) return
              if (
                !state.moved &&
                pointerMovedEnough(
                  { clientX: state.startX, clientY: state.startY },
                  { clientX: event.clientX, clientY: event.clientY },
                )
              ) {
                state.moved = true
              }
            }}
            onPointerUp={(event) => {
              const state = drag.current
              if (!state || state.pointerId !== event.pointerId) return
              const moved = state.moved
              const id = state.id
              drag.current = null
              setLifting(null)
              try {
                event.currentTarget.releasePointerCapture(event.pointerId)
              } catch {
                /* already released */
              }
              if (moved && onRestoreAt) {
                // Dragging up onto the map files the tab out at the release point.
                const dy = event.clientY - state.startY
                if (dy < -TRAY_LIFT_MIN_PX) {
                  onRestoreAt(id, event.clientX, event.clientY)
                }
              }
            }}
            onPointerCancel={() => {
              drag.current = null
              setLifting(null)
            }}
          >
            <span className="block max-w-[9rem] truncate">{item.label}</span>
            {variant === "desktop" ? (
              <span aria-hidden className="mt-1 block h-0.5 w-full rounded-full bg-leather/35" />
            ) : null}
          </button>
        )
      })}
    </nav>
  )
}

/** Minimum upward travel (px) before a tray tab is considered lifted onto the map. */
const TRAY_LIFT_MIN_PX = 24
