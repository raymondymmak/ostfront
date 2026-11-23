"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
  CAMPAIGN_TRAY_ITEMS,
  loadWindowSession,
  saveWindowSession,
  stowTopmostWindow,
  stowWindow,
} from "@/lib/ui/document-tray"
import { CATALOG_BY_ID } from "@/lib/data/catalog"
import { CampaignStart } from "@/components/campaign-start"
import { NewsCardQueue } from "@/components/news-card"
import { objectiveValue, scenarioSpec } from "@/lib/data/objectives"
import { independentFormations } from "@/lib/engine/echelon"
import { RECRUIT, spendable } from "@/lib/engine/economy"
import { gradeLabel } from "@/lib/engine/victory"
import {
  BACK_TO_MAP_LABEL,
  FINAL_POSITIONS_LABEL,
  SEE_RESULT_LABEL,
  finalePhase,
  ordersLocked,
} from "@/lib/finale"
import type { AdvisorOrder } from "@/lib/gm/advisor-types"
import { CLIENT_TURN_TIMEOUT_MS } from "@/lib/gm/timeouts"
import { formatTurnFailure } from "@/lib/turn-failure"
import { applyAdvisorToQueue, leaveDepotGarrison, queuedToPlayerOrders, type QueuedOrder } from "@/lib/orders"
import { campaignGoalLine } from "@/lib/ui/goal-copy"
import { legalTargetHoverNote, legalTargets } from "@/lib/ui/legal-targets"
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
import { clearGame, freshGame, loadGame, saveGame } from "@/lib/storage"
import type { Difficulty, GameState, PlayerOrder, SaveGame, TurnRecord, UnitKind } from "@/lib/types"
import { WarMap, type MapProvince } from "@/components/war-map"

export function GameApp() {
  const [game, setGame] = useState<SaveGame>(() => loadGame() ?? freshGame())
  const [setupOpen, setSetupOpen] = useState(() => loadGame() === null)
  const [difficulty, setDifficulty] = useState<Difficulty>("normal")
  const [selectedId, setSelectedId] = useState<string | null>("krakow")
  const [overlay, setOverlay] = useState<"none" | "supply" | "unrest">("none")
  const [orderMode, setOrderMode] = useState(false)
  const [directive, setDirective] = useState("")
  const [queue, setQueue] = useState<QueuedOrder[]>([])
  const [busy, setBusy] = useState(false)
  const [beginBusy, setBeginBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [staleCampaign, setStaleCampaign] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [flash, setFlash] = useState<string[]>([])
  const [logIndex, setLogIndex] = useState<number | null>(null)
  const [armReset, setArmReset] = useState(false)
  const [resultOpen, setResultOpen] = useState(false)
  const [sideTab, setSideTab] = useState("orders")
  const [chatEpoch, setChatEpoch] = useState(0)
  const [newsQueue, setNewsQueue] = useState<NewsEvent[]>([])
  const [windows, setWindows] = useState<TableWindowState[]>(() => createDefaultTableWindows())
  const [trayDropActive, setTrayDropActive] = useState(false)
  const [showRails, setShowRails] = useState(true)
  const desktopShell = useDesktopShell()
  const mapStageRef = useRef<HTMLDivElement>(null)
  const advisorOpen = isWindowOpen(windows, "advisor")
  const logOpen = isWindowOpen(windows, "log")
  const ohlOpen = isWindowOpen(windows, "ohl")

  useEffect(() => {
    if (!setupOpen && game.gameId) saveGame(game)
  }, [game, setupOpen])

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
        setSetupOpen(false)
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
  }, [])

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
    setWindows(applyPersistedLayout(defaults, loadWindowSession("campaign")))
  }

  useEffect(() => {
    if (setupOpen) return
    const frame = window.requestAnimationFrame(() => resetTableWindows())
    return () => window.cancelAnimationFrame(frame)
  }, [setupOpen, desktopShell])

  useEffect(() => {
    if (setupOpen || !desktopShell) return
    saveWindowSession("campaign", windows)
  }, [windows, setupOpen, desktopShell])

  function setWindowOpen(id: TableWindowId, open: boolean) {
    setWindows((current) => (open ? focusWindow(current, id) : stowWindow(current, id)))
  }

  function onTrayRestore(id: TableWindowId) {
    setWindows((current) => focusWindow(current, id))
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

  function onToggleTableWindow(id: TableWindowId) {
    // Tray tabs / Escape restore or file papers — not show/hide toggles.
    setWindows((current) => focusWindow(current, id))
  }

  function addArrow(fromId: string, toId: string, commitAll = false) {
    if (ordersLocked(Boolean(game.state.result))) return
    const from = game.state.provinces.find((province) => province.id === fromId)
    const to = game.state.provinces.find((province) => province.id === toId)
    if (!from || !to || fromId === toId) return
    setSelectedId(fromId)
    if (from.controller !== "central") {
      setHint("Stavka does not take your arrows. Start in a Central Powers province.")
      return
    }
    const claimed = new Set(
      queue.flatMap((order) => (order.kind === "fortify" ? [] : order.unitIds)),
    )
    const available = independentFormations(
      from.units.filter((unit) => unit.faction === "central" && !claimed.has(unit.id)),
    )
    if (!available.length) {
      setHint(`${from.name} has no unassigned formation.`)
      return
    }
    const kind = to.controller === "central" ? "move" : "attack"
    const chosen = leaveDepotGarrison(available, from.depot === "central", commitAll)
    const targets = legalTargets(game.state, fromId, queue)
    setHint(legalTargetHoverNote(targets, toId))
    setQueue((current) => {
      if (current.some((order) => order.kind === kind && order.from === fromId && order.to === toId)) {
        return current
      }
      return [
        ...current,
        {
          id: crypto.randomUUID(),
          kind,
          from: fromId,
          to: toId,
          unitIds: chosen.map((unit) => unit.id),
        },
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
    setBeginBusy(true)
    setError(null)
    setStaleCampaign(false)
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
      setDirective("")
      setFlash([])
      setLogIndex(null)
      setSelectedId("krakow")
      setOrderMode(false)
      setArmReset(false)
      setResultOpen(false)
      setSideTab("orders")
      setChatEpoch((value) => value + 1)
      setSetupOpen(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The server could not open a new campaign.")
    } finally {
      setBeginBusy(false)
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
    setBusy(true)
    setError(null)
    const orders: PlayerOrder[] = queuedToPlayerOrders(queue)
    if (directive.trim()) orders.push({ type: "text", text: directive.trim() })

    if (!game.gameId) {
      setError("Start a new campaign before you close a fortnight.")
      setStaleCampaign(true)
      setBusy(false)
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
        if (payload.code === "stale_turn" || payload.code === "unknown_game") {
          setStaleCampaign(true)
        }
        throw new Error(
          payload.error ??
            (response.ok ? "The staff could not close the fortnight." : formatTurnFailure(response.status, raw)),
        )
      }
      const record = payload.record
      const prevState = game.state
      const events = selectNewsEvents(prevState, payload.state!, record)
      setStaleCampaign(false)
      setGame((current) => ({
        version: 2,
        gameId: current.gameId,
        state: payload.state!,
        log: [...current.log, record],
      }))
      if (events.length) setWindowOpen("log", false)
      setNewsQueue(events)
      setQueue([])
      setDirective("")
      setFlash(record.controlChanges.map((change) => change.provinceId))
      setLogIndex(null)
      setOrderMode(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The turn failed.")
    } finally {
      setBusy(false)
    }
  }, [busy, directive, game.gameId, game.state, queue])

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
    setSetupOpen(true)
    setQueue([])
    setDirective("")
    setFlash([])
    setError(null)
    setLogIndex(null)
    setSelectedId("krakow")
    setArmReset(false)
    setSideTab("orders")
    setChatEpoch((value) => value + 1)
    setNewsQueue([])
    resetTableWindows()
  }

  function acceptAdvisorOrders(
    orders: AdvisorOrder[],
    mode: "accept" | "override",
  ): { ok: boolean; reason?: string } {
    if (ordersLocked(Boolean(game.state.result))) {
      const reason = "Orders are closed. Nothing was filed."
      setHint(reason)
      return { ok: false, reason }
    }
    const filed = applyAdvisorToQueue(game.state, queue, orders, mode)
    if (!filed.accepted) {
      const reason = filed.reason ?? "Nothing was filed."
      setHint(reason)
      return { ok: false, reason }
    }
    setQueue(filed.queue)
    setHint(
      mode === "override"
        ? "Replaced the queued order. The engine resolves it when the fortnight closes."
        : "Filed in the queue. The engine resolves it when the fortnight closes.",
    )
    setSideTab("orders")
    if (desktopShell) setWindowOpen("orders", true)
    return { ok: true }
  }

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
      directive={directive}
      onDirective={setDirective}
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

  return (
    <div className="flex min-h-dvh flex-col bg-background lg:h-dvh lg:overflow-hidden">
      <Hud
        state={game.state}
        armReset={armReset}
        onReset={reset}
        advisorOpen={advisorOpen}
        onAdvisor={() => onToggleTableWindow("advisor")}
        tableShell={desktopShell}
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
                setStaleCampaign(false)
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
        {...(newsQueue.length > 0 ? { inert: true } : {})}
        data-testid="game-shell"
      >
        <div
          ref={mapStageRef}
          className="relative min-h-0 min-h-[min(58dvh,100%)] flex-1 overflow-hidden"
        >
          <WarMap
            provinces={provinces}
            selectedId={selectedId}
            overlay={overlay}
            orders={queue}
            flashIds={flash}
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
                    const extra = legalTargetHoverNote(mapTargets, id)
                    return extra ? `${base}\n${extra}` : base
                  }
                : undefined
            }
            onSelect={selectProvince}
            onDraw={addArrow}
            onOverlay={setOverlay}
          />
          {!desktopShell && (
            <AdvisorPanel
              open={advisorOpen}
              state={game.state}
              queue={queue}
              closed={finished}
              epoch={chatEpoch}
              onClose={() => setWindowOpen("advisor", false)}
              onAccept={acceptAdvisorOrders}
            />
          )}
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
              if (!win.open) return null
              const focus = () => setWindows((current) => focusWindow(current, win.id))
              const stow = () => setWindowOpen(win.id, false)
              const onMove = (x: number, y: number) =>
                setWindows((current) => moveWindow(current, win.id, x, y))
              const onSize = (size: { width: number; height: number }) => onWindowSize(win.id, size)
              const paperProps = {
                widthPx: win.width,
                heightPx: win.height,
                onSize,
                onStow: stow,
                onTrayHover: setTrayDropActive,
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
                    onStow={stow}
                    onTrayHover={setTrayDropActive}
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
                      open
                      embedded
                      state={game.state}
                      queue={queue}
                      closed={finished}
                      epoch={chatEpoch}
                      onClose={stow}
                      onAccept={acceptAdvisorOrders}
                    />
                  </FloatingWindow>
                )
              }
              return null
            })}
          {desktopShell && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[40]">
              <DocumentTray
                items={CAMPAIGN_TRAY_ITEMS}
                openById={windowOpenMap}
                onRestore={onTrayRestore}
                onRestoreAt={onTrayRestoreAt}
                dropHighlight={trayDropActive}
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
                <Button type="button" size="sm" data-testid="see-result" onClick={() => setResultOpen(true)}>
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
                items={[
                  { id: "orders", label: "Orders", testId: "tab-orders" },
                  { id: "province", label: "Province", testId: "tab-province" },
                ]}
                openById={{ orders: sideTab === "orders", province: sideTab === "front" }}
                activeId={sideTab === "front" ? "province" : "orders"}
                onRestore={(id) => setSideTab(id === "province" ? "front" : "orders")}
                className="order-last shrink-0 lg:order-none"
              />
              <TabsContent value="orders" className="min-h-0 flex-1 overflow-y-auto">
                {orderPanel}
              </TabsContent>
              <TabsContent value="front" className="min-h-0 flex-1 overflow-y-auto">
                {provincePanel}
              </TabsContent>
            </Tabs>
          </aside>
        )}
      </div>
      {phase === "result" && game.state.result && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-leather/45 p-4 backdrop-blur-[1px]"
          data-testid="endgame"
          role="dialog"
          aria-modal="true"
          aria-labelledby="endgame-title"
        >
          <div className="w-full max-w-md rounded-sm border border-leather/50 bg-paper p-6 text-ink shadow-[0_18px_40px_rgba(36,28,20,0.35)]">
            <p className="text-xs tracking-wide text-muted-foreground uppercase">
              {game.state.result.sudden ? "Sudden death" : "Campaign over"}
            </p>
            <h2 id="endgame-title" className="mt-2 font-display text-4xl leading-none">
              {gradeLabel(game.state.result.grade)}
            </h2>
            <p className="mt-3 text-sm leading-6">{game.state.result.reason}</p>
            <p className="mt-3 text-sm text-muted-foreground">
              {game.state.date} · Fortnight {Math.min(game.state.turn + 1, scenarioSpec(game.state.scenario).length)} / {scenarioSpec(game.state.scenario).length}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Score {game.state.result.score} · ★ {game.state.result.captured}/{game.state.result.available} victory points
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button type="button" variant="outline" data-testid="back-to-map" onClick={() => setResultOpen(false)}>
                {BACK_TO_MAP_LABEL}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setResultOpen(false)
                  setSetupOpen(true)
                }}
              >
                Play again
              </Button>
            </div>
          </div>
        </div>
      )}
      {newsQueue.length > 0 && (
        <NewsCardQueue
          key={newsQueue.map((event) => event.id).join(":")}
          events={newsQueue}
          onDone={() => setNewsQueue([])}
        />
      )}
    </div>
  )
}
