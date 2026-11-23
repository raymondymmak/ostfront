/** Pure drag / height helpers for parchment FloatingWindow (client UX only). */

import {
  clampWindowPosition,
  DOCUMENT_TRAY_HEIGHT,
  stageHeightForWindows,
  TABLE_WINDOW_MARGIN,
} from "@/lib/ui/table-windows"

export { DOCUMENT_TRAY_HEIGHT, stageHeightForWindows }

export type Point = { x: number; y: number }
export type Size = { w: number; h: number }
export type StageSize = { width: number; height: number }

/** Pointer delta from press origin → clamped window top-left. Size is never mutated. */
export function positionAfterPointerDrag(
  origin: Point,
  pointerStart: { clientX: number; clientY: number },
  pointerNow: { clientX: number; clientY: number },
  size: Size,
  stage: StageSize,
  margin = TABLE_WINDOW_MARGIN,
): Point {
  return clampWindowPosition(
    origin.x + (pointerNow.clientX - pointerStart.clientX),
    origin.y + (pointerNow.clientY - pointerStart.clientY),
    size.w,
    size.h,
    stage.width,
    stage.height,
    margin,
  )
}

/** True when drag end leaves width/height unchanged (regression guard for Orders expand bug). */
export function dragPreservesSize(before: Size, after: Size): boolean {
  return before.w === after.w && before.h === after.h
}

/**
 * Viewport-bounded height for a floating paper.
 * Prefer a locked height so dragging toward the top of the stage cannot grow the window.
 */
export function resolveWindowHeight(args: {
  lockedHeight: number | null
  preferredMax: number
  heightCap?: number
  stageHeight: number
  y: number
  margin?: number
  minHeight?: number
}): number {
  const margin = args.margin ?? TABLE_WINDOW_MARGIN
  const minHeight = args.minHeight ?? 120
  const remaining = Math.max(minHeight, args.stageHeight - args.y - margin)
  const preferred =
    args.heightCap !== undefined
      ? Math.min(args.preferredMax, Math.max(minHeight, args.heightCap))
      : args.preferredMax
  const base = args.lockedHeight ?? preferred
  return Math.min(base, remaining, preferred)
}

/** Distance (px) of pointer travel that counts as a drag rather than a click. */
export const TRAY_DRAG_THRESHOLD_PX = 8

/**
 * While dragging a paper, dropping inside the tray band stows it.
 * `pointerY` is relative to the stage top.
 */
export function pointerInTrayZone(
  pointerY: number,
  stageHeight: number,
  trayHeight = DOCUMENT_TRAY_HEIGHT,
): boolean {
  return pointerY >= stageHeight - trayHeight
}

/** Soft restore position just above the tray when lifting a tab with a click. */
export function restorePositionAboveTray(
  preferred: Point,
  size: Size,
  stage: StageSize,
  trayHeight = DOCUMENT_TRAY_HEIGHT,
): Point {
  const usable: StageSize = {
    width: stage.width,
    height: stageHeightForWindows(stage.height, trayHeight),
  }
  return clampWindowPosition(preferred.x, preferred.y, size.w, size.h, usable.width, usable.height)
}
