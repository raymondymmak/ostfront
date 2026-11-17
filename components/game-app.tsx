"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AdvisorPanel } from "@/components/advisor-panel"
import { Hud } from "@/components/hud"
import { OrderPanel } from "@/components/order-panel"
import { ProvincePanel } from "@/components/province-panel"
import { ChronicleDrawer } from "@/components/chronicle-drawer"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { legalTargetHoverNote, legalTargets } from "@/lib/ui/legal-targets"
import { selectNewsEvents } from "@/lib/news/select"
import type { NewsEvent } from "@/lib/news/types"
import { clearGame, freshGame, loadGame, saveGame } from "@/lib/storage"
import type { Difficulty, GameState, PlayerOrder, SaveGame, TurnRecord, UnitKind } from "@/lib/types"
import { WarMap, type MapProvince } from "@/components/war-map"

export function GameApp() {
  const [game, setGame] = useState<SaveGame>(() => loadGame() ?? freshGame())
  const [setupOpen, setSetupOpen] = useState(() => loadGame() === null)
  const [difficulty, setDifficulty] = useState<Difficulty>("normal")
  const [selectedId, setSelectedId] = useState("krakow")
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
  const [advisorOpen, setAdvisorOpen] = useState(false)
  const [sideTab, setSideTab] = useState("orders")
  const [chatEpoch, setChatEpoch] = useState(0)
  const [newsQueue, setNewsQueue] = useState<NewsEvent[]>([])
  const [logOpen, setLogOpen] = useState(false)

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
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(`/api/game?gameId=${encodeURIComponent(gameId)}`)
        if (!response.ok || cancelled) return
        const payload = (await response.json()) as SaveGame & { gameId: string }
        if (!payload.state || cancelled) return
        setGame({
          version: 2,
          gameId: payload.gameId,
          state: payload.state,
          log: payload.log ?? [],
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
    if (finished || !selected || selected.controller !== "central") return null
    return legalTargets(game.state, selected.id, queue)
  }, [finished, selected, game.state, queue])

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
      setAdvisorOpen(false)
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
        void endTurn()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [endTurn])

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
    setAdvisorOpen(false)
    setSideTab("orders")
    setChatEpoch((value) => value + 1)
    setNewsQueue([])
    setLogOpen(false)
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
    return { ok: true }
  }

  const latest = game.log.at(-1)
  const fallback = !error && latest?.warning ? latest : null

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
        onAdvisor={() => setAdvisorOpen((value) => !value)}
      />
      {busy && (
        <p
          className="border-b border-border bg-muted px-4 py-2 text-sm"
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
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="relative min-h-0 flex-1 overflow-hidden min-h-[min(58dvh,100%)]">
          <WarMap
            provinces={provinces}
            selectedId={selectedId}
            overlay={overlay}
            orders={queue}
            flashIds={flash}
            orderMode={orderMode && !finished}
            targetIds={
              mapTargets && (mapTargets.move.length || mapTargets.attack.length)
                ? { move: mapTargets.move, attack: mapTargets.attack }
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
            onSelect={setSelectedId}
            onDraw={addArrow}
            onOverlay={setOverlay}
          />
          <AdvisorPanel
            open={advisorOpen}
            state={game.state}
            queue={queue}
            closed={finished}
            epoch={chatEpoch}
            onClose={() => setAdvisorOpen(false)}
            onAccept={acceptAdvisorOrders}
          />
          <ChronicleDrawer
            open={logOpen}
            onOpen={setLogOpen}
            log={game.log}
            active={game.log.length ? activeLog : 0}
            onActive={setLogIndex}
            phase={phase}
          />
          {phase === "map" && (
            <div className="pointer-events-none absolute top-3 right-32 left-3 z-30 flex justify-center">
              <div
                className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-lg border border-[#c6a15a]/45 bg-[#241c14]/92 px-3 py-2 text-[#f3e2a8] shadow-lg"
                data-testid="finale-banner"
                role="status"
              >
                <p className="text-sm" data-testid="finale-summary">
                  <span className="tracking-wide text-[#c6a15a] uppercase">{FINAL_POSITIONS_LABEL}</span>
                  <span className="mx-2 text-[#f3e2a8]/70">·</span>
                  <span className="font-display text-lg leading-none">{game.state.date}</span>
                </p>
                <Button type="button" size="sm" data-testid="see-result" onClick={() => setResultOpen(true)}>
                  {SEE_RESULT_LABEL}
                </Button>
              </div>
            </div>
          )}
        </div>
        <aside className="flex min-h-[28rem] flex-col border-t border-border lg:min-h-0 lg:border-t-0 lg:border-l">
          <Tabs
            value={sideTab}
            onValueChange={(value) => {
              if (typeof value === "string") setSideTab(value)
            }}
            className="min-h-0 flex-1 gap-0"
          >
            <TabsList className="mx-3 mt-3 w-[calc(100%-1.5rem)]">
              <TabsTrigger value="orders" data-testid="tab-orders">
                Orders
              </TabsTrigger>
              <TabsTrigger value="front" data-testid="tab-province">
                Province
              </TabsTrigger>
            </TabsList>
            <TabsContent value="orders" className="min-h-0 flex-1">
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
                onEndTurn={() => void endTurn()}
                onSelect={setSelectedId}
              />
            </TabsContent>
            <TabsContent value="front" className="min-h-0 flex-1">
              <ProvincePanel
                state={game.state}
                province={selected}
                budget={budget}
                onSelect={setSelectedId}
                onOrder={addArrow}
                onFortify={fortify}
                onRecruit={recruit}
                onCancelRecruit={cancelRecruit}
                queue={queue}
              />
            </TabsContent>
          </Tabs>
        </aside>
      </div>
      {phase === "result" && game.state.result && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-background/80 p-4"
          data-testid="endgame"
          role="dialog"
          aria-modal="true"
          aria-labelledby="endgame-title"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg">
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
