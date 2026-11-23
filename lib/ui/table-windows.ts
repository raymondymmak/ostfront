/** Desktop general's-table floating window ids and z-order helpers (client UX only). */

export type TableWindowId = "orders" | "province" | "log" | "legend" | "advisor" | "ohl"

/** Shared frame for campaign and /teach floating windows. */
export type StackedWindow<Id extends string = string> = {
  id: Id
  open: boolean
  x: number
  y: number
  z: number
  /** Locked body height in px after measure/resize (retained across stow/restore). */
  height?: number
  /** Locked width in px when the player has a preferred size (retained across stow/restore). */
  width?: number
}

export type TableWindowState = StackedWindow<TableWindowId>

/** Tailwind `lg` — same breakpoint as the campaign shell (min-width 1024px). */
export const DESKTOP_SHELL_MQ = "(min-width: 1024px)"

export const TABLE_WINDOW_MARGIN = 8

/** Bottom parchment tray strip — drop target for filing papers. */
export const DOCUMENT_TRAY_HEIGHT = 48

/** Title-bar / drag-handle height — must stay on-screen while the body may overlap the tray. */
export const WINDOW_HEADER_HEIGHT = 36

/** Stage height used for default placement (leaves the tray clear). */
export function stageHeightForWindows(
  stageHeight: number,
  trayHeight = DOCUMENT_TRAY_HEIGHT,
): number {
  return Math.max(160, stageHeight - trayHeight)
}

/**
 * Papers paint above the document tray (`DOCUMENT_TRAY_Z` / CSS `z-[40]`).
 * A paper must never render behind the tray bar — including session-restored z.
 */
export const DOCUMENT_TRAY_Z = 40
export const PAPER_Z_FLOOR = DOCUMENT_TRAY_Z + 10
const BASE_Z = PAPER_Z_FLOOR

export type ClampWindowOptions = {
  /**
   * When true, Y clamp only keeps the header grip on-screen so papers can
   * overlap the tray (required for drag-to-file). Default placement uses false.
   */
  headerOnlyY?: boolean
}

/** Keep the window on the map stage; optionally allow body overlap with the tray. */
export function clampWindowPosition(
  x: number,
  y: number,
  winWidth: number,
  winHeight: number,
  stageWidth: number,
  stageHeight: number,
  margin = TABLE_WINDOW_MARGIN,
  options: ClampWindowOptions = {},
): { x: number; y: number } {
  const headerOnlyY = options.headerOnlyY === true
  const heightForY = headerOnlyY ? WINDOW_HEADER_HEIGHT : winHeight
  const usableH = headerOnlyY ? stageHeight : stageHeightForWindows(stageHeight)
  const maxX = Math.max(margin, stageWidth - winWidth - margin)
  const maxY = Math.max(margin, usableH - heightForY - margin)
  return {
    x: Math.min(maxX, Math.max(margin, x)),
    y: Math.min(maxY, Math.max(margin, y)),
  }
}

/** Soft size estimates used when placing defaults before measure. */
export const TABLE_WINDOW_SIZE_HINTS: Record<TableWindowId, { w: number; h: number }> = {
  ohl: { w: 480, h: 88 },
  orders: { w: 368, h: 520 },
  province: { w: 368, h: 520 },
  legend: { w: 288, h: 340 },
  log: { w: 384, h: 360 },
  advisor: { w: 384, h: 480 },
}

/** Default layout for a ~1440×900 map stage: Orders right, Legend bottom-left, OHL under the HUD. */
export function createDefaultTableWindows(
  mapWidth = 1440,
  mapHeight = 820,
): TableWindowState[] {
  const m = TABLE_WINDOW_MARGIN
  const usableH = stageHeightForWindows(mapHeight)
  // Leave the top-right MapMode + zoom strip clear (≈7rem wide, ≈6rem tall).
  const belowMapMode = 100
  const legendH = Math.min(TABLE_WINDOW_SIZE_HINTS.legend.h, Math.max(200, usableH - belowMapMode - m * 2))
  const ordersH = Math.min(TABLE_WINDOW_SIZE_HINTS.orders.h, Math.max(240, usableH - belowMapMode - m))
  const logH = Math.min(TABLE_WINDOW_SIZE_HINTS.log.h, Math.max(200, usableH - m * 2))

  const raw: TableWindowState[] = [
    { id: "ohl", open: true, x: Math.min(200, Math.max(m, mapWidth * 0.12)), y: m + 4, z: BASE_Z + 2 },
    {
      id: "orders",
      open: true,
      x: Math.max(m, mapWidth - TABLE_WINDOW_SIZE_HINTS.orders.w - m - 24),
      y: belowMapMode,
      z: BASE_Z + 3,
    },
    {
      id: "legend",
      open: true,
      x: m,
      y: Math.max(m, usableH - legendH - m),
      z: BASE_Z + 1,
    },
    {
      // Same right column as Orders so opening Province does not cover map click targets.
      id: "province",
      open: false,
      x: Math.max(m, mapWidth - TABLE_WINDOW_SIZE_HINTS.province.w - m - 24),
      y: belowMapMode,
      z: BASE_Z + 4,
    },
    {
      id: "log",
      // Sit to the right of the bottom-left Legend so open Log never covers it.
      open: false,
      x: Math.min(320, Math.max(200, mapWidth * 0.22)),
      y: Math.max(m, usableH - logH - m),
      z: BASE_Z + 5,
    },
    {
      id: "advisor",
      open: false,
      x: Math.max(m, mapWidth - TABLE_WINDOW_SIZE_HINTS.advisor.w - m - 24),
      y: Math.max(m, usableH - TABLE_WINDOW_SIZE_HINTS.advisor.h - m),
      z: BASE_Z + 6,
    },
  ]

  return raw.map((item) => {
    const hint = TABLE_WINDOW_SIZE_HINTS[item.id]
    const h =
      item.id === "orders" || item.id === "province"
        ? ordersH
        : item.id === "legend"
          ? legendH
          : item.id === "log"
            ? logH
            : hint.h
    const clamped = clampWindowPosition(item.x, item.y, hint.w, h, mapWidth, mapHeight)
    return { ...item, ...clamped }
  })
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
  return Math.max(PAPER_Z_FLOOR, windows.reduce((max, item) => Math.max(max, item.z), BASE_Z)) + 1
}

/** Ensure a paper's stacking order stays above the document tray. */
export function ensurePaperZ(z: number): number {
  return Math.max(PAPER_Z_FLOOR, z)
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

/** Persist measured/resized size so restore keeps width and last height. */
export function resizeWindow(
  windows: TableWindowState[],
  id: TableWindowId,
  size: { height?: number; width?: number },
): TableWindowState[] {
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
