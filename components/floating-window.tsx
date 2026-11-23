"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { clampWindowPosition, TABLE_WINDOW_MARGIN } from "@/lib/ui/table-windows"

type FloatingWindowProps = {
  title: string
  open: boolean
  x: number
  y: number
  z: number
  widthClassName?: string
  /** Preferred max height; actual height is also capped to remaining stage space. */
  maxHeightClassName?: string
  /** Hard pixel cap (e.g. keep Lesson above Legend on /teach). */
  heightCap?: number
  /**
   * When false, the body does not scroll — children own overflow (e.g. Lesson
   * pins Resolve in a footer while the middle scrolls).
   */
  bodyScroll?: boolean
  testId?: string
  onFocus: () => void
  onClose: () => void
  onMove: (x: number, y: number) => void
  children: ReactNode
}

function measureStage(node: HTMLElement | null): { width: number; height: number } {
  const parent = node?.offsetParent as HTMLElement | null
  if (parent) return { width: parent.clientWidth, height: parent.clientHeight }
  return {
    width: typeof window !== "undefined" ? window.innerWidth : 1440,
    height: typeof window !== "undefined" ? window.innerHeight : 900,
  }
}

/**
 * Draggable parchment document chrome (title, close, header drag, focus).
 * Header-only drag so MapLibre pan and arrow-draw keep working on the map.
 */
export function FloatingWindow({
  title,
  open,
  x,
  y,
  z,
  widthClassName = "w-[min(23rem,calc(100%-1.5rem))]",
  maxHeightClassName = "max-h-[min(70dvh,36rem)]",
  heightCap,
  bodyScroll = true,
  testId,
  onFocus,
  onClose,
  onMove,
  children,
}: FloatingWindowProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    pointerId: number
    startX: number
    startY: number
    origX: number
    origY: number
  } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [stageMaxHeight, setStageMaxHeight] = useState<number | undefined>(undefined)

  useEffect(() => {
    if (!open) return
    const node = rootRef.current
    if (!node) return

    const sync = () => {
      const { width: stageW, height: stageH } = measureStage(node)
      const remaining = Math.max(120, stageH - y - TABLE_WINDOW_MARGIN)
      const capped =
        heightCap !== undefined ? Math.min(remaining, Math.max(120, heightCap)) : remaining
      setStageMaxHeight(capped)
      const ww = node.offsetWidth || 320
      // Prefer the budgeted cap over measured offsetHeight so a left-column
      // stack (Lesson above Legend) is not clamped into overlap.
      const wh = heightCap !== undefined ? capped : node.offsetHeight || 200
      const next = clampWindowPosition(x, y, ww, wh, stageW, stageH)
      if (next.x !== x || next.y !== y) onMove(next.x, next.y)
    }

    const frame = window.requestAnimationFrame(sync)
    const parent = node.offsetParent as HTMLElement | null
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null
    if (parent && ro) ro.observe(parent)
    ro?.observe(node)
    window.addEventListener("resize", sync)
    return () => {
      window.cancelAnimationFrame(frame)
      ro?.disconnect()
      window.removeEventListener("resize", sync)
    }
  }, [open, x, y, heightCap, onMove])

  if (!open) return null

  const lift = dragging
    ? "motion-safe:scale-[1.02] motion-safe:rotate-[1deg] shadow-[0_20px_40px_rgba(20,14,8,0.58)] motion-reduce:shadow-[0_14px_28px_rgba(20,14,8,0.5)] motion-reduce:scale-100 motion-reduce:rotate-0"
    : "shadow-[0_10px_22px_rgba(20,14,8,0.38)]"

  return (
    <div
      ref={rootRef}
      className={`pointer-events-auto absolute flex flex-col overflow-hidden rounded-[2px] border border-leather/65 bg-paper text-ink transition-[box-shadow,transform] duration-150 ease-out motion-reduce:transition-none ${widthClassName} ${maxHeightClassName} ${lift}`}
      style={{
        left: x,
        top: y,
        zIndex: z,
        maxHeight: stageMaxHeight !== undefined ? stageMaxHeight : undefined,
        // Definite height when capped (Lesson/Legend stack) or when children own scroll.
        height:
          stageMaxHeight !== undefined && (!bodyScroll || heightCap !== undefined)
            ? stageMaxHeight
            : undefined,
        backgroundImage:
          "linear-gradient(180deg, rgba(255,250,240,0.55) 0%, rgba(243,234,215,0.2) 40%, rgba(214,198,168,0.35) 100%), radial-gradient(ellipse at 18% 12%, rgba(255,255,255,0.35), transparent 42%)",
      }}
      data-testid={testId}
      data-dragging={dragging ? "true" : undefined}
      role="dialog"
      aria-label={title}
      onMouseDown={onFocus}
    >
      <header
        className="relative flex shrink-0 cursor-grab items-center justify-between gap-2 border-b border-leather/30 bg-paper-deep px-2.5 py-1.5 active:cursor-grabbing"
        style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35)" }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          const target = event.target as HTMLElement
          if (target.closest("button")) return
          event.preventDefault()
          event.stopPropagation()
          onFocus()
          setDragging(true)
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
          const node = rootRef.current
          const { width: stageW, height: stageH } = measureStage(node)
          const ww = node?.offsetWidth ?? 320
          const wh = node?.offsetHeight ?? 200
          const dx = event.clientX - state.startX
          const dy = event.clientY - state.startY
          const next = clampWindowPosition(state.origX + dx, state.origY + dy, ww, wh, stageW, stageH)
          onMove(next.x, next.y)
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointerId === event.pointerId) {
            drag.current = null
            setDragging(false)
            try {
              event.currentTarget.releasePointerCapture(event.pointerId)
            } catch {
              /* already released */
            }
          }
        }}
        onPointerCancel={() => {
          drag.current = null
          setDragging(false)
        }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="grid h-5 w-3.5 shrink-0 grid-cols-2 content-center gap-x-[3px] gap-y-[3px]">
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i} className="size-[3px] rounded-full bg-ink-muted/75" />
            ))}
          </span>
          <p className="min-w-0 truncate font-display text-base leading-none text-ink select-none">{title}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-leather hover:bg-leather/10 hover:text-ink"
          aria-label={`Close ${title}`}
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
        >
          Close
        </Button>
      </header>
      <div
        className={`min-h-0 flex-1 bg-[rgba(255,252,245,0.35)] ${
          bodyScroll ? "overflow-x-hidden overflow-y-auto" : "flex flex-col overflow-hidden"
        }`}
      >
        {children}
      </div>
    </div>
  )
}
