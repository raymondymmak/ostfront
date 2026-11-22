"use client"

import { useRef, type ReactNode } from "react"
import { Button } from "@/components/ui/button"

type FloatingWindowProps = {
  title: string
  open: boolean
  x: number
  y: number
  z: number
  widthClassName?: string
  heightClassName?: string
  testId?: string
  onFocus: () => void
  onClose: () => void
  onMove: (x: number, y: number) => void
  children: ReactNode
}

/**
 * Draggable chrome only (title, close, header drag, focus).
 * Header-only drag so MapLibre pan and arrow-draw keep working on the map.
 */
export function FloatingWindow({
  title,
  open,
  x,
  y,
  z,
  widthClassName = "w-[min(23rem,calc(100%-1.5rem))]",
  heightClassName = "max-h-[min(70dvh,36rem)]",
  testId,
  onFocus,
  onClose,
  onMove,
  children,
}: FloatingWindowProps) {
  const drag = useRef<{
    pointerId: number
    startX: number
    startY: number
    origX: number
    origY: number
  } | null>(null)

  if (!open) return null

  return (
    <div
      className={`pointer-events-auto absolute flex flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl ${widthClassName} ${heightClassName}`}
      style={{ left: x, top: y, zIndex: z }}
      data-testid={testId}
      role="dialog"
      aria-label={title}
      onMouseDown={onFocus}
    >
      <header
        className="flex shrink-0 cursor-grab items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2 active:cursor-grabbing"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          const target = event.target as HTMLElement
          if (target.closest("button")) return
          event.preventDefault()
          event.stopPropagation()
          onFocus()
          drag.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            origX: x,
            origY: y,
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const state = drag.current
          if (!state || state.pointerId !== event.pointerId) return
          event.preventDefault()
          event.stopPropagation()
          const dx = event.clientX - state.startX
          const dy = event.clientY - state.startY
          onMove(Math.max(0, state.origX + dx), Math.max(0, state.origY + dy))
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointerId === event.pointerId) {
            drag.current = null
            try {
              event.currentTarget.releasePointerCapture(event.pointerId)
            } catch {
              /* already released */
            }
          }
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
      >
        <p className="font-display text-base leading-none select-none">{title}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          aria-label={`Close ${title}`}
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
        >
          Close
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  )
}
