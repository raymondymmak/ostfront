"use client"

import Link from "next/link"
import { useCallback, useMemo, useState } from "react"
import { Hud } from "@/components/hud"
import { OrderPanel } from "@/components/order-panel"
import { ProvincePanel } from "@/components/province-panel"
import { TeachPanel } from "@/components/teach-panel"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { WarMap, type MapProvince } from "@/components/war-map"
import { CATALOG_BY_ID } from "@/lib/data/catalog"
import { independentFormations, partyOf } from "@/lib/engine/echelon"
import { spendable } from "@/lib/engine/economy"
import type { TeachFeedback } from "@/lib/teach/feedback"
import type { CoachHint } from "@/lib/teach/coach"
import type { LessonMeta, TeachLessonId, TeachVariant } from "@/lib/teach/lessons"
import { leaveDepotGarrison, queuedToPlayerOrders, type QueuedOrder } from "@/lib/orders"
import type { GameState, PlayerOrder, TurnRecord, UnitKind } from "@/lib/types"

type SessionPayload = {
  meta: LessonMeta
  prompt: { question: string; intro: string }
  hints: CoachHint[]
  state: GameState
  pedagogy: { disclosure: string }
  highlights: Array<{ provinceId?: string; uiId?: string }>
  beliefRecall?: { summary: string; question: string } | null
}

export function TeachingApp() {
  const [lessonId, setLessonId] = useState<TeachLessonId>("converging-lublin")
  const [variant, setVariant] = useState<TeachVariant>("guided")
  const [session, setSession] = useState<SessionPayload | null>(null)
  const [priorAttemptId, setPriorAttemptId] = useState<string | null>(null)
  const [beliefRecall, setBeliefRecall] = useState<{ summary: string; question: string } | null>(null)
  const [state, setState] = useState<GameState | null>(null)
  const [selectedId, setSelectedId] = useState("lublin")
  const [overlay, setOverlay] = useState<"none" | "supply" | "unrest">("none")
  const [orderMode, setOrderMode] = useState(true)
  const [queue, setQueue] = useState<QueuedOrder[]>([])
  const [hintLevel, setHintLevel] = useState(0)
  const [coachHighlightIds, setCoachHighlightIds] = useState<string[]>([])
  const [reasoning, setReasoning] = useState("")
  const [prediction, setPrediction] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<TeachFeedback | null>(null)
  const [record, setRecord] = useState<TurnRecord | null>(null)
  const [flash, setFlash] = useState<string[]>([])
  const [sideTab, setSideTab] = useState("orders")
  const [setupOpen, setSetupOpen] = useState(true)
  const [pedagogyDisclosure, setPedagogyDisclosure] = useState("")
  const [coachReply, setCoachReply] = useState<string | null>(null)
  const [coachSource, setCoachSource] = useState<string | null>(null)
  const [coachStance, setCoachStance] = useState<string | null>(null)
  const [followUp, setFollowUp] = useState<string | null>(null)

  const loadSession = useCallback(async (
    nextLessonId: TeachLessonId,
    nextVariant: TeachVariant,
    nextPriorAttemptId?: string | null,
  ) => {
    setBusy(true)
    setError(null)
    setFeedback(null)
    setRecord(null)
    setQueue([])
    setReasoning("")
    setPrediction("")
    setHintLevel(0)
    setFlash([])
    setCoachReply(null)
    setCoachSource(null)
    setCoachStance(null)
    setFollowUp(null)
    try {
      const priorQuery = nextPriorAttemptId ? `&priorAttemptId=${nextPriorAttemptId}` : ""
      const response = await fetch(
        `/api/teach/session?lessonId=${nextLessonId}&variant=${nextVariant}${priorQuery}`,
      )
      const payload = (await response.json()) as SessionPayload & { error?: string }
      if (!response.ok) throw new Error(payload.error ?? "Could not load teaching session.")
      setSession(payload)
      setState(payload.state)
      setLessonId(nextLessonId)
      setVariant(nextVariant)
      setPriorAttemptId(nextPriorAttemptId ?? null)
      setBeliefRecall(payload.beliefRecall ?? null)
      setSelectedId(payload.meta.targetProvinceId)
      setCoachHighlightIds(
        payload.highlights.map((item) => item.provinceId).filter((id): id is string => Boolean(id)),
      )
      setSetupOpen(false)
      setPedagogyDisclosure(payload.pedagogy?.disclosure ?? "")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Session load failed.")
    } finally {
      setBusy(false)
    }
  }, [])

  const provinces = useMemo<MapProvince[]>(() => {
    if (!state) return []
    return state.provinces.map((province) => ({
      ...province,
      polygon: CATALOG_BY_ID[province.id]?.polygon ?? [],
      centroid: CATALOG_BY_ID[province.id]?.centroid ?? [0, 0],
    }))
  }, [state])

  const attacking = new Set(
    queue.filter((order) => order.kind === "attack").flatMap((order) => order.unitIds),
  )
  const budget = state
    ? spendable(state, "central", attacking)
    : { mp: 0, ip: 0 }
  const selected = state?.provinces.find((province) => province.id === selectedId) ?? null

  function addArrow(fromId: string, toId: string, commitAll = false) {
    if (!state || feedback) return
    const from = state.provinces.find((province) => province.id === fromId)
    const to = state.provinces.find((province) => province.id === toId)
    if (!from || !to || fromId === toId) return
    setSelectedId(fromId)
    if (from.controller !== "central") {
      setHint("Start in a Central Powers province you control.")
      return
    }
    const claimed = new Set(queue.flatMap((order) => (order.kind === "fortify" ? [] : order.unitIds)))
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
    if (from.supply < 30) {
      setHint(`${from.name} is below supply 30.`)
    } else if (from.depot === "central" && remaining.length === 0) {
      setHint(`This arrow empties the ${from.name} depot.`)
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

  function fortify(provinceId: string) {
    if (!state || feedback) return
    setQueue((current) => {
      if (current.some((order) => order.kind === "fortify" && order.from === provinceId)) return current
      return [...current, { id: crypto.randomUUID(), kind: "fortify", from: provinceId, unitIds: [] }]
    })
  }

  function recruit(provinceId: string, unitKind: UnitKind) {
    void provinceId
    void unitKind
  }

  async function discussPlan() {
    if (!session || variant === "silent" || busy || feedback) return
    setBusy(true)
    setError(null)
    try {
      const orders = queuedToPlayerOrders(queue)
      const response = await fetch("/api/teach/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonId,
          variant,
          orders,
          reasoning,
          prediction,
          priorAttemptId: priorAttemptId ?? undefined,
        }),
      })
      const payload = (await response.json()) as {
        coach?: { reply: string; source: string; stance: string; followUp: string | null; highlights?: Array<{ provinceId?: string }> }
        error?: string
      }
      if (!response.ok) throw new Error(payload.error ?? "Coach request failed.")
      setCoachReply(payload.coach!.reply)
      setCoachSource(payload.coach!.source)
      setCoachStance(payload.coach!.stance)
      setFollowUp(payload.coach!.followUp)
      if (payload.coach!.highlights?.length) {
        setCoachHighlightIds((current) => [
          ...new Set([
            ...current,
            ...payload.coach!.highlights!.map((h) => h.provinceId).filter((id): id is string => Boolean(id)),
          ]),
        ])
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Coach request failed.")
    } finally {
      setBusy(false)
    }
  }

  async function requestHint() {
    if (!session || variant === "silent") return
    const next = hintLevel + 1
    const response = await fetch("/api/teach/hint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lessonId, variant, level: next }),
    })
    if (!response.ok) return
    const payload = (await response.json()) as { hint?: CoachHint }
    if (payload.hint) {
      setHintLevel(next)
      setCoachHighlightIds((current) => [
        ...new Set([
          ...current,
          ...payload.hint!.highlights.map((h) => h.provinceId).filter((id): id is string => Boolean(id)),
        ]),
      ])
    }
  }

  async function resolveDrill() {
    if (!state || busy || feedback) return
    setBusy(true)
    setError(null)
    const orders: PlayerOrder[] = queuedToPlayerOrders(queue)
    const selectedProvinceIds = [...new Set([selectedId, ...queue.map((o) => o.from), ...queue.map((o) => o.to)])]
    try {
      const response = await fetch("/api/teach/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonId,
          variant,
          orders,
          reasoning,
          prediction,
          selectedProvinceIds,
          priorAttemptId: priorAttemptId ?? undefined,
        }),
      })
      const payload = (await response.json()) as {
        state?: GameState
        record?: TurnRecord
        feedback?: TeachFeedback
        error?: string
      }
      if (!response.ok || !payload.state || !payload.record || !payload.feedback) {
        throw new Error(payload.error ?? "Resolve failed.")
      }
      setState(payload.state)
      setRecord(payload.record)
      setFeedback(payload.feedback)
      setFlash(payload.record.controlChanges.map((change) => change.provinceId))
      setCoachHighlightIds(
        payload.feedback.pointers.map((p) => p.provinceId).filter((id): id is string => Boolean(id)),
      )
      if (payload.feedback.attemptId && variant === "guided" && lessonId === "converging-lublin") {
        setPriorAttemptId(payload.feedback.attemptId)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Resolve failed.")
    } finally {
      setBusy(false)
    }
  }

  if (setupOpen || !session || !state) {
    return (
      <main
        className="flex min-h-dvh items-center justify-center bg-background px-6"
        data-testid="teach-setup"
      >
        <div className="max-w-md space-y-4 rounded-lg border border-border p-6">
          <h1 className="font-display text-2xl">Teaching drills</h1>
          <p className="text-sm text-muted-foreground">
            Converging attacks on Lublin, then supply vs headcount. Predict outcomes before resolve; beliefs are
            stored server-side for silent follow-ups.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            type="button"
            data-testid="teach-begin"
            disabled={busy}
            onClick={() => void loadSession("converging-lublin", "guided")}
          >
            {busy ? "Loading…" : "Begin converging-attacks drill"}
          </Button>
          <Button
            type="button"
            variant="outline"
            data-testid="teach-begin-supply"
            disabled={busy}
            onClick={() => void loadSession("supply-tradeoff", "guided")}
          >
            Supply vs headcount lesson
          </Button>
          <p className="text-center text-xs">
            <Link href="/" className="underline">
              Back to campaign
            </Link>
          </p>
        </div>
      </main>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background lg:h-dvh lg:overflow-hidden" data-testid="teach-app">
      <Hud
        state={state}
        armReset={false}
        onReset={() => void loadSession(lessonId, variant, priorAttemptId)}
        advisorOpen={false}
        onAdvisor={() => {}}
        teachMode
      />
      {error && (
        <p className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {record && (
        <div className="border-b border-border px-4 py-2 text-xs" data-testid="teach-resolution-log">
          {record.resolutions
            .filter((item) => item.proposal.type === "attack")
            .map((item) => (
              <p key={item.summary.slice(0, 40)}>{item.summary}</p>
            ))}
        </div>
      )}
      <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_minmax(18rem,22rem)_minmax(16rem,20rem)]">
        <div className="relative min-h-[45vh] lg:min-h-0">
          <WarMap
            provinces={provinces}
            selectedId={selectedId}
            overlay={overlay}
            orders={queue}
            flashIds={flash}
            coachHighlightIds={coachHighlightIds}
            orderMode={orderMode && !feedback}
            onSelect={setSelectedId}
            onDraw={addArrow}
            onOverlay={setOverlay}
          />
        </div>
        <aside className="flex min-h-0 flex-col border-t border-border lg:border-t-0 lg:border-l">
          <Tabs value={sideTab} onValueChange={setSideTab} className="flex min-h-0 flex-1 flex-col">
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
                state={state}
                directive=""
                onDirective={() => {}}
                queue={queue}
                onQueue={setQueue}
                orderMode={orderMode && !feedback}
                onOrderMode={setOrderMode}
                hint={hint}
                busy={busy}
                onEndTurn={() => void resolveDrill()}
                onSelect={setSelectedId}
                endTurnLabel="Resolve this fortnight"
                ordersLocked={Boolean(feedback)}
              />
            </TabsContent>
            <TabsContent value="front" className="min-h-0 flex-1">
              <ProvincePanel
                state={state}
                province={selected}
                budget={budget}
                onSelect={setSelectedId}
                onOrder={addArrow}
                onFortify={fortify}
                onRecruit={recruit}
                onCancelRecruit={() => {}}
                queue={queue}
                recruitDisabled
              />
            </TabsContent>
          </Tabs>
        </aside>
        <TeachPanel
          meta={session.meta}
          intro={session.prompt.intro}
          question={session.prompt.question}
          variant={variant}
          pedagogyDisclosure={pedagogyDisclosure}
          reasoning={reasoning}
          onReasoning={setReasoning}
          prediction={prediction}
          onPrediction={setPrediction}
          beliefRecall={beliefRecall}
          hints={session.hints}
          hintLevel={hintLevel}
          onHint={() => void requestHint()}
          coachReply={coachReply}
          coachSource={coachSource}
          coachStance={coachStance}
          followUp={followUp}
          onDiscussPlan={() => void discussPlan()}
          busy={busy}
          onResolve={() => void resolveDrill()}
          feedback={feedback}
          silentAvailable
          onSilent={() => void loadSession("converging-lublin", "silent", priorAttemptId)}
          onSupplyLesson={
            lessonId === "converging-lublin" && variant === "guided" && feedback
              ? () => void loadSession("supply-tradeoff", "guided")
              : undefined
          }
        />
      </div>
      <div className="border-t border-border px-4 py-2 text-center text-xs text-muted-foreground">
        <Link href="/" className="underline" data-testid="teach-exit-campaign">
          Return to full campaign
        </Link>
        {" · "}
        <Button
          variant="link"
          className="h-auto p-0 text-xs"
          onClick={() => void loadSession(lessonId, variant, priorAttemptId)}
        >
          Restart drill
        </Button>
      </div>
    </div>
  )
}
