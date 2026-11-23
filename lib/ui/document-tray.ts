/** Document-tray model: stowed papers as tabs, restored as floating windows. */

import { DOCUMENT_TRAY_HEIGHT, type StackedWindow } from "@/lib/ui/table-windows"
import { TRAY_DRAG_THRESHOLD_PX, type Point } from "@/lib/ui/window-drag"

export { DOCUMENT_TRAY_HEIGHT, TRAY_DRAG_THRESHOLD_PX }

export type TrayItemSpec<Id extends string> = {
  id: Id
  label: string
  testId: string
  /** Optional longer name for aria-label when label is abbreviated. */
  title?: string
}

/** Stow = close into the tray (open:false). Restore = open+raise z. */
export function stowWindow<Id extends string>(
  windows: StackedWindow<Id>[],
  id: Id,
): StackedWindow<Id>[] {
  return windows.map((item) => (item.id === id ? { ...item, open: false } : item))
}

export function restoreWindow<Id extends string>(
  windows: StackedWindow<Id>[],
  id: Id,
  position?: Point,
): StackedWindow<Id>[] {
  const maxZ = windows.reduce((max, item) => Math.max(max, item.z), 20)
  return windows.map((item) => {
    if (item.id !== id) return item
    return {
      ...item,
      open: true,
      z: maxZ + 1,
      ...(position ? { x: position.x, y: position.y } : {}),
    }
  })
}

export function isStowed<Id extends string>(windows: StackedWindow<Id>[], id: Id): boolean {
  const item = windows.find((entry) => entry.id === id)
  return Boolean(item && !item.open)
}

/** Escape / Stow: return the topmost open paper to the tray. */
export function stowTopmostWindow<Id extends string>(
  windows: StackedWindow<Id>[],
): StackedWindow<Id>[] {
  let best: StackedWindow<Id> | null = null
  for (const item of windows) {
    if (!item.open) continue
    if (!best || item.z > best.z) best = item
  }
  if (!best) return windows
  return stowWindow(windows, best.id)
}

export function pointerMovedEnough(
  start: { clientX: number; clientY: number },
  now: { clientX: number; clientY: number },
  threshold = TRAY_DRAG_THRESHOLD_PX,
): boolean {
  const dx = now.clientX - start.clientX
  const dy = now.clientY - start.clientY
  return dx * dx + dy * dy >= threshold * threshold
}

const SESSION_PREFIX = "ostfront-windows-v1:"

export type PersistedWindowLayout<Id extends string> = {
  windows: Array<Pick<StackedWindow<Id>, "id" | "open" | "x" | "y" | "z" | "height" | "width">>
}

export function sessionStorageKey(scope: "campaign" | "teach"): string {
  return `${SESSION_PREFIX}${scope}`
}

/** Read layout from sessionStorage; returns null when missing or corrupt. */
export function loadWindowSession<Id extends string>(
  scope: "campaign" | "teach",
): PersistedWindowLayout<Id> | null {
  if (typeof sessionStorage === "undefined") return null
  try {
    const raw = sessionStorage.getItem(sessionStorageKey(scope))
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedWindowLayout<Id>
    if (!parsed || !Array.isArray(parsed.windows)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveWindowSession<Id extends string>(
  scope: "campaign" | "teach",
  windows: StackedWindow<Id>[],
): void {
  if (typeof sessionStorage === "undefined") return
  try {
    const payload: PersistedWindowLayout<Id> = {
      windows: windows.map(({ id, open, x, y, z, height, width }) => ({
        id,
        open,
        x,
        y,
        z,
        height,
        width,
      })),
    }
    sessionStorage.setItem(sessionStorageKey(scope), JSON.stringify(payload))
  } catch {
    /* quota / private mode */
  }
}

/** Merge persisted open/xy/z onto a fresh default layout (ids must match). */
export function applyPersistedLayout<Id extends string>(
  defaults: StackedWindow<Id>[],
  persisted: PersistedWindowLayout<Id> | null,
): StackedWindow<Id>[] {
  if (!persisted) return defaults
  const byId = new Map(persisted.windows.map((item) => [item.id, item]))
  return defaults.map((item) => {
    const saved = byId.get(item.id)
    if (!saved) return item
    return {
      ...item,
      open: saved.open,
      x: saved.x,
      y: saved.y,
      z: saved.z,
      ...(saved.height !== undefined ? { height: saved.height } : {}),
      ...(saved.width !== undefined ? { width: saved.width } : {}),
    }
  })
}

export const CAMPAIGN_TRAY_ITEMS: TrayItemSpec<
  "orders" | "province" | "log" | "legend" | "advisor" | "ohl"
>[] = [
  { id: "orders", label: "Orders", testId: "tab-orders" },
  { id: "province", label: "Province", testId: "tab-province" },
  { id: "log", label: "Log", testId: "chronicle-log-toggle" },
  { id: "legend", label: "Legend", testId: "legend-toggle" },
  { id: "advisor", label: "Chief of Staff", testId: "advisor-toggle", title: "Chief of Staff" },
  { id: "ohl", label: "OHL", testId: "ohl-toggle", title: "Orders from OHL" },
]

export const TEACH_TRAY_ITEMS: TrayItemSpec<"lesson" | "orders" | "province" | "legend">[] = [
  { id: "lesson", label: "Lesson", testId: "teach-lesson-toggle" },
  { id: "orders", label: "Orders", testId: "tab-orders" },
  { id: "province", label: "Province", testId: "tab-province" },
  { id: "legend", label: "Legend", testId: "legend-toggle" },
]

/** Phone /teach: Lesson stays pinned; tray swaps the lower panel only. */
export const TEACH_PHONE_TRAY_ITEMS: TrayItemSpec<"orders" | "province" | "legend">[] = [
  { id: "orders", label: "Orders", testId: "tab-orders" },
  { id: "province", label: "Province", testId: "tab-province" },
  { id: "legend", label: "Legend", testId: "legend-toggle" },
]
