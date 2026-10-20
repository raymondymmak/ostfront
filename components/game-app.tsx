"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
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
import { leaveDepotGarrison, type QueuedOrder } from "@/lib/orders"
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

  function addArrow(fromId: string, toId: string, commitAll = false) {
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
    setSetupOpen(false)
  }

  function fortify(provinceId: string) {
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
    if (busy || game.state.result) return
    setBusy(true)
    setError(null)
    const orders: PlayerOrder[] = []
    for (const order of queue) {
      if (order.kind === "fortify") {
        orders.push({ type: "fortify", provinceId: order.from })
      } else if (order.kind === "recruit" && order.unitKind) {
        orders.push({ type: "recruit", provinceId: order.from, unitKind: order.unitKind })
      } else if (order.kind === "cancelRecruit" && order.buildId) {
        orders.push({ type: "cancelRecruit", buildId: order.buildId })
      } else if (order.kind === "move" && order.to) {
        for (const unitId of order.unitIds) {
          orders.push({ type: "move", unitId, to: order.to })
        }
      } else if (order.kind === "attack" && order.to) {
        orders.push({
          type: "attack",
          from: order.from,
          target: order.to,
          unitIds: order.unitIds,
        })
      }
    }
    if (directive.trim()) orders.push({ type: "text", text: directive.trim() })

    try {
      const response = await fetch("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: game.state, orders }),
      })
      const payload = (await response.json()) as {
        state?: GameState
        record?: TurnRecord
        error?: string
      }
      if (!response.ok || !payload.state || !payload.record) {
        throw new Error(payload.error || "The staff could not close the fortnight.")
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
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background lg:h-dvh lg:overflow-hidden">
      <Hud
        state={game.state}
        overlay={overlay}
        onOverlay={setOverlay}
        armReset={armReset}
        onReset={reset}
      />
      {error && (
        <p className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_23rem] lg:grid-rows-[minmax(0,1fr)_16.5rem]">
        <div className="relative isolate z-0 h-[58vh] min-h-[320px] overflow-hidden lg:h-full lg:min-h-0">
          <WarMap
            provinces={provinces}
            selectedId={selectedId}
            overlay={overlay}
            orders={queue}
            flashIds={flash}
            orderMode={orderMode}
            onSelect={setSelectedId}
            onDraw={addArrow}
          />
        </div>
        <aside className="flex min-h-[28rem] flex-col border-t border-border lg:row-span-2 lg:min-h-0 lg:border-t-0 lg:border-l">
          <Tabs defaultValue="orders" className="min-h-0 flex-1 gap-0">
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
                orderMode={orderMode}
                onOrderMode={setOrderMode}
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
            />
          </div>
        </section>
      </div>
      {game.state.result && !setupOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/80 p-4" data-testid="endgame">
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg">
            <p className="text-xs tracking-wide text-muted-foreground uppercase">
              {game.state.result.sudden ? "Sudden death" : "Campaign over"}
            </p>
            <h2 className="mt-2 font-display text-4xl leading-none">{gradeLabel(game.state.result.grade)}</h2>
            <p className="mt-3 text-sm leading-6">{game.state.result.reason}</p>
            <p className="mt-3 text-sm text-muted-foreground">
              {game.state.date} · Fortnight {Math.min(game.state.turn + 1, scenarioSpec(game.state.scenario).length)} / {scenarioSpec(game.state.scenario).length}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Score {game.state.result.score} · ★ {game.state.result.captured}/{game.state.result.available} victory points
            </p>
            <Button type="button" className="mt-5" onClick={() => setSetupOpen(true)}>
              Play again
            </Button>
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
                Nothing happens while you are away. Every order resolves when the fortnight closes.
              </p>
            </div>
            <div className="rounded-lg border border-primary bg-primary/10 p-3" data-testid="scenario-gorlice">
              <span className="font-display text-xl leading-none">2 May – 11 July</span>
              <span className="mt-2 block text-sm text-muted-foreground">
                Six fortnights. Mackensen&apos;s 11th Army and the Austro-Hungarian 4th Army break Radko Dimitriev&apos;s 3rd Army. Take Kielce, Lublin and Rovno. Hold Kraków and Lemberg.
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
