"use client"

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"
import { AdvisorPanel } from "@/components/advisor-panel"
import { Hud } from "@/components/hud"
import { OrderPanel } from "@/components/order-panel"
import { ProvincePanel } from "@/components/province-panel"
import { ChronicleDrawer } from "@/components/chronicle-drawer"
import { DocumentTray } from "@/components/document-tray"
import { FloatingWindow } from "@/components/floating-window"
import { MapLegend } from "@/components/map-legend"
import { OhlOrdersWindow } from "@/components/ohl-orders-window"
import { TimelinePanel } from "@/components/timeline-panel"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import {
  applyPersistedLayout,
  CAMPAIGN_PHONE_TRAY_ITEMS,
  CAMPAIGN_TRAY_ITEMS,
  defaultTrayOrder,
  insertIndexAtClientX,
  liftPersistedWindowsAboveTray,
  loadWindowSession,
  normalizeTrayOrder,
  orderTrayItems,
  placeIdInOrder,
  saveWindowSession,
  stowTopmostWindow,
  stowWindow,
} from "@/lib/ui/document-tray"
import { CATALOG_BY_ID } from "@/lib/data/catalog"
import { CampaignStart } from "@/components/campaign-start"
import { EndgameModal } from "@/components/endgame-modal"
import { NewsCardQueue } from "@/components/news-card"
import { objectiveValue } from "@/lib/data/objectives"
import { RECRUIT, spendable } from "@/lib/engine/economy"
import type { PaintOverlayMode } from "@/lib/map/province-paint"
import {
  FINAL_POSITIONS_LABEL,
  SEE_RESULT_LABEL,
  finalePhase,
  ordersLocked,
} from "@/lib/finale"
import type { CoachHighlight } from "@/lib/gm/campaign-coach"
import { CLIENT_TURN_TIMEOUT_MS } from "@/lib/gm/timeouts"
import { formatTurnFailure } from "@/lib/turn-failure"
import { queuedToPlayerOrders, type QueuedOrder } from "@/lib/orders"
import type { ChipDrop } from "@/lib/ui/drag-order"
import { campaignGoalLine } from "@/lib/ui/goal-copy"
import { legalTargets, mapProvinceHoverNote, previewMarch } from "@/lib/ui/legal-targets"
import { toggleSelection } from "@/lib/ui/selection"
import {
  createDefaultTableWindows,
  focusWindow,
  isWindowOpen,
  moveWindow,
  resizeWindow,
  type TableWindowId,
  type TableWindowState,
  TABLE_WINDOW_SIZE_HINTS,
  TABLE_WINDOW_TITLES,
} from "@/lib/ui/table-windows"
import { restorePositionAboveTray } from "@/lib/ui/window-drag"
import { useDesktopShell } from "@/lib/ui/use-desktop-shell"
import { selectNewsEvents } from "@/lib/news/select"
import type { NewsEvent } from "@/lib/news/types"
import {
  bootCampaignShell,
  campaignShellReducer,
  shellBeginBusy,
  shellIsSetup,
  shellResultOpen,
  shellStale,
  shellTurnBusy,
} from "@/lib/ui/campaign-shell"
import { clearGame, freshGame, loadGame, peekSave, saveGame } from "@/lib/storage"
import type { Difficulty, GameState, PlayerOrder, SaveGame, TurnRecord, UnitKind } from "@/lib/types"
import { WarMap, type MapProvince } from "@/components/war-map"

export function GameApp() {
  const [game, setGame] = useState<SaveGame>(() => {
    if (typeof window === "undefined") return freshGame()
    return loadGame() ?? freshGame()
  })
  const [shell, dispatchShell] = useReducer(
    campaignShellReducer,
    undefined as unknown as ReturnType<typeof bootCampaignShell>,
    () => {
      const persisted = typeof window !== "undefined" ? peekSave() : null
      return bootCampaignShell(persisted?.gameId)
    },
  )
  const setupOpen = shellIsSetup(shell)
  const beginBusy = shellBeginBusy(shell)
  const busy = shellTurnBusy(shell)
  const staleCampaign = shellStale(shell)
  const resultOpen = shellResultOpen(shell)
  const [difficulty, setDifficulty] = useState<Difficulty>("normal")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<PaintOverlayMode>("none")
  const [orderMode, setOrderMode] = useState(false)
  const [queue, setQueue] = useState<QueuedOrder[]>([])
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [flash, setFlash] = useState<string[]>([])
  const [logIndex, setLogIndex] = useState<number | null>(null)
  const [armReset, setArmReset] = useState(false)
  const [sideTab, setSideTab] = useState("orders")
  const [chatEpoch, setChatEpoch] = useState(0)
  const [newsQueue, setNewsQueue] = useState<NewsEvent[]>([])
  const [coachHighlightIds, setCoachHighlightIds] = useState<string[]>([])
  const [windows, setWindows] = useState<TableWindowState[]>(() => createDefaultTableWindows())
  const [trayOrder, setTrayOrder] = useState<TableWindowId[]>(() => defaultTrayOrder(CAMPAIGN_TRAY_ITEMS))
  const [trayDropActive, setTrayDropActive] = useState(false)
  const [trayInsertIndex, setTrayInsertIndex] = useState<number | null>(null)
  const [showRails, setShowRails] = useState(true)
  const campaignTrayIds = useMemo(() => defaultTrayOrder(CAMPAIGN_TRAY_ITEMS), [])
  const orderedCampaignTrayItems = useMemo(
    () => orderTrayItems(CAMPAIGN_TRAY_ITEMS, trayOrder),
    [trayOrder],
  )
  const orderedCampaignPhoneTrayItems = useMemo(
    () => orderTrayItems(CAMPAIGN_PHONE_TRAY_ITEMS, trayOrder),
    [trayOrder],
  )
  const desktopShell = useDesktopShell()
  const mapStageRef = useRef<HTMLDivElement>(null)
  const advisorOpen = isWindowOpen(windows, "advisor")
  const logOpen = isWindowOpen(windows, "log")
  const ohlOpen = isWindowOpen(windows, "ohl")

  useEffect(() => {
    if (!setupOpen && game.gameId) saveGame(game)
  }, [game, setupOpen])

  useEffect(() => {
    if (shell.kind === "table" && !game.gameId) {
      dispatchShell({ type: "ENTER_SETUP" })
    }
  }, [shell.kind, game.gameId])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (process.env.NODE_ENV !== "development" && !params.has("newsDemo")) return
    const win = window as Window & { __ostfrontSetNewsQueue?: (events: NewsEvent[]) => void }
    win.__ostfrontSetNewsQueue = setNewsQueue
    return () => {
      delete win.__ostfrontSetNewsQueue
    }
  }, [])

  useEffect(() => {
    const saved = loadGame()
    const gameId = saved?.gameId
    if (!gameId) return
    const newsDemo =
      typeof window !== "undefined" && new URLSearchParams(window.location.search).has("newsDemo")
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(`/api/game?gameId=${encodeURIComponent(gameId)}`)
        if (!response.ok || cancelled) return
        const payload = (await response.json()) as SaveGame & { gameId: string }
        if (!payload.state || cancelled) return
        const log =
          newsDemo && saved?.log?.length ? saved.log : (payload.log ?? [])
        setGame({
          version: 2,
          gameId: payload.gameId,
          state: payload.state,
          log,
        })
        dispatchShell({ type: "BEGIN_SUCCESS", gameId: payload.gameId })
      } catch {
        /* keep local render until the next successful turn */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!hint) return
    const timer = window.setTimeout(() => setHint(null), 7000)
    return () => window.clearTimeout(timer)
  }, [hint])

  useEffect(() => {
    if (!armReset) return
    const timer = window.setTimeout(() => setArmReset(false), 4000)
    return () => window.clearTimeout(timer)
  }, [armReset])

  const provinces = useMemo<MapProvince[]>(
    () =>
      game.state.provinces.map((province) => ({
        ...province,
        polygon: CATALOG_BY_ID[province.id]?.polygon ?? [],
        centroid: CATALOG_BY_ID[province.id]?.centroid ?? [0, 0],
        vp: objectiveValue(game.state.scenario, province.id) || undefined,
      })),
    [game.state.provinces, game.state.scenario],
  )
  const attacking = new Set(
    queue.filter((order) => order.kind === "attack").flatMap((order) => order.unitIds),
  )
  const budget = spendable(game.state, "central", attacking)
  for (const order of queue) {
    if (order.kind !== "recruit" || !order.unitKind) continue
    const cost = RECRUIT[order.unitKind]
    budget.mp -= cost.mp
    budget.ip -= cost.ip
  }
  const selected = game.state.provinces.find((province) => province.id === selectedId) ?? null
  const activeLog = logIndex ?? Math.max(0, game.log.length - 1)
  const finished = ordersLocked(Boolean(game.state.result))
  const phase = finalePhase(finished, resultOpen)
  const mapTargets = useMemo(() => {
    if (finished || !selected) return null
    return legalTargets(game.state, selected.id, queue)
  }, [finished, selected, game.state, queue])

  const selectProvince = useCallback((id: string) => {
    setSelectedId((current) => toggleSelection(current, id))
  }, [setSelectedId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (newsQueue.length > 0) return
      if (resultOpen || setupOpen) return
      if (desktopShell) {
        if (windows.some((item) => item.open)) {
          setWindows((current) => stowTopmostWindow(current))
          return
        }
        setSelectedId(null)
        return
      }
      if (logOpen) return
      if (advisorOpen) return
      setSelectedId(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [newsQueue.length, logOpen, setupOpen, advisorOpen, resultOpen, desktopShell, windows])

  function resetTableWindows() {
    const node = mapStageRef.current
    const width = node?.clientWidth || (typeof window !== "undefined" ? window.innerWidth : 1440)
    const height =
      node?.clientHeight ||
      Math.max(400, (typeof window !== "undefined" ? window.innerHeight : 900) - 120)
    const defaults = createDefaultTableWindows(width, height)
    const persisted = loadWindowSession<TableWindowId>("campaign")
    const restored = applyPersistedLayout(defaults, persisted)
    setWindows(liftPersistedWindowsAboveTray(restored, height))
    setTrayOrder(normalizeTrayOrder(persisted?.trayOrder, campaignTrayIds))
  }

  useEffect(() => {
    if (setupOpen) return
    const frame = window.requestAnimationFrame(() => resetTableWindows())
    return () => window.cancelAnimationFrame(frame)
    // Re-seed layout when entering the table / switching shell — not on every order change.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resetTableWindows reads live stage + session
  }, [setupOpen, desktopShell])

  useEffect(() => {
    if (setupOpen || !desktopShell) return
    saveWindowSession("campaign", windows, trayOrder)
  }, [windows, trayOrder, setupOpen, desktopShell])

  function setWindowOpen(id: TableWindowId, open: boolean) {
    setWindows((current) => (open ? focusWindow(current, id) : stowWindow(current, id)))
  }

  function measureTraySlots(excludeId?: TableWindowId) {
    const among: TableWindowId[] = []
    const slots: { left: number; width: number }[] = []
    const root =
      typeof document !== "undefined" ? document.querySelector("[data-testid=document-tray]") : null
    root?.querySelectorAll<HTMLElement>("[data-tray-id]").forEach((node) => {
      const tabId = node.getAttribute("data-tray-id") as TableWindowId | null
      if (!tabId || tabId === excludeId) return
      const rect = node.getBoundingClientRect()
      among.push(tabId)
      slots.push({ left: rect.left, width: rect.width })
    })
    return { among, slots }
  }

  function onTrayHover(over: boolean, clientX?: number) {
    setTrayDropActive(over)
    if (!over || clientX == null) {
      setTrayInsertIndex(null)
      return
    }
    const { slots } = measureTraySlots()
    setTrayInsertIndex(insertIndexAtClientX(clientX, slots))
  }

  function stowPaper(id: TableWindowId, clientX?: number) {
    setWindows((current) => stowWindow(current, id))
    setTrayDropActive(false)
    setTrayInsertIndex(null)
    if (clientX == null) return
    const { among, slots } = measureTraySlots(id)
    const index = insertIndexAtClientX(clientX, slots)
    setTrayOrder((current) => placeIdInOrder(current, id, index, among))
  }

  function onTrayRestore(id: TableWindowId) {
    const node = mapStageRef.current
    setWindows((current) => {
      const focused = focusWindow(current, id)
      const item = focused.find((entry) => entry.id === id)
      if (!node || !item) return focused
      const rect = node.getBoundingClientRect()
      const hint = TABLE_WINDOW_SIZE_HINTS[id]
      const size = { w: item.width ?? hint.w, h: item.height ?? hint.h }
      // Soft restore (Enter): keep x/size but lift above the tray so the grip is free.
      const preferred = restorePositionAboveTray(
        { x: item.x, y: item.y },
        size,
        { width: rect.width, height: rect.height },
      )
      return moveWindow(focused, id, preferred.x, preferred.y)
    })
  }

  function onTrayRestoreAt(id: TableWindowId, clientX: number, clientY: number) {
    const node = mapStageRef.current
    if (!node) {
      onTrayRestore(id)
      return
    }
    const rect = node.getBoundingClientRect()
    setWindows((current) => {
      const item = current.find((entry) => entry.id === id)
      const hint = TABLE_WINDOW_SIZE_HINTS[id]
      const size = { w: item?.width ?? hint.w, h: item?.height ?? hint.h }
      const preferred = restorePositionAboveTray(
        { x: clientX - rect.left - size.w / 2, y: clientY - rect.top - 24 },
        size,
        { width: rect.width, height: rect.height },
      )
      const focused = focusWindow(current, id)
      return moveWindow(focused, id, preferred.x, preferred.y)
    })
  }

  function onWindowSize(id: TableWindowId, size: { width: number; height: number }) {
    setWindows((current) => {
      const item = current.find((entry) => entry.id === id)
      if (item?.width === size.width && item?.height === size.height) return current
      return resizeWindow(current, id, { width: size.width, height: size.height })
    })
  }

  function onChipDrop(drop: ChipDrop) {
    if (finished) return
    setQueue(drop.queue)
    setHint(drop.reason)
  }

  function addArrow(fromId: string, toId: string, commitAll = false) {
    if (ordersLocked(Boolean(game.state.result))) return
    const from = game.state.provinces.find((province) => province.id === fromId)
    const to = game.state.provinces.find((province) => province.id === toId)
    if (!from || !to || fromId === toId) return
    setSelectedId(fromId)
    const verdict = previewMarch(game.state, queue, fromId, toId, { commitAll })
    if (!verdict.ok) {
      setHint(verdict.hover)
      return
    }
    setHint(verdict.warning)
    const { kind, unitIds } = verdict
    setQueue((current) => {
      if (current.some((order) => order.kind === kind && order.from === fromId && order.to === toId)) {
        return current
      }
      return [
        ...current,
        { id: crypto.randomUUID(), kind, from: fromId, to: toId, unitIds },
      ]
    })
  }

  function recruit(provinceId: string, unitKind: UnitKind) {
    if (ordersLocked(Boolean(game.state.result))) return
    setQueue((current) => {
      if (current.some((order) => order.kind === "recruit" && order.from === provinceId && order.unitKind === unitKind)) {
        return current
      }
      return [
        ...current,
        { id: crypto.randomUUID(), kind: "recruit", from: provinceId, unitIds: [], unitKind },
      ]
    })
    setHint(null)
  }

  function cancelRecruit(buildId: string) {
    if (ordersLocked(Boolean(game.state.result))) return
    setQueue((current) => {
      if (current.some((order) => order.kind === "cancelRecruit" && order.buildId === buildId)) return current
      return [
        ...current,
        { id: crypto.randomUUID(), kind: "cancelRecruit", from: "", unitIds: [], buildId },
      ]
    })
  }

  async function begin(nextDifficulty: Difficulty) {
    dispatchShell({ type: "BEGIN_PENDING" })
    setError(null)
    dispatchShell({ type: "CLEAR_STALE" })
    try {
      const response = await fetch("/api/new-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ difficulty: nextDifficulty }),
      })
      const raw = await response.text()
      let payload: { gameId?: string; state?: GameState; log?: TurnRecord[]; error?: string } = {}
      if (raw) {
        try {
          payload = JSON.parse(raw) as typeof payload
        } catch {
          payload = {}
        }
      }
      if (!response.ok || !payload.gameId || !payload.state) {
        throw new Error(
          response.ok
            ? "The server could not open a new campaign."
            : payload.error ?? "The server could not open a new campaign.",
        )
      }
      clearGame()
      setGame({
        version: 2,
        gameId: payload.gameId,
        state: payload.state,
        log: payload.log ?? [],
      })
      setQueue([])
      setFlash([])
      setLogIndex(null)
      setSelectedId(null)
      setOrderMode(false)
      setArmReset(false)
      dispatchShell({ type: "CLOSE_RESULT" })
      setSideTab("orders")
      setChatEpoch((value) => value + 1)
      dispatchShell({ type: "BEGIN_SUCCESS", gameId: payload.gameId })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The server could not open a new campaign.")
    } finally {
      dispatchShell({ type: "BEGIN_IDLE" })
    }
  }

  function fortify(provinceId: string) {
    if (ordersLocked(Boolean(game.state.result))) return
    const province = game.state.provinces.find((item) => item.id === provinceId)
    if (!province || province.controller !== "central") return
    setQueue((current) => {
      if (current.some((order) => order.kind === "fortify" && order.from === provinceId)) {
        return current
      }
      return [
        ...current,
        { id: crypto.randomUUID(), kind: "fortify", from: provinceId, unitIds: [] },
      ]
    })
    setHint(null)
  }

  const endTurn = useCallback(async () => {
    if (busy || ordersLocked(Boolean(game.state.result))) return
    dispatchShell({ type: "TURN_PENDING" })
    setError(null)
    const orders: PlayerOrder[] = queuedToPlayerOrders(queue)

    if (!game.gameId) {
      setError("Start a new campaign before you close a fortnight.")
      dispatchShell({ type: "TURN_BLOCKED_NO_GAME" })
      return
    }

    try {
      const response = await fetch("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId: game.gameId,
          expectedTurn: game.state.turn,
          orders,
        }),
        signal: AbortSignal.timeout(CLIENT_TURN_TIMEOUT_MS),
      })
      const raw = await response.text()
      let payload: { state?: GameState; record?: TurnRecord; error?: string; code?: string } = {}
      if (raw) {
        try {
          payload = JSON.parse(raw) as { state?: GameState; record?: TurnRecord }
        } catch {
          payload = {}
        }
      }
      // A non-2xx leaves the map and the queue untouched so the player can retry.
      if (!response.ok || !payload.state || !payload.record) {
        dispatchShell({
          type: "TURN_FAILURE",
          stale: payload.code === "stale_turn" || payload.code === "unknown_game",
        })
        throw new Error(
          payload.error ??
            (response.ok ? "The staff could not close the fortnight." : formatTurnFailure(response.status, raw)),
        )
      }
      const record = payload.record
      const prevState = game.state
      const events = selectNewsEvents(prevState, payload.state!, record)
      dispatchShell({ type: "TURN_SUCCESS" })
      setGame((current) => ({
        version: 2,
        gameId: current.gameId,
        state: payload.state!,
        log: [...current.log, record],
      }))
      if (events.length) setWindowOpen("log", false)
      setNewsQueue(events)
      setQueue([])
      setFlash(record.controlChanges.map((change) => change.provinceId))
      setLogIndex(null)
      setOrderMode(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The turn failed.")
      dispatchShell({ type: "TURN_FAILURE" })
    }
  }, [busy, game.gameId, game.state, queue])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault()
        if (newsQueue.length) return
        setWindowOpen("log", false)
        void endTurn()
      }
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [endTurn, newsQueue.length])

  function reset() {
    if (!armReset) {
      setArmReset(true)
      return
    }
    clearGame()
    dispatchShell({ type: "ENTER_SETUP" })
    setQueue([])
    setFlash([])
    setError(null)
    setLogIndex(null)
    setSelectedId(null)
    setArmReset(false)
    setSideTab("orders")
    setChatEpoch((value) => value + 1)
    setNewsQueue([])
    setCoachHighlightIds([])
    resetTableWindows()
  }

  const applyCoachHighlights = useCallback((highlights: CoachHighlight[]) => {
    setCoachHighlightIds(
      Array.from(
        new Set(highlights.map((item) => item.provinceId).filter((id): id is string => Boolean(id))),
      ),
    )
  }, [setCoachHighlightIds])

  const latest = game.log.at(-1)
  const fallback = !error && latest?.warning ? latest : null
  const windowOpenMap = {
    orders: isWindowOpen(windows, "orders"),
    province: isWindowOpen(windows, "province"),
    log: logOpen,
    legend: isWindowOpen(windows, "legend"),
    advisor: advisorOpen,
    ohl: ohlOpen,
  }

  const orderPanel = (
    <OrderPanel
      state={game.state}
      queue={queue}
      onQueue={setQueue}
      orderMode={orderMode && !finished}
      onOrderMode={(value) => {
        if (finished) return
        setOrderMode(value)
      }}
      hint={hint}
      busy={busy}
      onEndTurn={() => {
        if (newsQueue.length) return
        void endTurn()
      }}
      onSelect={selectProvince}
    />
  )

  const provincePanel = (
    <ProvincePanel
      state={game.state}
      province={selected}
      budget={budget}
      onSelect={selectProvince}
      onOrder={addArrow}
      onFortify={fortify}
      onRecruit={recruit}
      onCancelRecruit={cancelRecruit}
      queue={queue}
    />
  )

  if (setupOpen) {
    return (
      <CampaignStart
        difficulty={difficulty}
        onDifficulty={setDifficulty}
        beginBusy={beginBusy}
        onBegin={() => void begin(difficulty)}
      />
    )
  }

  const blockChrome = newsQueue.length > 0 || phase === "result"

  return (
    <>
    <div
      className="flex min-h-dvh flex-col bg-background lg:h-dvh lg:overflow-hidden"
      {...(blockChrome ? { inert: true } : {})}
    >
      <Hud
        state={game.state}
        armReset={armReset}
        onReset={reset}
        tableShell={desktopShell}
        refitSkipIds={[...attacking]}
      />
      {!desktopShell && ohlOpen && (
        <div
          className="flex items-start justify-between gap-3 border-b border-leather/35 bg-paper-deep px-3 py-2 sm:px-4"
          data-testid="ohl-orders-window"
        >
          <p data-testid="campaign-goal" className="text-xs font-medium leading-snug text-ink sm:text-sm">
            {campaignGoalLine(game.state.scenario)}
          </p>
          <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs" onClick={() => setWindowOpen("ohl", false)}>
            Close
          </Button>
        </div>
      )}
      {!desktopShell && !ohlOpen && (
        <div className="border-b border-leather/35 bg-paper px-3 py-1.5 sm:px-4">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-sm border-leather/40 bg-paper text-ink hover:bg-paper-deep"
            data-testid="ohl-toggle"
            onClick={() => setWindowOpen("ohl", true)}
          >
            Orders from OHL
          </Button>
        </div>
      )}
      {busy && (
        <p
          className="border-b border-leather/35 bg-paper-deep px-4 py-2 text-sm text-ink"
          role="status"
          data-testid="stavka-deliberating"
        >
          Stavka is deliberating…
        </p>
      )}
      {error && (
        <div
          className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
          role="alert"
          data-testid="turn-error"
        >
          <p>{error}</p>
          {staleCampaign && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2"
              data-testid="start-new-campaign"
              onClick={() => {
                setError(null)
                dispatchShell({ type: "CLEAR_STALE" })
                reset()
              }}
            >
              Start a new campaign
            </Button>
          )}
        </div>
      )}
      {!busy && fallback && (
        <div
          className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
          role="status"
          data-testid="gm-fallback"
        >
          <p>{fallback.warning}</p>
          {fallback.gmDebug && (
            <p className="mt-1 font-mono text-xs leading-5 break-words" data-testid="gm-debug-banner">
              {fallback.gmDebug}
            </p>
          )}
        </div>
      )}
      <div
        className={`grid min-h-0 flex-1 ${desktopShell ? "" : "lg:grid-cols-[minmax(0,1fr)_23rem]"}`}
        data-testid="game-shell"
      >
        <div
          ref={mapStageRef}
          className="relative min-h-0 min-h-[min(58dvh,100%)] flex-1 overflow-hidden"
        >
          <WarMap
            provinces={provinces}
            treasury={game.state.treasury}
            selectedId={selectedId}
            overlay={overlay}
            orders={queue}
            flashIds={flash}
            coachHighlightIds={coachHighlightIds}
            orderMode={orderMode && !finished}
            showMapLegend={!desktopShell}
            showRails={showRails}
            onShowRails={setShowRails}
            targetIds={
              mapTargets &&
              (mapTargets.canOrder
                ? mapTargets.move.length + mapTargets.attack.length > 0
                : mapTargets.reach.move.length + mapTargets.reach.attack.length > 0)
                ? {
                    move: mapTargets.canOrder ? mapTargets.move : mapTargets.reach.move,
                    attack: mapTargets.canOrder ? mapTargets.attack : mapTargets.reach.attack,
                    canOrder: mapTargets.canOrder,
                  }
                : undefined
            }
            targetHoverNote={
              mapTargets
                ? (id, base) => {
                    const extra = mapProvinceHoverNote(mapTargets, id)
                    return extra ? `${base}\n${extra}` : base
                  }
                : undefined
            }
            onSelect={selectProvince}
            onDraw={addArrow}
            onChipDrop={finished ? undefined : onChipDrop}
            onOverlay={setOverlay}
          />
          <ChronicleDrawer
            open={logOpen}
            onOpen={(open) => setWindowOpen("log", open)}
            log={game.log}
            active={game.log.length ? activeLog : 0}
            onActive={setLogIndex}
            phase={phase}
            newsCardsActive={newsQueue.length > 0}
            mapCorner={!desktopShell}
          />
          {desktopShell &&
            windows.map((win) => {
              // Keep Chief of Staff mounted while filed so drafts/suggestions survive.
              if (!win.open && win.id !== "advisor") return null
              const focus = () => setWindows((current) => focusWindow(current, win.id))
              const stow = () => setWindowOpen(win.id, false)
              const stowAt = (clientX?: number) => stowPaper(win.id, clientX)
              const onMove = (x: number, y: number) =>
                setWindows((current) => moveWindow(current, win.id, x, y))
              const onSize = (size: { width: number; height: number }) => onWindowSize(win.id, size)
              const paperProps = {
                widthPx: win.width,
                heightPx: win.height,
                onSize,
                onStow: stowAt,
                onTrayHover,
              }
              if (win.id === "ohl") {
                return (
                  <OhlOrdersWindow
                    key={win.id}
                    scenario={game.state.scenario}
                    open={win.open}
                    x={win.x}
                    y={win.y}
                    z={win.z}
                    widthPx={win.width}
                    heightPx={win.height}
                    onFocus={focus}
                    onClose={stow}
                    onMove={onMove}
                    onSize={onSize}
                    onStow={stowAt}
                    onTrayHover={onTrayHover}
                  />
                )
              }
              if (win.id === "orders") {
                return (
                  <FloatingWindow
                    key={win.id}
                    title={TABLE_WINDOW_TITLES.orders}
                    open={win.open}
                    x={win.x}
                    y={win.y}
                    z={win.z}
                    maxHeightClassName="max-h-[min(70dvh,36rem)]"
                    testId="orders-window"
                    onFocus={focus}
                    onClose={stow}
                    onMove={onMove}
                    {...paperProps}
                  >
                    <aside className="flex min-h-0 flex-col">{orderPanel}</aside>
                  </FloatingWindow>
                )
              }
              if (win.id === "province") {
                return (
                  <FloatingWindow
                    key={win.id}
                    title={TABLE_WINDOW_TITLES.province}
                    open={win.open}
                    x={win.x}
                    y={win.y}
                    z={win.z}
                    maxHeightClassName="max-h-[min(70dvh,36rem)]"
                    testId="province-window"
                    onFocus={focus}
                    onClose={stow}
                    onMove={onMove}
                    {...paperProps}
                  >
                    <aside className="flex min-h-0 flex-col">{provincePanel}</aside>
                  </FloatingWindow>
                )
              }
              if (win.id === "log") {
                return (
                  <FloatingWindow
                    key={win.id}
                    title={TABLE_WINDOW_TITLES.log}
                    open={win.open}
                    x={win.x}
                    y={win.y}
                    z={win.z}
                    widthClassName="w-[min(24rem,calc(100%-1.5rem))]"
                    maxHeightClassName="max-h-[min(50dvh,24rem)]"
                    testId="chronicle-drawer"
                    onFocus={focus}
                    onClose={stow}
                    onMove={onMove}
                    {...paperProps}
                  >
                    <div className="min-h-0" data-testid="mobile-chronicle-panel">
                      <TimelinePanel
                        log={game.log}
                        active={game.log.length ? activeLog : 0}
                        onActive={setLogIndex}
                        phase={phase}
                        variant="drawer"
                      />
                    </div>
                  </FloatingWindow>
                )
              }
              if (win.id === "legend") {
                return (
                  <FloatingWindow
                    key={win.id}
                    title={TABLE_WINDOW_TITLES.legend}
                    open={win.open}
                    x={win.x}
                    y={win.y}
                    z={win.z}
                    widthClassName="w-[min(18rem,calc(100%-1.5rem))]"
                    maxHeightClassName="max-h-[min(60dvh,28rem)]"
                    testId="legend-window"
                    onFocus={focus}
                    onClose={stow}
                    onMove={onMove}
                    {...paperProps}
                  >
                    <MapLegend
                      embedded
                      showRails={showRails}
                      onToggleRails={() => setShowRails((value) => !value)}
                      overlay={overlay}
                    />
                  </FloatingWindow>
                )
              }
              if (win.id === "advisor") {
                return (
                  <FloatingWindow
                    key={win.id}
                    title={TABLE_WINDOW_TITLES.advisor}
                    open={win.open}
                    keepMounted
                    x={win.x}
                    y={win.y}
                    z={win.z}
                    widthClassName="w-[min(24rem,calc(100%-1.5rem))]"
                    maxHeightClassName="max-h-[min(70dvh,32rem)]"
                    onFocus={focus}
                    onClose={stow}
                    onMove={onMove}
                    {...paperProps}
                  >
                    <AdvisorPanel
                      open={win.open}
                      embedded
                      gameId={game.gameId}
                      state={game.state}
                      queue={queue}
                      selectedProvinceId={selectedId}
                      closed={finished}
                      epoch={chatEpoch}
                      onClose={stow}
                      onHighlights={applyCoachHighlights}
                    />
                  </FloatingWindow>
                )
              }
              return null
            })}
          {desktopShell && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[30]">
              <DocumentTray
                items={orderedCampaignTrayItems}
                openById={windowOpenMap}
                onRestore={onTrayRestore}
                onRestoreAt={onTrayRestoreAt}
                dropHighlight={trayDropActive}
                insertIndex={trayInsertIndex}
                trayOrder={trayOrder}
                onTrayOrderChange={setTrayOrder}
              />
            </div>
          )}
          {phase === "map" && (
            <div className="pointer-events-none absolute top-3 right-32 left-3 z-30 flex justify-center">
              <div
                className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-sm border border-leather/50 bg-paper/95 px-3 py-2 text-ink shadow-[0_10px_24px_rgba(36,28,20,0.22)]"
                data-testid="finale-banner"
                role="status"
              >
                <p className="text-sm" data-testid="finale-summary">
                  <span className="tracking-wide text-primary uppercase">{FINAL_POSITIONS_LABEL}</span>
                  <span className="mx-2 text-muted-foreground">·</span>
                  <span className="font-display text-lg leading-none">{game.state.date}</span>
                </p>
                <Button
                  type="button"
                  size="sm"
                  data-testid="see-result"
                  onClick={() => dispatchShell({ type: "OPEN_RESULT" })}
                >
                  {SEE_RESULT_LABEL}
                </Button>
              </div>
            </div>
          )}
        </div>
        {!desktopShell && (
          <aside className="flex min-h-[28rem] flex-col border-t border-border lg:min-h-0 lg:border-t-0 lg:border-l">
            <Tabs value={sideTab} className="flex min-h-0 flex-1 flex-col gap-0">
              <DocumentTray
                variant="phone"
                items={orderedCampaignPhoneTrayItems}
                openById={{
                  orders: sideTab === "orders",
                  province: sideTab === "front",
                  advisor: sideTab === "advisor",
                }}
                activeId={
                  sideTab === "front" ? "province" : sideTab === "advisor" ? "advisor" : "orders"
                }
                trayOrder={trayOrder}
                onRestore={(id) => {
                  if (id === "province") {
                    setSideTab("front")
                    setWindowOpen("advisor", false)
                  } else if (id === "advisor") {
                    setSideTab("advisor")
                    setWindowOpen("advisor", true)
                  } else {
                    setSideTab("orders")
                    setWindowOpen("advisor", false)
                  }
                }}
                className="order-last shrink-0 lg:order-none"
              />
              <TabsContent value="orders" className="min-h-0 flex-1 overflow-y-auto">
                {orderPanel}
              </TabsContent>
              <TabsContent value="front" className="min-h-0 flex-1 overflow-y-auto">
                {provincePanel}
              </TabsContent>
              <TabsContent value="advisor" keepMounted className="min-h-0 flex-1 overflow-hidden">
                <AdvisorPanel
                  open={sideTab === "advisor"}
                  embedded
                  gameId={game.gameId}
                  state={game.state}
                  queue={queue}
                  selectedProvinceId={selectedId}
                  closed={finished}
                  epoch={chatEpoch}
                  onClose={() => {
                    setSideTab("orders")
                    setWindowOpen("advisor", false)
                  }}
                  onHighlights={applyCoachHighlights}
                />
              </TabsContent>
            </Tabs>
          </aside>
        )}
      </div>
      {newsQueue.length > 0 && (
        <NewsCardQueue
          key={newsQueue.map((event) => event.id).join(":")}
          events={newsQueue}
          onDone={() => setNewsQueue([])}
        />
      )}
    </div>
    {phase === "result" && game.state.result && (
      <EndgameModal
        state={game.state}
        result={game.state.result}
        onBackToMap={() => dispatchShell({ type: "CLOSE_RESULT" })}
        onPlayAgain={() => {
          dispatchShell({ type: "CLOSE_RESULT" })
          dispatchShell({ type: "ENTER_SETUP" })
        }}
      />
    )}
    </>
  )
}
