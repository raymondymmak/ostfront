/** Desktop /teach floating windows — same parchment shell as the campaign table. */

import {
  clampWindowPosition,
  TABLE_WINDOW_MARGIN,
  type StackedWindow,
} from "@/lib/ui/table-windows"

export type TeachWindowId = "orders" | "province" | "legend" | "lesson"

export type TeachWindowState = StackedWindow<TeachWindowId>

const BASE_Z = 20
const GAP = 12

export const TEACH_WINDOW_SIZE_HINTS: Record<TeachWindowId, { w: number; h: number }> = {
  lesson: { w: 340, h: 380 },
  orders: { w: 360, h: 480 },
  province: { w: 360, h: 480 },
  legend: { w: 280, h: 300 },
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

/** Budgeted heights for default placement at a map stage size. */
export function teachWindowHeights(mapWidth: number, mapHeight: number): Record<TeachWindowId, number> {
  void mapWidth
  const m = TABLE_WINDOW_MARGIN
  const belowMapMode = 100
  const lessonH = Math.min(
    TEACH_WINDOW_SIZE_HINTS.lesson.h,
    Math.max(200, mapHeight - belowMapMode - m),
  )
  const legendH = Math.min(
    TEACH_WINDOW_SIZE_HINTS.legend.h,
    Math.max(180, Math.floor(mapHeight * 0.38)),
  )
  const ordersH = Math.min(
    TEACH_WINDOW_SIZE_HINTS.orders.h,
    Math.max(220, mapHeight - belowMapMode - m),
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
 * Default /teach desktop layout: Lesson top-left, Orders top-right,
 * Legend bottom-left but to the right of the Lesson column (never under it).
 */
export function createDefaultTeachWindows(
  mapWidth = 1440,
  mapHeight = 820,
): TeachWindowState[] {
  const m = TABLE_WINDOW_MARGIN
  const belowMapMode = 100
  const heights = teachWindowHeights(mapWidth, mapHeight)
  const lessonHint = TEACH_WINDOW_SIZE_HINTS.lesson
  const ordersHint = TEACH_WINDOW_SIZE_HINTS.orders
  const legendHint = TEACH_WINDOW_SIZE_HINTS.legend

  const lessonX = m
  const lessonY = belowMapMode
  // Sit Legend beside the Lesson column so a tall Lesson cannot cover it.
  const legendX = Math.min(
    mapWidth - legendHint.w - m,
    Math.max(m, lessonX + lessonHint.w + GAP),
  )
  const legendY = Math.max(m, mapHeight - heights.legend - m)

  const ordersX = Math.max(
    legendX + legendHint.w + GAP,
    mapWidth - ordersHint.w - m - 24,
  )
  // If the stage is too narrow for Orders right of Legend, keep Orders at the
  // right edge (Legend stays left-of-center; Orders/Province share the right).
  const ordersXFinal =
    ordersX + ordersHint.w + m <= mapWidth
      ? ordersX
      : Math.max(m, mapWidth - ordersHint.w - m)

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
