"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AdvisorPanel } from "@/components/advisor-panel"
import { Hud } from "@/components/hud"
import { OrderPanel } from "@/components/order-panel"
import { ProvincePanel } from "@/components/province-panel"
import { TimelinePanel } from "@/components/timeline-panel"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CATALOG_BY_ID } from "@/lib/data/catalog"
import { BRIEFING } from "@/lib/data/scenario"
import { objectiveValue, scenarioSpec } from "@/lib/data/objectives"
import { independentFormations, partyOf } from "@/lib/engine/echelon"
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
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [flash, setFlash] = useState<string[]>([])
  const [logIndex, setLogIndex] = useState<number | null>(null)
  const [armReset, setArmReset] = useState(false)
  const [resultOpen, setResultOpen] = useState(false)
  const [advisorOpen, setAdvisorOpen] = useState(false)
  const [sideTab, setSideTab] = useState("orders")
  const [chatEpoch, setChatEpoch] = useState(0)

  useEffect(() => {
    if (!setupOpen) saveGame(game)
  }, [game, setupOpen])

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
    const departing = new Set(partyOf(from.units, chosen.map((unit) => unit.id)).map((unit) => unit.id))
    const remaining = independentFormations(
      from.units.filter((unit) => unit.faction === "central" && !departing.has(unit.id) && !claimed.has(unit.id)),
    )
    if (!from.neighbors.includes(toId)) {
      setHint(
        `${from.name} and ${to.name} do not share a border. The engine will reject the order so you can see why.`,
      )
    } else if (from.supply < 30) {
      setHint(`${from.name} is below supply 30. The engine will refuse the advance.`)
    } else if (from.depot === "central" && remaining.length === 0) {
      setHint(`This arrow empties the ${from.name} depot. Leave a garrison unless you mean to abandon it.`)
    } else {
      setHint(null)
    }
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

  function begin(nextDifficulty: Difficulty) {
    clearGame()
    setGame(freshGame("gorlice", nextDifficulty))
    setQueue([])
    setDirective("")
    setFlash([])
    setError(null)
    setLogIndex(null)
    setSelectedId("krakow")
    setOrderMode(false)
    setArmReset(false)
    setResultOpen(false)
    setAdvisorOpen(false)
    setSideTab("orders")
    setChatEpoch((value) => value + 1)
    setSetupOpen(false)
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

    try {
      const response = await fetch("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: game.state, orders }),
        signal: AbortSignal.timeout(CLIENT_TURN_TIMEOUT_MS),
      })
      const raw = await response.text()
      let payload: { state?: GameState; record?: TurnRecord } = {}
      if (raw) {
        try {
          payload = JSON.parse(raw) as { state?: GameState; record?: TurnRecord }
        } catch {
          payload = {}
        }
      }
      // A non-2xx leaves the map and the queue untouched so the player can retry.
      if (!response.ok || !payload.state || !payload.record) {
        throw new Error(
          response.ok ? "The staff could not close the fortnight." : formatTurnFailure(response.status, raw),
        )
      }
      const record = payload.record
      setGame((current) => ({
        version: 2,
        state: payload.state!,
        log: [...current.log, record],
      }))
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
  }, [busy, directive, game.state, queue])

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
  }

  function acceptAdvisorOrders(
    orders: AdvisorOrder[],
    mode: "accept" | "override",
  ): { ok: boolean; reason?: string } {
    if (ordersLocked(Boolean(game.state.result))) {
      return { ok: false, reason: "Orders are closed. Nothing was filed." }
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
        <p
          className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
          role="alert"
          data-testid="turn-error"
        >
          {error}
        </p>
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
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_23rem] lg:grid-rows-[minmax(0,1fr)_16.5rem]">
        <div className="relative isolate z-0 h-[58vh] min-h-[320px] overflow-hidden lg:h-full lg:min-h-0">
          <WarMap
            provinces={provinces}
            selectedId={selectedId}
            overlay={overlay}
            orders={queue}
            flashIds={flash}
            orderMode={orderMode && !finished}
            onSelect={setSelectedId}
            onDraw={addArrow}
            onOverlay={setOverlay}
          />
          <AdvisorPanel
            open={advisorOpen && !setupOpen}
            state={game.state}
            queue={queue}
            closed={finished}
            epoch={chatEpoch}
            onClose={() => setAdvisorOpen(false)}
            onAccept={acceptAdvisorOrders}
          />
          {phase === "map" && !setupOpen && (
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
        <aside className="flex min-h-[28rem] flex-col border-t border-border lg:row-span-2 lg:min-h-0 lg:border-t-0 lg:border-l">
          <Tabs
            value={sideTab}
            onValueChange={(value) => {
              if (typeof value === "string") setSideTab(value)
            }}
            className="min-h-0 flex-1 gap-0"
          >
            <TabsList className="mx-3 mt-3 w-[calc(100%-1.5rem)]">
              <TabsTrigger value="orders">Orders</TabsTrigger>
              <TabsTrigger value="front">Province</TabsTrigger>
              <TabsTrigger value="chronicle" className="lg:hidden">
                Chronicle
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
            <TabsContent value="chronicle" className="min-h-0 flex-1 lg:hidden">
            <TimelinePanel
              log={game.log}
              active={game.log.length ? activeLog : 0}
              onActive={setLogIndex}
              briefing={BRIEFING}
              phase={phase}
            />
          </TabsContent>
          </Tabs>
        </aside>
        <section className="relative z-10 hidden min-h-0 overflow-hidden border-t border-border bg-background lg:block">
          <div className="absolute inset-0 flex min-h-0 flex-col">
            <TimelinePanel
              log={game.log}
              active={game.log.length ? activeLog : 0}
              onActive={setLogIndex}
              briefing={BRIEFING}
              phase={phase}
            />
          </div>
        </section>
      </div>
      {phase === "result" && game.state.result && !setupOpen && (
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
      {setupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 p-4" data-testid="scenario-picker">
          <div className="flex w-full max-w-xl flex-col gap-4 rounded-lg border border-border bg-background p-6 shadow-lg">
            <div>
              <p className="text-xs tracking-wide text-muted-foreground uppercase">Eastern Front, 1915</p>
              <p className="mt-1 font-display text-3xl leading-none">Gorlice–Tarnów</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Nothing happens while you are away. Both sides lock their orders, and the fortnight closes together.
              </p>
            </div>
            <div className="rounded-lg border border-primary bg-primary/10 p-3" data-testid="scenario-gorlice">
              <span className="font-display text-xl leading-none">2 May – 11 July</span>
              <span className="mt-2 block text-sm text-muted-foreground">
                Six fortnights. Mackensen&apos;s 11th Army and the Austro-Hungarian 4th Army break Radko Dimitriev&apos;s 3rd Army at Lemberg. The pursuit is Lublin and Rovno. Hold Kraków.
              </span>
            </div>
            <div className="flex flex-wrap gap-2" data-testid="difficulty">
              {(
                [
                  ["easy", "Easy", "Thinner Russian corps, Stavka stays cautious"],
                  ["normal", "Normal", "The 2 May line, and a real breakthrough"],
                  ["hard", "Hard", "Fuller Russian corps, and Stavka hits back"],
                ] as const
              ).map(([id, title, copy]) => (
                <button
                  key={id}
                  type="button"
                  data-testid={`difficulty-${id}`}
                  onClick={() => setDifficulty(id)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm ${difficulty === id ? "border-primary bg-primary/10" : "border-border"}`}
                >
                  <span className="block font-medium">{title}</span>
                  <span className="text-muted-foreground">{copy}</span>
                </button>
              ))}
            </div>
            <Button type="button" data-testid="begin-scenario" onClick={() => begin(difficulty)}>
              Begin the offensive
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
