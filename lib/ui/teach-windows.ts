/** Desktop /teach floating windows — same parchment shell as the campaign table. */

import {
  clampWindowPosition,
  TABLE_WINDOW_MARGIN,
  type StackedWindow,
} from "@/lib/ui/table-windows"
import { stageHeightForWindows } from "@/lib/ui/table-windows"

export type TeachWindowId = "orders" | "province" | "legend" | "lesson"

export type TeachWindowState = StackedWindow<TeachWindowId>

const BASE_Z = 20
const GAP = 12

export const TEACH_WINDOW_SIZE_HINTS: Record<TeachWindowId, { w: number; h: number }> = {
  lesson: { w: 340, h: 460 },
  orders: { w: 360, h: 480 },
  province: { w: 360, h: 480 },
  /** Compact under Lesson; tall enough that Depot / VP / Rails stay readable. */
  legend: { w: 280, h: 248 },
}

export type TeachWindowRect = {
  id: TeachWindowId
  open: boolean
  x: number
  y: number
  w: number
  h: number
}

/** Axis-aligned overlap (zero gap counts as overlap). */
export function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  gap = 0,
): boolean {
  return !(
    a.x + a.w + gap <= b.x ||
    b.x + b.w + gap <= a.x ||
    a.y + a.h + gap <= b.y ||
    b.y + b.h + gap <= a.y
  )
}

/**
 * Budgeted heights for default placement at a map stage size.
 * Lesson + Legend share the left column; heights split so both fit with a gap.
 */
export function teachWindowHeights(mapWidth: number, mapHeight: number): Record<TeachWindowId, number> {
  void mapWidth
  const m = TABLE_WINDOW_MARGIN
  const usableH = stageHeightForWindows(mapHeight)
  const belowMapMode = 100
  // Leave a few px so FloatingWindow chrome / rounding cannot clamp Legend up into Lesson.
  const safety = 16
  const columnBudget = Math.max(280, usableH - belowMapMode - m - safety)
  const stackBudget = Math.max(260, columnBudget - GAP)

  // Prefer a tall Lesson (Resolve + prediction reachable) and a Legend that still shows Depot/Rails.
  let legendH = Math.min(TEACH_WINDOW_SIZE_HINTS.legend.h, Math.max(200, Math.floor(stackBudget * 0.36)))
  let lessonH = Math.min(TEACH_WINDOW_SIZE_HINTS.lesson.h, stackBudget - legendH)
  if (lessonH < 220) {
    lessonH = Math.min(TEACH_WINDOW_SIZE_HINTS.lesson.h, Math.max(200, Math.floor(stackBudget * 0.58)))
    legendH = Math.min(TEACH_WINDOW_SIZE_HINTS.legend.h, Math.max(180, stackBudget - lessonH))
  }

  // Final guard: Lesson + gap + Legend must fit under the map-mode strip.
  const maxStack = Math.max(260, usableH - belowMapMode - m - safety)
  if (lessonH + GAP + legendH > maxStack) {
    legendH = Math.min(legendH, Math.max(150, maxStack - GAP - 240))
    lessonH = Math.min(lessonH, Math.max(200, maxStack - GAP - legendH))
  }

  const ordersH = Math.min(
    TEACH_WINDOW_SIZE_HINTS.orders.h,
    Math.max(220, usableH - belowMapMode - m),
  )
  return {
    lesson: lessonH,
    orders: ordersH,
    province: ordersH,
    legend: legendH,
  }
}

/** Lesson FloatingWindow heightCap — leave map chrome room under the window. */
export function teachLessonHeightCap(mapHeight: number): number {
  return teachWindowHeights(1440, mapHeight).lesson
}

/** Legend FloatingWindow heightCap so it stays a compact bottom panel. */
export function teachLegendHeightCap(mapHeight: number): number {
  return teachWindowHeights(1440, mapHeight).legend
}

/** Open-window bounding boxes using placement-budgeted heights. */
export function openTeachWindowRects(
  windows: TeachWindowState[],
  mapWidth = 1440,
  mapHeight = 820,
): TeachWindowRect[] {
  const heights = teachWindowHeights(mapWidth, mapHeight)
  return windows
    .filter((item) => item.open)
    .map((item) => {
      const hint = TEACH_WINDOW_SIZE_HINTS[item.id]
      return {
        id: item.id,
        open: true,
        x: item.x,
        y: item.y,
        w: hint.w,
        h: heights[item.id],
      }
    })
}

/** True when any two open windows overlap (using placement-budgeted sizes). */
export function openTeachWindowsOverlap(
  windows: TeachWindowState[],
  mapWidth = 1440,
  mapHeight = 820,
  gap = GAP,
): boolean {
  const open = openTeachWindowRects(windows, mapWidth, mapHeight)
  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      if (rectsOverlap(open[i]!, open[j]!, gap)) return true
    }
  }
  return false
}

/**
 * Default /teach desktop layout: Lesson top-left, Legend directly under it in
 * the same left column (keeps Kraków/Kielce/Lublin clear), Orders top-right.
 */
export function createDefaultTeachWindows(
  mapWidth = 1440,
  mapHeight = 820,
): TeachWindowState[] {
  const m = TABLE_WINDOW_MARGIN
  const belowMapMode = 100
  const heights = teachWindowHeights(mapWidth, mapHeight)
  const ordersHint = TEACH_WINDOW_SIZE_HINTS.orders

  const lessonX = m
  const lessonY = belowMapMode
  // Same left edge as Lesson — stacked, not covering the map targets mid-stage.
  const legendX = lessonX
  const legendY = lessonY + heights.lesson + GAP

  const ordersXFinal = Math.max(m, mapWidth - ordersHint.w - m - 24)

  const raw: TeachWindowState[] = [
    { id: "lesson", open: true, x: lessonX, y: lessonY, z: BASE_Z + 4 },
    { id: "orders", open: true, x: ordersXFinal, y: belowMapMode, z: BASE_Z + 3 },
    { id: "legend", open: true, x: legendX, y: legendY, z: BASE_Z + 1 },
    { id: "province", open: false, x: ordersXFinal, y: belowMapMode, z: BASE_Z + 2 },
  ]

  return raw.map((item) => {
    const hint = TEACH_WINDOW_SIZE_HINTS[item.id]
    const h = heights[item.id]
    const clamped = clampWindowPosition(item.x, item.y, hint.w, h, mapWidth, mapHeight)
    return { ...item, ...clamped }
  })
}

export function teachWindowById(
  windows: TeachWindowState[],
  id: TeachWindowId,
): TeachWindowState | undefined {
  return windows.find((item) => item.id === id)
}

export function isTeachWindowOpen(windows: TeachWindowState[], id: TeachWindowId): boolean {
  return Boolean(teachWindowById(windows, id)?.open)
}

function nextZ(windows: TeachWindowState[]): number {
  return windows.reduce((max, item) => Math.max(max, item.z), BASE_Z) + 1
}

export function focusTeachWindow(
  windows: TeachWindowState[],
  id: TeachWindowId,
): TeachWindowState[] {
  const z = nextZ(windows)
  return windows.map((item) => (item.id === id ? { ...item, open: true, z } : item))
}

export function closeTeachWindow(
  windows: TeachWindowState[],
  id: TeachWindowId,
): TeachWindowState[] {
  return windows.map((item) => (item.id === id ? { ...item, open: false } : item))
}

export function toggleTeachWindow(
  windows: TeachWindowState[],
  id: TeachWindowId,
): TeachWindowState[] {
  const current = teachWindowById(windows, id)
  if (!current) return windows
  if (current.open) return closeTeachWindow(windows, id)
  return focusTeachWindow(windows, id)
}

export function moveTeachWindow(
  windows: TeachWindowState[],
  id: TeachWindowId,
  x: number,
  y: number,
): TeachWindowState[] {
  return windows.map((item) => (item.id === id ? { ...item, x, y } : item))
}

export function resizeTeachWindow(
  windows: TeachWindowState[],
  id: TeachWindowId,
  size: { height?: number; width?: number },
): TeachWindowState[] {
  return windows.map((item) =>
    item.id === id
      ? {
          ...item,
          ...(size.height !== undefined ? { height: size.height } : {}),
          ...(size.width !== undefined ? { width: size.width } : {}),
        }
      : item,
  )
}

export function topmostTeachWindow(windows: TeachWindowState[]): TeachWindowId | null {
  let best: TeachWindowState | null = null
  for (const item of windows) {
    if (!item.open) continue
    if (!best || item.z > best.z) best = item
  }
  return best?.id ?? null
}

export function closeTopmostTeachWindow(windows: TeachWindowState[]): TeachWindowState[] {
  const id = topmostTeachWindow(windows)
  if (!id) return windows
  return closeTeachWindow(windows, id)
}

export const TEACH_WINDOW_TITLES: Record<TeachWindowId, string> = {
  lesson: "Lesson",
  orders: "Orders",
  province: "Province",
  legend: "Legend",
}
