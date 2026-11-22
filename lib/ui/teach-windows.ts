/** Desktop /teach floating windows — same parchment shell as the campaign table. */

import {
  clampWindowPosition,
  TABLE_WINDOW_MARGIN,
  type StackedWindow,
} from "@/lib/ui/table-windows"

export type TeachWindowId = "orders" | "province" | "legend" | "lesson"

export type TeachWindowState = StackedWindow<TeachWindowId>

const BASE_Z = 20

export const TEACH_WINDOW_SIZE_HINTS: Record<TeachWindowId, { w: number; h: number }> = {
  lesson: { w: 360, h: 420 },
  orders: { w: 368, h: 520 },
  province: { w: 368, h: 520 },
  legend: { w: 288, h: 340 },
}

/** Default /teach desktop layout: Lesson + Orders + Legend open; Province closed. */
export function createDefaultTeachWindows(
  mapWidth = 1440,
  mapHeight = 820,
): TeachWindowState[] {
  const m = TABLE_WINDOW_MARGIN
  const belowMapMode = 100
  const legendH = Math.min(
    TEACH_WINDOW_SIZE_HINTS.legend.h,
    Math.max(200, mapHeight - belowMapMode - m * 2),
  )
  const ordersH = Math.min(
    TEACH_WINDOW_SIZE_HINTS.orders.h,
    Math.max(240, mapHeight - belowMapMode - m),
  )
  // Keep Lesson above the bottom-left Legend so both stay reachable.
  const lessonH = Math.min(
    TEACH_WINDOW_SIZE_HINTS.lesson.h,
    Math.max(200, mapHeight - legendH - belowMapMode - m * 3),
  )

  const raw: TeachWindowState[] = [
    {
      id: "lesson",
      open: true,
      x: m,
      y: belowMapMode,
      z: BASE_Z + 4,
    },
    {
      id: "orders",
      open: true,
      x: Math.max(m, mapWidth - TEACH_WINDOW_SIZE_HINTS.orders.w - m - 24),
      y: belowMapMode,
      z: BASE_Z + 3,
    },
    {
      id: "legend",
      open: true,
      x: m,
      y: Math.max(m, mapHeight - legendH - m),
      z: BASE_Z + 1,
    },
    {
      id: "province",
      open: false,
      x: Math.max(m, mapWidth - TEACH_WINDOW_SIZE_HINTS.province.w - m - 24),
      y: belowMapMode,
      z: BASE_Z + 2,
    },
  ]

  return raw.map((item) => {
    const hint = TEACH_WINDOW_SIZE_HINTS[item.id]
    const h =
      item.id === "orders" || item.id === "province"
        ? ordersH
        : item.id === "legend"
          ? legendH
          : lessonH
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
