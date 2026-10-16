"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Hud } from "@/components/hud"
import { OrderPanel } from "@/components/order-panel"
import { ProvincePanel } from "@/components/province-panel"
import { TimelinePanel } from "@/components/timeline-panel"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CATALOG_BY_ID } from "@/lib/data/catalog"
import type { QueuedOrder } from "@/lib/orders"
import { clearGame, freshGame, loadGame, saveGame } from "@/lib/storage"
import type { GameState, PlayerOrder, SaveGame, TurnRecord } from "@/lib/types"
import { WarMap, type MapProvince } from "@/components/war-map"

export function GameApp() {
  const [game, setGame] = useState<SaveGame>(() => loadGame() ?? freshGame())
  const [selectedId, setSelectedId] = useState("tarnow")
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
    saveGame(game)
  }, [game])

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
      })),
    [game.state.provinces],
  )
  const selected = game.state.provinces.find((province) => province.id === selectedId) ?? null
  const activeLog = logIndex ?? Math.max(0, game.log.length - 1)

  function addArrow(fromId: string, toId: string) {
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
    const available = from.units.filter(
      (unit) => unit.faction === "central" && !claimed.has(unit.id),
    )
    if (!available.length) {
      setHint(`${from.name} has no unassigned formation.`)
      return
    }
    const kind = to.controller === "central" ? "move" : "attack"
    if (!from.neighbors.includes(toId)) {
      setHint(
        `${from.name} and ${to.name} do not share a border. The engine will reject the order so you can see why.`,
      )
    } else if (from.supply < 30) {
      setHint(`${from.name} is below supply 30. The engine will refuse the advance.`)
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
          unitIds: available.map((unit) => unit.id),
        },
      ]
    })
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
    if (busy) return
    setBusy(true)
    setError(null)
    const orders: PlayerOrder[] = []
    for (const order of queue) {
      if (order.kind === "fortify") {
        orders.push({ type: "fortify", provinceId: order.from })
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
        version: 1,
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
    setGame(freshGame())
    setQueue([])
    setDirective("")
    setFlash([])
    setError(null)
    setLogIndex(null)
    setSelectedId("tarnow")
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
                onSelect={setSelectedId}
                onOrder={addArrow}
                onFortify={fortify}
              />
            </TabsContent>
            <TabsContent value="chronicle" className="min-h-0 flex-1 lg:hidden">
              <TimelinePanel
                log={game.log}
                active={game.log.length ? activeLog : 0}
                onActive={setLogIndex}
              />
            </TabsContent>
          </Tabs>
        </aside>
        <section className="relative z-10 hidden min-h-0 border-t border-border bg-background lg:block">
          <TimelinePanel
            log={game.log}
            active={game.log.length ? activeLog : 0}
            onActive={setLogIndex}
          />
        </section>
      </div>
    </div>
  )
}
