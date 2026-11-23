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
  onRestore: (id: Id) => void
  onStow: (id: Id) => void
  /** Drag a stowed tab upward onto the map to restore at a drop point. */
  onRestoreAt?: (id: Id, clientX: number, clientY: number) => void
  className?: string
  /** Compact strip for phone stacked layout. */
  variant?: "desktop" | "phone"
}

/**
 * Bottom parchment tray: stowed papers sit as tabs; click or drag-up restores.
 * Each tab is a real button for keyboard access.
 */
export function DocumentTray<Id extends string>({
  items,
  openById,
  activeId = null,
  onRestore,
  onStow,
  onRestoreAt,
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

  return (
    <nav
      data-testid="document-tray"
      aria-label="Document tray"
      className={`pointer-events-auto flex items-end gap-1.5 overflow-x-auto border-t border-leather/45 bg-paper-deep px-2 py-1.5 ${className}`}
      style={{
        minHeight: DOCUMENT_TRAY_HEIGHT,
        backgroundImage:
          "linear-gradient(180deg, rgba(255,252,245,0.4) 0%, transparent 55%), linear-gradient(0deg, rgba(74,63,51,0.14), transparent 50%)",
        boxShadow: "0 -4px 14px rgba(36,28,20,0.14)",
      }}
    >
      {items.map((item) => {
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
            aria-pressed={pressed}
            aria-label={
              stowed
                ? `Open ${item.title ?? item.label}`
                : variant === "phone"
                  ? `Show ${item.title ?? item.label}`
                  : `Focus ${item.title ?? item.label}`
            }
            title={item.title ?? item.label}
            className={`document-tray-tab relative shrink-0 rounded-t-[3px] border border-b-0 px-3 py-1.5 font-display text-sm leading-none transition-[transform,box-shadow] duration-150 ease-out touch-none ${
              pressed
                ? "z-[1] border-brass/70 bg-paper text-ink shadow-[0_-2px_8px_rgba(36,28,20,0.18)]"
                : "border-leather/40 bg-paper-deep/90 text-ink-muted hover:bg-paper hover:text-ink"
            } ${lifting === item.id ? "motion-safe:-translate-y-1" : ""}`}
            style={{
              backgroundImage: pressed
                ? "linear-gradient(180deg, rgba(255,250,240,0.7) 0%, rgba(243,234,215,0.35) 100%)"
                : undefined,
            }}
            onClick={() => {
              if (drag.current?.moved) return
              if (variant === "phone") {
                onRestore(item.id)
                return
              }
              if (stowed) onRestore(item.id)
              else onRestore(item.id) // focus / bring forward
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              if (variant === "phone") return
              if (!stowed) return
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
                onRestoreAt(id, event.clientX, event.clientY)
              }
            }}
            onPointerCancel={() => {
              drag.current = null
              setLifting(null)
            }}
            onDoubleClick={(event) => {
              if (variant === "phone") return
              event.preventDefault()
              if (out) onStow(item.id)
            }}
          >
            <span className="block max-w-[9rem] truncate">{item.label}</span>
            {stowed && variant === "desktop" ? (
              <span
                aria-hidden
                className="mt-1 block h-0.5 w-full rounded-full bg-leather/35"
              />
            ) : null}
          </button>
        )
      })}
    </nav>
  )
}
