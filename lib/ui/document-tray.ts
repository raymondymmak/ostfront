/** Document-tray model: stowed papers as tabs, restored as floating windows. */

import {
  DOCUMENT_TRAY_HEIGHT,
  ensurePaperZ,
  stageHeightForWindows,
  TABLE_WINDOW_MARGIN,
  type StackedWindow,
} from "@/lib/ui/table-windows"
import {
  headerOverlapsTray,
  liftYAboveTray,
  TRAY_DRAG_THRESHOLD_PX,
  type Point,
} from "@/lib/ui/window-drag"

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

/** Default tray tab order from the static item list. */
export function defaultTrayOrder<Id extends string>(items: TrayItemSpec<Id>[]): Id[] {
  return items.map((item) => item.id)
}

/** Keep known ids, drop unknowns, append any missing ids in default order. */
export function normalizeTrayOrder<Id extends string>(
  order: readonly Id[] | undefined,
  knownIds: readonly Id[],
): Id[] {
  const knownSet = new Set(knownIds)
  const next: Id[] = []
  const seen = new Set<Id>()
  for (const id of order ?? []) {
    if (knownSet.has(id) && !seen.has(id)) {
      next.push(id)
      seen.add(id)
    }
  }
  for (const id of knownIds) {
    if (!seen.has(id)) next.push(id)
  }
  return next
}

/** Sort tray item specs by a persisted/user order. */
export function orderTrayItems<Id extends string>(
  items: TrayItemSpec<Id>[],
  order: readonly Id[],
): TrayItemSpec<Id>[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const seen = new Set<Id>()
  const ordered: TrayItemSpec<Id>[] = []
  for (const id of order) {
    const item = byId.get(id)
    if (item) {
      ordered.push(item)
      seen.add(id)
    }
  }
  for (const item of items) {
    if (!seen.has(item.id)) ordered.push(item)
  }
  return ordered
}

export type TrayTabSlot = { left: number; width: number }

/**
 * Insertion index among `slots` (left→right) for a pointer X.
 * Index runs 0…slots.length (before first … after last).
 */
export function insertIndexAtClientX(clientX: number, slots: readonly TrayTabSlot[]): number {
  if (slots.length === 0) return 0
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!
    if (clientX < slot.left + slot.width / 2) return i
  }
  return slots.length
}

/**
 * Place `id` at `index` among `among` (a subset of order, usually visible tabs
 * excluding `id`). Rebuilds the full order preserving non-among entries.
 */
export function placeIdInOrder<Id extends string>(
  order: readonly Id[],
  id: Id,
  index: number,
  among?: readonly Id[],
): Id[] {
  const known = order.includes(id) ? [...order] : [...order, id]
  const without = known.filter((entry) => entry !== id)
  const reference = (among ?? without).filter((entry) => entry !== id)
  const clamped = Math.max(0, Math.min(index, reference.length))
  let spliceAt: number
  if (clamped >= reference.length) {
    const last = reference[reference.length - 1]
    spliceAt = last === undefined ? without.length : without.indexOf(last) + 1
  } else {
    const target = reference[clamped]!
    spliceAt = without.indexOf(target)
    if (spliceAt < 0) spliceAt = without.length
  }
  const next = [...without]
  next.splice(Math.max(0, spliceAt), 0, id)
  return next
}

/** Move a focused/stowed tab one slot left (−1) or right (+1) among visible tabs. */
export function shiftTrayId<Id extends string>(
  order: readonly Id[],
  id: Id,
  delta: -1 | 1,
  openById: Partial<Record<Id, boolean>>,
): Id[] {
  const visible = order.filter((entry) => !openById[entry])
  const idx = visible.indexOf(id)
  if (idx < 0) return [...order]
  const dest = Math.max(0, Math.min(visible.length - 1, idx + delta))
  if (dest === idx) return [...order]
  const among = visible.filter((entry) => entry !== id)
  return placeIdInOrder(order, id, dest, among)
}

const SESSION_PREFIX = "ostfront-windows-v1:"

export type PersistedWindowLayout<Id extends string> = {
  windows: Array<Pick<StackedWindow<Id>, "id" | "open" | "x" | "y" | "z" | "height" | "width">>
  /** User tray tab order (all paper ids). */
  trayOrder?: Id[]
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
  trayOrder?: readonly Id[],
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
      ...(trayOrder ? { trayOrder: [...trayOrder] } : {}),
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

/**
 * Lift any paper whose saved Y puts the header under/behind the tray,
 * and when a locked height is known keep the whole box above the tray.
 * Bump z so session-restored papers never paint under the tray bar.
 * Call after applyPersistedLayout with the live map-stage height.
 */
export function liftPersistedWindowsAboveTray<Id extends string>(
  windows: StackedWindow<Id>[],
  stageHeight: number,
): StackedWindow<Id>[] {
  const usableH = stageHeightForWindows(stageHeight)
  const m = TABLE_WINDOW_MARGIN
  return windows.map((item) => {
    const z = ensurePaperZ(item.z)
    let y = headerOverlapsTray(item.y, stageHeight)
      ? liftYAboveTray(item.y, stageHeight)
      : item.y
    if (item.height != null && item.height > 0) {
      const maxY = Math.max(m, usableH - item.height - m)
      y = Math.min(y, maxY)
    }
    if (z === item.z && y === item.y) return item
    return { ...item, y, z }
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
