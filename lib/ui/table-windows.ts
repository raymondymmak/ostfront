/** Desktop general's-table floating window ids and z-order helpers (client UX only). */

export type TableWindowId = "orders" | "province" | "log" | "legend" | "advisor" | "ohl"

export type TableWindowState = {
  id: TableWindowId
  open: boolean
  x: number
  y: number
  z: number
}

/** Tailwind `lg` — same breakpoint as the campaign shell (min-width 1024px). */
export const DESKTOP_SHELL_MQ = "(min-width: 1024px)"

const BASE_Z = 20

/** Default layout for a ~1440×900 map stage: Orders right, Legend bottom-left, OHL under the HUD. */
export function createDefaultTableWindows(
  mapWidth = 1440,
  mapHeight = 820,
): TableWindowState[] {
  const right = Math.max(12, mapWidth - 380)
  const bottomLegend = Math.max(12, mapHeight - 280)
  return [
    { id: "ohl", open: true, x: Math.min(200, Math.max(12, mapWidth * 0.12)), y: 12, z: BASE_Z + 2 },
    { id: "orders", open: true, x: right, y: 48, z: BASE_Z + 3 },
    { id: "legend", open: true, x: 12, y: bottomLegend, z: BASE_Z + 1 },
    {
      id: "province",
      open: false,
      x: Math.max(12, mapWidth - 760),
      y: 48,
      z: BASE_Z + 4,
    },
    {
      id: "log",
      // Sit to the right of the bottom-left Legend so open Log never covers it.
      open: false,
      x: Math.min(320, Math.max(200, mapWidth * 0.22)),
      y: Math.max(12, mapHeight - 420),
      z: BASE_Z + 5,
    },
    {
      id: "advisor",
      open: false,
      x: Math.max(12, mapWidth - 400),
      y: Math.max(12, mapHeight - 520),
      z: BASE_Z + 6,
    },
  ]
}

export function windowById(
  windows: TableWindowState[],
  id: TableWindowId,
): TableWindowState | undefined {
  return windows.find((item) => item.id === id)
}

export function isWindowOpen(windows: TableWindowState[], id: TableWindowId): boolean {
  return Boolean(windowById(windows, id)?.open)
}

function nextZ(windows: TableWindowState[]): number {
  return windows.reduce((max, item) => Math.max(max, item.z), BASE_Z) + 1
}

/** Raise z and ensure open. */
export function focusWindow(windows: TableWindowState[], id: TableWindowId): TableWindowState[] {
  const z = nextZ(windows)
  return windows.map((item) => (item.id === id ? { ...item, open: true, z } : item))
}

export function closeWindow(windows: TableWindowState[], id: TableWindowId): TableWindowState[] {
  return windows.map((item) => (item.id === id ? { ...item, open: false } : item))
}

/** Open+focus if closed; close if already open. */
export function toggleWindow(windows: TableWindowState[], id: TableWindowId): TableWindowState[] {
  const current = windowById(windows, id)
  if (!current) return windows
  if (current.open) return closeWindow(windows, id)
  return focusWindow(windows, id)
}

export function moveWindow(
  windows: TableWindowState[],
  id: TableWindowId,
  x: number,
  y: number,
): TableWindowState[] {
  return windows.map((item) => (item.id === id ? { ...item, x, y } : item))
}

/** Highest-z open window, or null. */
export function topmostOpenWindow(windows: TableWindowState[]): TableWindowId | null {
  let best: TableWindowState | null = null
  for (const item of windows) {
    if (!item.open) continue
    if (!best || item.z > best.z) best = item
  }
  return best?.id ?? null
}

export function closeTopmostWindow(windows: TableWindowState[]): TableWindowState[] {
  const id = topmostOpenWindow(windows)
  if (!id) return windows
  return closeWindow(windows, id)
}

export const TABLE_WINDOW_TITLES: Record<TableWindowId, string> = {
  orders: "Orders",
  province: "Province",
  log: "Log",
  legend: "Legend",
  advisor: "Chief of Staff",
  ohl: "Orders from OHL",
}
