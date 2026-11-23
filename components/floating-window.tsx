"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { TABLE_WINDOW_MARGIN, WINDOW_HEADER_HEIGHT } from "@/lib/ui/table-windows"
import {
  DOCUMENT_TRAY_HEIGHT,
  liftYAboveTray,
  positionAfterPointerDrag,
  resolveWindowHeight,
  shouldFileIntoTray,
  stageHeightForWindows,
} from "@/lib/ui/window-drag"

type FloatingWindowProps = {
  title: string
  open: boolean
  x: number
  y: number
  z: number
  /** Retained width in px (from prior measure/resize). */
  widthPx?: number
  /** Retained height in px (from prior measure/resize). */
  heightPx?: number
  widthClassName?: string
  /** Preferred max height; actual height is locked so drag cannot grow the paper. */
  maxHeightClassName?: string
  /** Hard pixel cap (e.g. keep Lesson above Legend on /teach). */
  heightCap?: number
  /**
   * When false, the body does not scroll — children own overflow (e.g. Lesson
   * pins Resolve in a panel footer while the middle scrolls).
   */
  bodyScroll?: boolean
  /** Show a bottom-right resize handle (height only; width stays CSS-driven unless widthPx set). */
  resizable?: boolean
  testId?: string
  onFocus: () => void
  /** File into the tray (Escape). No visible Stow button — drag onto the tray instead. */
  onClose: () => void
  onMove: (x: number, y: number) => void
  /** Persist measured/resized size so restore keeps width and last height. */
  onSize?: (size: { width: number; height: number }) => void
  /** Drop into the tray band while dragging. */
  onStow?: () => void
  /** Tray drop-target highlight while the pointer is over the tray band. */
  onTrayHover?: (over: boolean) => void
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

function parseCssMaxHeight(className: string, stageHeight: number): number {
  const rem = className.match(/(\d+(?:\.\d+)?)rem/)
  const dvh = className.match(/(\d+(?:\.\d+)?)dvh/)
  const remPx = rem ? Number(rem[1]) * 16 : Number.POSITIVE_INFINITY
  const dvhPx = dvh ? (Number(dvh[1]) / 100) * stageHeight : Number.POSITIVE_INFINITY
  const preferred = Math.min(remPx, dvhPx)
  return Number.isFinite(preferred) ? preferred : Math.min(576, stageHeight * 0.7)
}

/**
 * Draggable parchment document: press–drag–release, file by dropping on the tray.
 * Header-only Y clamp so the body may overlap the tray while the grip stays reachable.
 */
export function FloatingWindow({
  title,
  open,
  x,
  y,
  z,
  widthPx,
  heightPx: heightProp,
  widthClassName = "w-[min(23rem,calc(100%-1.5rem))]",
  maxHeightClassName = "max-h-[min(70dvh,36rem)]",
  heightCap,
  bodyScroll = true,
  resizable = true,
  testId,
  onFocus,
  onClose,
  onMove,
  onSize,
  onStow,
  onTrayHover,
  children,
}: FloatingWindowProps) {
  void onClose
  const rootRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    pointerId: number
    startX: number
    startY: number
    origX: number
    origY: number
    width: number
    height: number
  } | null>(null)
  const resize = useRef<{
    pointerId: number
    startY: number
    origHeight: number
  } | null>(null)
  const lockedHeightRef = useRef<number | null>(heightProp ?? null)
  const [dragging, setDragging] = useState(false)
  const [overTray, setOverTray] = useState(false)
  const [resizing, setResizing] = useState(false)
  /** Local measure/resize height when the parent has not yet persisted one. */
  const [localHeight, setLocalHeight] = useState<number | undefined>(undefined)
  const heightPx = heightProp ?? localHeight

  useEffect(() => {
    if (!open) {
      if (heightProp === undefined) lockedHeightRef.current = null
      onTrayHover?.(false)
      return
    }
    const node = rootRef.current
    if (!node) return

    const sync = () => {
      const stage = measureStage(node)
      // Height budget uses full stage (papers may overlap tray); preferred still caps size.
      const preferredMax = parseCssMaxHeight(maxHeightClassName, stage.height)
      if (heightProp !== undefined) lockedHeightRef.current = heightProp
      const nextH = resolveWindowHeight({
        lockedHeight: lockedHeightRef.current,
        preferredMax,
        heightCap,
        stageHeight: stage.height,
        y,
      })
      if (lockedHeightRef.current === null && !dragging && !resizing) {
        lockedHeightRef.current = nextH
      }
      const applied = heightProp ?? lockedHeightRef.current ?? nextH
      if (heightProp === undefined) {
        setLocalHeight((current) => (current === applied ? current : applied))
      }
      const ww = widthPx ?? (node.offsetWidth || 320)
      // While dragging, header may enter the tray band; at rest it must stay fully above.
      const maxY = dragging
        ? Math.max(TABLE_WINDOW_MARGIN, stage.height - WINDOW_HEADER_HEIGHT - TABLE_WINDOW_MARGIN)
        : liftYAboveTray(Number.POSITIVE_INFINITY, stage.height)
      const maxX = Math.max(TABLE_WINDOW_MARGIN, stage.width - ww - TABLE_WINDOW_MARGIN)
      const clampedX = Math.min(Math.max(TABLE_WINDOW_MARGIN, x), maxX)
      const clampedY = Math.min(Math.max(TABLE_WINDOW_MARGIN, y), maxY)
      if (clampedX !== x || clampedY !== y) onMove(clampedX, clampedY)
      if (
        !dragging &&
        !resizing &&
        onSize &&
        (widthPx !== ww || heightProp !== applied)
      ) {
        onSize({ width: ww, height: applied })
      }
    }

    const frame = window.requestAnimationFrame(sync)
    const parent = node.offsetParent as HTMLElement | null
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null
    if (parent && ro) ro.observe(parent)
    window.addEventListener("resize", sync)
    return () => {
      window.cancelAnimationFrame(frame)
      ro?.disconnect()
      window.removeEventListener("resize", sync)
    }
  }, [
    open,
    x,
    y,
    heightCap,
    maxHeightClassName,
    onMove,
    onSize,
    onTrayHover,
    dragging,
    resizing,
    widthPx,
    heightProp,
  ])

  if (!open) return null

  const trayHover = overTray
  const tuck = dragging && trayHover
  const lift = tuck
    ? "motion-safe:scale-[0.82] motion-safe:translate-y-2 shadow-[0_8px_18px_rgba(20,14,8,0.35)] opacity-90"
    : dragging
      ? "motion-safe:scale-[1.02] motion-safe:rotate-[1deg] shadow-[0_20px_40px_rgba(20,14,8,0.58)] motion-reduce:shadow-[0_14px_28px_rgba(20,14,8,0.5)] motion-reduce:scale-100 motion-reduce:rotate-0"
      : "shadow-[0_10px_22px_rgba(20,14,8,0.38)]"

  return (
    <div
      ref={rootRef}
      className={`pointer-events-auto absolute flex flex-col overflow-hidden rounded-[2px] border border-leather/65 bg-paper text-ink transition-[box-shadow,transform,opacity] duration-150 ease-out motion-reduce:transition-none ${widthClassName} ${maxHeightClassName} ${lift}`}
      style={{
        left: x,
        top: y,
        zIndex: z,
        width: widthPx,
        height: heightPx,
        maxHeight: heightPx,
        backgroundImage:
          "linear-gradient(180deg, rgba(255,250,240,0.55) 0%, rgba(243,234,215,0.2) 40%, rgba(214,198,168,0.35) 100%), radial-gradient(ellipse at 18% 12%, rgba(255,255,255,0.35), transparent 42%)",
      }}
      data-testid={testId}
      data-dragging={dragging ? "true" : undefined}
      data-over-tray={trayHover ? "true" : undefined}
      role="dialog"
      aria-label={title}
      onMouseDown={onFocus}
    >
      <header
        className="relative flex shrink-0 cursor-grab items-center gap-2 border-b border-leather/30 bg-paper-deep px-2.5 py-1.5 touch-none active:cursor-grabbing"
        style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35)", minHeight: WINDOW_HEADER_HEIGHT }}
        data-testid="floating-window-drag-handle"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.stopPropagation()
          onFocus()
          const node = rootRef.current
          const width = widthPx ?? node?.offsetWidth ?? 320
          const height = heightPx ?? node?.offsetHeight ?? 200
          setDragging(true)
          drag.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            origX: x,
            origY: y,
            width,
            height,
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const state = drag.current
          if (!state || state.pointerId !== event.pointerId) return
          event.preventDefault()
          event.stopPropagation()
          const node = rootRef.current
          const stage = measureStage(node)
          const next = positionAfterPointerDrag(
            { x: state.origX, y: state.origY },
            { clientX: state.startX, clientY: state.startY },
            { clientX: event.clientX, clientY: event.clientY },
            { w: state.width, h: state.height },
            { width: stage.width, height: stage.height },
          )
          onMove(next.x, next.y)
          const parent = node?.offsetParent as HTMLElement | null
          const parentTop = parent?.getBoundingClientRect().top ?? 0
          const relativeY = event.clientY - parentTop
          const hovering = shouldFileIntoTray({
            pointerY: relativeY,
            windowY: next.y,
            stageHeight: stage.height,
            trayHeight: DOCUMENT_TRAY_HEIGHT,
          })
          if (hovering !== overTray) {
            setOverTray(hovering)
            onTrayHover?.(hovering)
          }
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointerId !== event.pointerId) return
          const node = rootRef.current
          const stage = measureStage(node)
          const parent = node?.offsetParent as HTMLElement | null
          const parentTop = parent?.getBoundingClientRect().top ?? 0
          const relativeY = event.clientY - parentTop
          const shouldStow = Boolean(
            onStow &&
              shouldFileIntoTray({
                pointerY: relativeY,
                windowY: y,
                stageHeight: stage.height,
                trayHeight: DOCUMENT_TRAY_HEIGHT,
              }),
          )
          drag.current = null
          setDragging(false)
          setOverTray(false)
          onTrayHover?.(false)
          try {
            event.currentTarget.releasePointerCapture(event.pointerId)
          } catch {
            /* already released */
          }
          if (shouldStow) {
            onStow?.()
            return
          }
          // Missed the tray: never leave the grip hidden behind the bar.
          const lifted = liftYAboveTray(y, stage.height)
          if (lifted !== y) onMove(x, lifted)
        }}
        onPointerCancel={() => {
          const node = rootRef.current
          const stage = measureStage(node)
          drag.current = null
          setDragging(false)
          setOverTray(false)
          onTrayHover?.(false)
          const lifted = liftYAboveTray(y, stage.height)
          if (lifted !== y) onMove(x, lifted)
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            aria-hidden
            className="grid h-5 w-3.5 shrink-0 grid-cols-2 content-center gap-x-[3px] gap-y-[3px]"
            title="Drag"
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i} className="size-[3px] rounded-full bg-ink-muted/75" />
            ))}
          </span>
          <p className="min-w-0 truncate font-display text-base leading-none text-ink select-none">{title}</p>
        </div>
      </header>
      <div
        className={`min-h-0 flex-1 bg-[rgba(255,252,245,0.35)] ${
          bodyScroll ? "overflow-x-hidden overflow-y-auto" : "flex flex-col overflow-hidden"
        }`}
      >
        {children}
      </div>
      {resizable ? (
        <div
          className="absolute right-0 bottom-0 z-10 h-4 w-4 cursor-ns-resize touch-none"
          data-testid="floating-window-resize-handle"
          aria-hidden
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.stopPropagation()
            onFocus()
            const current = heightPx ?? rootRef.current?.offsetHeight ?? 200
            setResizing(true)
            resize.current = {
              pointerId: event.pointerId,
              startY: event.clientY,
              origHeight: current,
            }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            const state = resize.current
            if (!state || state.pointerId !== event.pointerId) return
            event.preventDefault()
            const stage = measureStage(rootRef.current)
            const preferredMax = parseCssMaxHeight(maxHeightClassName, stage.height)
            const dy = event.clientY - state.startY
            const next = resolveWindowHeight({
              lockedHeight: state.origHeight + dy,
              preferredMax,
              heightCap,
              stageHeight: stageHeightForWindows(stage.height),
              y,
              minHeight: 140,
            })
            lockedHeightRef.current = next
            setLocalHeight(next)
            const ww = widthPx ?? rootRef.current?.offsetWidth ?? 320
            onSize?.({ width: ww, height: next })
          }}
          onPointerUp={(event) => {
            if (resize.current?.pointerId === event.pointerId) {
              resize.current = null
              setResizing(false)
              try {
                event.currentTarget.releasePointerCapture(event.pointerId)
              } catch {
                /* already released */
              }
            }
          }}
          onPointerCancel={() => {
            resize.current = null
            setResizing(false)
          }}
        >
          <span className="absolute right-1 bottom-1 block h-2 w-2 border-r-2 border-b-2 border-leather/55" />
        </div>
      ) : null}
    </div>
  )
}
