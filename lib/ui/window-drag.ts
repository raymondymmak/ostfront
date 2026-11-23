/** Pure drag / height helpers for parchment FloatingWindow (client UX only). */

import {
  clampWindowPosition,
  DOCUMENT_TRAY_HEIGHT,
  stageHeightForWindows,
  TABLE_WINDOW_MARGIN,
  WINDOW_HEADER_HEIGHT,
} from "@/lib/ui/table-windows"

export { DOCUMENT_TRAY_HEIGHT, stageHeightForWindows, WINDOW_HEADER_HEIGHT }

export type Point = { x: number; y: number }
export type Size = { w: number; h: number }
export type StageSize = { width: number; height: number }

/**
 * Pointer delta from press origin → clamped window top-left.
 * Size is never mutated. While dragging, the header grip stays fully above the tray
 * (never hidden behind it); filing uses the pointer position, not paper overlap.
 */
export function positionAfterPointerDrag(
  origin: Point,
  pointerStart: { clientX: number; clientY: number },
  pointerNow: { clientX: number; clientY: number },
  size: Size,
  stage: StageSize,
  margin = TABLE_WINDOW_MARGIN,
): Point {
  const raw = clampWindowPosition(
    origin.x + (pointerNow.clientX - pointerStart.clientX),
    origin.y + (pointerNow.clientY - pointerStart.clientY),
    size.w,
    size.h,
    stage.width,
    stage.height,
    margin,
    { headerOnlyY: true },
  )
  return {
    x: raw.x,
    y: liftYAboveTray(raw.y, stage.height, DOCUMENT_TRAY_HEIGHT, WINDOW_HEADER_HEIGHT, margin),
  }
}

/** True when drag end leaves width/height unchanged (regression guard for Orders expand bug). */
export function dragPreservesSize(before: Size, after: Size): boolean {
  return before.w === after.w && before.h === after.h
}

/**
 * Viewport-bounded height for a floating paper.
 * A locked height must not change while dragging (neither grow nor shrink with y).
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
  const preferred =
    args.heightCap !== undefined
      ? Math.min(args.preferredMax, Math.max(minHeight, args.heightCap))
      : args.preferredMax
  const stageCap = Math.max(minHeight, args.stageHeight - margin * 2)
  if (args.lockedHeight != null) {
    return Math.min(args.lockedHeight, stageCap)
  }
  const remaining = Math.max(minHeight, args.stageHeight - args.y - margin)
  return Math.min(preferred, remaining, stageCap)
}

/** Distance (px) of pointer travel that counts as a drag rather than a click. */
export const TRAY_DRAG_THRESHOLD_PX = 8

/** Top edge of the document tray within the map stage (stage-local Y). */
export function trayTopY(stageHeight: number, trayHeight = DOCUMENT_TRAY_HEIGHT): number {
  return stageHeight - trayHeight
}

/**
 * Max Y so the header grip stays fully above the tray (never hidden behind it).
 * Used both while dragging and when resting after a missed drop.
 */
export function maxRestingYAboveTray(
  stageHeight: number,
  trayHeight = DOCUMENT_TRAY_HEIGHT,
  headerHeight = WINDOW_HEADER_HEIGHT,
  margin = TABLE_WINDOW_MARGIN,
): number {
  return Math.max(margin, trayTopY(stageHeight, trayHeight) - headerHeight)
}

/** True when the header overlaps or sits under the tray band. */
export function headerOverlapsTray(
  windowY: number,
  stageHeight: number,
  trayHeight = DOCUMENT_TRAY_HEIGHT,
  headerHeight = WINDOW_HEADER_HEIGHT,
): boolean {
  return windowY + headerHeight > trayTopY(stageHeight, trayHeight)
}

/**
 * Pointer over/below the tray band (stage-local Y). The whole bottom bar counts.
 * Values past the stage bottom (pointer left the viewport downward) also count.
 */
export function pointerInTrayZone(
  pointerY: number,
  stageHeight: number,
  trayHeight = DOCUMENT_TRAY_HEIGHT,
): boolean {
  return pointerY >= trayTopY(stageHeight, trayHeight)
}

/** True when the pointer is at or past the bottom of the browser viewport. */
export function pointerPastViewportBottom(
  clientY: number,
  viewportHeight: number,
): boolean {
  return clientY >= viewportHeight
}

/**
 * File on release when the pointer is on the tray, below it, past the stage,
 * or at/past the viewport bottom — or when the paper header already overlaps.
 */
export function shouldFileIntoTray(args: {
  pointerY: number
  windowY: number
  stageHeight: number
  trayHeight?: number
  headerHeight?: number
  clientY?: number
  viewportHeight?: number
}): boolean {
  const trayHeight = args.trayHeight ?? DOCUMENT_TRAY_HEIGHT
  const headerHeight = args.headerHeight ?? WINDOW_HEADER_HEIGHT
  if (pointerInTrayZone(args.pointerY, args.stageHeight, trayHeight)) return true
  if (
    args.clientY != null &&
    args.viewportHeight != null &&
    pointerPastViewportBottom(args.clientY, args.viewportHeight)
  ) {
    return true
  }
  if (headerOverlapsTray(args.windowY, args.stageHeight, trayHeight, headerHeight)) return true
  return false
}

/** Snap Y so the header grip stays fully above the tray. */
export function liftYAboveTray(
  y: number,
  stageHeight: number,
  trayHeight = DOCUMENT_TRAY_HEIGHT,
  headerHeight = WINDOW_HEADER_HEIGHT,
  margin = TABLE_WINDOW_MARGIN,
): number {
  const maxY = maxRestingYAboveTray(stageHeight, trayHeight, headerHeight, margin)
  return Math.min(Math.max(margin, y), maxY)
}

/** True when the paper header can still reach the tray top (for drop targeting). */
export function canDragDownToTray(
  stageHeight: number,
  trayHeight = DOCUMENT_TRAY_HEIGHT,
  headerHeight = WINDOW_HEADER_HEIGHT,
  margin = TABLE_WINDOW_MARGIN,
): boolean {
  const maxY = maxRestingYAboveTray(stageHeight, trayHeight, headerHeight, margin)
  const trayTop = trayTopY(stageHeight, trayHeight)
  return maxY + headerHeight >= trayTop - margin
}

/** Soft restore position when taking a tab out with Enter (no pointer drop). */
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
  const clamped = clampWindowPosition(
    preferred.x,
    preferred.y,
    size.w,
    size.h,
    usable.width,
    usable.height,
  )
  return {
    x: clamped.x,
    y: liftYAboveTray(clamped.y, stage.height, trayHeight),
  }
}
