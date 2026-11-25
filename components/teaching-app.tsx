"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { DocumentTray } from "@/components/document-tray"
import { FloatingWindow } from "@/components/floating-window"
import { Hud } from "@/components/hud"
import { MapLegend } from "@/components/map-legend"
import { OrderPanel } from "@/components/order-panel"
import { ProvincePanel } from "@/components/province-panel"
import { TeachPanel } from "@/components/teach-panel"
import { Button } from "@/components/ui/button"
import {
  applyPersistedLayout,
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
  TEACH_PHONE_TRAY_ITEMS,
  TEACH_TRAY_ITEMS,
} from "@/lib/ui/document-tray"
import { WarMap, type MapProvince } from "@/components/war-map"
import { toggleSelection } from "@/lib/ui/selection"
import { CATALOG_BY_ID } from "@/lib/data/catalog"
import { spendable } from "@/lib/engine/economy"
import type { PaintOverlayMode } from "@/lib/map/province-paint"
import type { TeachFeedback } from "@/lib/teach/feedback"
import type { CoachHint } from "@/lib/teach/coach"
import type { LessonMeta, TeachLessonId, TeachVariant } from "@/lib/teach/lessons"
import { queuedToPlayerOrders, type QueuedOrder } from "@/lib/orders"
import type { ChipDrop } from "@/lib/ui/drag-order"
import { previewMarch } from "@/lib/ui/legal-targets"

const EMPTY_TREASURY = { central: { mp: 0, ip: 0 }, russia: { mp: 0, ip: 0 } }
import { teachSelectedProvinceIds } from "@/lib/teach/selected-provinces"
import {
  createDefaultTeachWindows,
  focusTeachWindow,
  isTeachWindowOpen,
  moveTeachWindow,
  resizeTeachWindow,
  teachLegendHeightCap,
  teachLessonHeightCap,
  TEACH_WINDOW_SIZE_HINTS,
  TEACH_WINDOW_TITLES,
  type TeachWindowId,
  type TeachWindowState,
} from "@/lib/ui/teach-windows"
import { useDesktopShell } from "@/lib/ui/use-desktop-shell"
import { restorePositionAboveTray } from "@/lib/ui/window-drag"
import type { GameState, PlayerOrder, TurnRecord, UnitKind } from "@/lib/types"

type SessionPayload = {
  meta: LessonMeta
  prompt: { question: string; intro: string; briefing?: string }
  hints: CoachHint[]
  state: GameState
  pedagogy: { disclosure: string }
  highlights: Array<{ provinceId?: string; uiId?: string }>
  beliefRecall?: { summary: string; question: string } | null
}

export function TeachingApp() {
  const desktopShell = useDesktopShell()
  const mapStageRef = useRef<HTMLDivElement>(null)
  const [windows, setWindows] = useState<TeachWindowState[]>(() => createDefaultTeachWindows())
  const [trayOrder, setTrayOrder] = useState<TeachWindowId[]>(() => defaultTrayOrder(TEACH_TRAY_ITEMS))
  const [trayDropActive, setTrayDropActive] = useState(false)
  const [trayInsertIndex, setTrayInsertIndex] = useState<number | null>(null)
  const teachTrayIds = useMemo(() => defaultTrayOrder(TEACH_TRAY_ITEMS), [])
  const orderedTeachTrayItems = useMemo(() => orderTrayItems(TEACH_TRAY_ITEMS, trayOrder), [trayOrder])
  const orderedTeachPhoneTrayItems = useMemo(
    () => orderTrayItems(TEACH_PHONE_TRAY_ITEMS, trayOrder),
    [trayOrder],
  )
  const [lessonHeightCap, setLessonHeightCap] = useState(() => teachLessonHeightCap(820))
  const [legendHeightCap, setLegendHeightCap] = useState(() => teachLegendHeightCap(820))
  const [lessonId, setLessonId] = useState<TeachLessonId>("converging-lublin")
  const [variant, setVariant] = useState<TeachVariant>("guided")
  const [session, setSession] = useState<SessionPayload | null>(null)
  const [priorAttemptId, setPriorAttemptId] = useState<string | null>(null)
  const [beliefRecall, setBeliefRecall] = useState<{ summary: string; question: string } | null>(null)
  const [state, setState] = useState<GameState | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<PaintOverlayMode>("none")
  const [orderMode, setOrderMode] = useState(true)
  const [queue, setQueue] = useState<QueuedOrder[]>([])
  const [hintLevel, setHintLevel] = useState(0)
  const [coachHighlightIds, setCoachHighlightIds] = useState<string[]>([])
  const [showRails, setShowRails] = useState(true)
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

  const loadSession = useCallback(
    async (nextLessonId: TeachLessonId, nextVariant: TeachVariant, nextPriorAttemptId?: string | null) => {
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
        setSelectedId(null)
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
    },
    [],
  )

  const provinces = useMemo<MapProvince[]>(() => {
    if (!state) return []
    return state.provinces.map((province) => ({
      ...province,
      polygon: CATALOG_BY_ID[province.id]?.polygon ?? [],
      centroid: CATALOG_BY_ID[province.id]?.centroid ?? [0, 0],
    }))
  }, [state])

  const lessonFocus = useMemo(() => {
    if (!session) return undefined
    return {
      targets: [session.meta.targetProvinceId],
      sources: [...session.meta.prongProvinceIds],
    }
  }, [session])

  const teachWindowOpen = useMemo(
    () => ({
      lesson: isTeachWindowOpen(windows, "lesson"),
      orders: isTeachWindowOpen(windows, "orders"),
      province: isTeachWindowOpen(windows, "province"),
      legend: isTeachWindowOpen(windows, "legend"),
    }),
    [windows],
  )

  function resetTeachWindows() {
    const node = mapStageRef.current
    const width = node?.clientWidth || (typeof window !== "undefined" ? window.innerWidth : 1440)
    const height =
      node?.clientHeight ||
      Math.max(400, (typeof window !== "undefined" ? window.innerHeight : 900) - 120)
    const defaults = createDefaultTeachWindows(width, height)
    const persisted = loadWindowSession<TeachWindowId>("teach")
    const restored = applyPersistedLayout(defaults, persisted)
    setWindows(liftPersistedWindowsAboveTray(restored, height))
    setTrayOrder(normalizeTrayOrder(persisted?.trayOrder, teachTrayIds))
    setLessonHeightCap(teachLessonHeightCap(height))
    setLegendHeightCap(teachLegendHeightCap(height))
  }

  useEffect(() => {
    if (setupOpen) return
    const frame = window.requestAnimationFrame(() => resetTeachWindows())
    return () => window.cancelAnimationFrame(frame)
    // Re-seed layout when entering the table / switching shell — not on every order change.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resetTeachWindows reads live stage + session
  }, [setupOpen, desktopShell])

  useEffect(() => {
    if (setupOpen || !desktopShell) return
    saveWindowSession("teach", windows, trayOrder)
  }, [windows, trayOrder, setupOpen, desktopShell])

  function measureTraySlots(excludeId?: TeachWindowId) {
    const among: TeachWindowId[] = []
    const slots: { left: number; width: number }[] = []
    const root =
      typeof document !== "undefined" ? document.querySelector("[data-testid=document-tray]") : null
    root?.querySelectorAll<HTMLElement>("[data-tray-id]").forEach((node) => {
      const tabId = node.getAttribute("data-tray-id") as TeachWindowId | null
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

  function stowPaper(id: TeachWindowId, clientX?: number) {
    setWindows((current) => stowWindow(current, id))
    setTrayDropActive(false)
    setTrayInsertIndex(null)
    if (clientX == null) return
    const { among, slots } = measureTraySlots(id)
    const index = insertIndexAtClientX(clientX, slots)
    setTrayOrder((current) => placeIdInOrder(current, id, index, among))
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (!desktopShell) {
        setSelectedId(null)
        return
      }
      if (windows.some((item) => item.open)) {
        setWindows((current) => stowTopmostWindow(current))
        return
      }
      setSelectedId(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [desktopShell, windows])

  function setWindowOpen(id: TeachWindowId, open: boolean) {
    setWindows((current) => (open ? focusTeachWindow(current, id) : stowWindow(current, id)))
  }

  function onTrayRestore(id: TeachWindowId) {
    const node = mapStageRef.current
    setWindows((current) => {
      const focused = focusTeachWindow(current, id)
      const item = focused.find((entry) => entry.id === id)
      if (!node || !item) return focused
      const rect = node.getBoundingClientRect()
      const hint = TEACH_WINDOW_SIZE_HINTS[id]
      const size = { w: item.width ?? hint.w, h: item.height ?? hint.h }
      const preferred = restorePositionAboveTray(
        { x: item.x, y: item.y },
        size,
        { width: rect.width, height: rect.height },
      )
      return moveTeachWindow(focused, id, preferred.x, preferred.y)
    })
  }

  function onTrayRestoreAt(id: TeachWindowId, clientX: number, clientY: number) {
    const node = mapStageRef.current
    if (!node) {
      onTrayRestore(id)
      return
    }
    const rect = node.getBoundingClientRect()
    setWindows((current) => {
      const item = current.find((entry) => entry.id === id)
      const hint = TEACH_WINDOW_SIZE_HINTS[id]
      const size = { w: item?.width ?? hint.w, h: item?.height ?? hint.h }
      const preferred = restorePositionAboveTray(
        { x: clientX - rect.left - size.w / 2, y: clientY - rect.top - 24 },
        size,
        { width: rect.width, height: rect.height },
      )
      const focused = focusTeachWindow(current, id)
      return moveTeachWindow(focused, id, preferred.x, preferred.y)
    })
  }

  function onWindowSize(id: TeachWindowId, size: { width: number; height: number }) {
    setWindows((current) => {
      const item = current.find((entry) => entry.id === id)
      if (item?.width === size.width && item?.height === size.height) return current
      return resizeTeachWindow(current, id, { width: size.width, height: size.height })
    })
  }

  const attacking = new Set(
    queue.filter((order) => order.kind === "attack").flatMap((order) => order.unitIds),
  )
  const budget = state ? spendable(state, "central", attacking) : { mp: 0, ip: 0 }
  const selected = state?.provinces.find((province) => province.id === selectedId) ?? null

  function onChipDrop(drop: ChipDrop) {
    if (!state || feedback) return
    setQueue(drop.queue)
    setHint(drop.reason)
  }

  function addArrow(fromId: string, toId: string, commitAll = false) {
    if (!state || feedback) return
    const from = state.provinces.find((province) => province.id === fromId)
    const to = state.provinces.find((province) => province.id === toId)
    if (!from || !to || fromId === toId) return
    setSelectedId(fromId)
    const verdict = previewMarch(state, queue, fromId, toId, { commitAll })
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
      return [...current, { id: crypto.randomUUID(), kind, from: fromId, to: toId, unitIds }]
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
        coach?: {
          reply: string
          source: string
          stance: string
          followUp: string | null
          highlights?: Array<{ provinceId?: string }>
        }
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
    const selectedProvinceIds = teachSelectedProvinceIds(selectedId, queue)
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
      if (desktopShell) {
        setWindows((current) => focusTeachWindow(current, "lesson"))
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
        <div className="max-w-md space-y-4 rounded-lg border border-leather/40 bg-paper p-6 text-ink shadow-sm">
          <h1 className="font-display text-2xl">Teaching drills</h1>
          <p className="text-sm text-muted-foreground">
            Converging attacks, then supply vs headcount. Plan on the map; beliefs stay server-side.
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

  const orderPanel = (
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
      onEndTurn={() => {}}
      onSelect={setSelectedId}
      ordersLocked={Boolean(feedback)}
      hideEndTurn
    />
  )

  const provincePanel = (
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
  )

  const teachPanel = (
    <TeachPanel
      meta={session.meta}
      intro={session.prompt.intro}
      question={session.prompt.question}
      briefing={session.prompt.briefing ?? session.meta.briefing}
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
      silentAvailable={lessonId === "converging-lublin" && variant === "guided"}
      onSilent={() => void loadSession("converging-lublin", "silent", priorAttemptId)}
      onSupplyLesson={
        lessonId === "converging-lublin" && variant === "guided" && feedback
          ? () => void loadSession("supply-tradeoff", "guided")
          : undefined
      }
      embedded
    />
  )

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden bg-background"
      data-testid="teach-app"
      data-teach-shell={desktopShell ? "desktop" : "stacked"}
    >
      <Hud
        state={state}
        armReset={false}
        onReset={() => void loadSession(lessonId, variant, priorAttemptId)}
        teachMode
        teachGoal={session.meta.title}
        tableShell={desktopShell}
      />
      {error && (
        <p
          className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
      {record && (
        <div className="border-b border-leather/35 bg-paper-deep px-4 py-2 text-xs text-ink" data-testid="teach-resolution-log">
          {record.resolutions
            .filter((item) => item.proposal.type === "attack")
            .map((item) => (
              <p key={item.summary.slice(0, 40)}>{item.summary}</p>
            ))}
        </div>
      )}
      <div
        className={`min-h-0 flex-1 overflow-hidden ${
          desktopShell
            ? "grid"
            : "flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)_minmax(16rem,20rem)]"
        }`}
      >
        <div
          ref={mapStageRef}
          className={
            desktopShell
              ? "relative min-h-0 flex-1 overflow-hidden"
              : "relative max-h-[min(36vh,15rem)] min-h-[9rem] shrink-0 overflow-hidden lg:max-h-none lg:min-h-0 lg:flex-1"
          }
        >
          <WarMap
            provinces={provinces}
            treasury={state?.treasury ?? EMPTY_TREASURY}
            selectedId={selectedId}
            overlay={overlay}
            orders={queue}
            flashIds={flash}
            coachHighlightIds={coachHighlightIds}
            lessonFocus={lessonFocus}
            orderMode={orderMode && !feedback}
            showMapLegend={!desktopShell}
            showRails={showRails}
            onShowRails={setShowRails}
            onSelect={(id) => setSelectedId((current) => toggleSelection(current, id))}
            onDraw={addArrow}
            onChipDrop={feedback ? undefined : onChipDrop}
            onOverlay={setOverlay}
          />
          {desktopShell &&
            windows.map((win) => {
              if (!win.open) return null
              const focus = () => setWindows((current) => focusTeachWindow(current, win.id))
              const stow = () => setWindowOpen(win.id, false)
              const onMove = (x: number, y: number) =>
                setWindows((current) => moveTeachWindow(current, win.id, x, y))
              const paperProps = {
                widthPx: win.width,
                heightPx: win.height,
                onSize: (size: { width: number; height: number }) => onWindowSize(win.id, size),
                onStow: (clientX?: number) => stowPaper(win.id, clientX),
                onTrayHover,
              }
              if (win.id === "lesson") {
                return (
                  <FloatingWindow
                    key={win.id}
                    title={TEACH_WINDOW_TITLES.lesson}
                    open={win.open}
                    x={win.x}
                    y={win.y}
                    z={win.z}
                    widthClassName="w-[min(21.25rem,calc(100%-1.5rem))]"
                    maxHeightClassName="max-h-[min(62dvh,30rem)]"
                    heightCap={lessonHeightCap}
                    bodyScroll={false}
                    testId="teach-lesson-window"
                    onFocus={focus}
                    onClose={stow}
                    onMove={onMove}
                    {...paperProps}
                  >
                    {teachPanel}
                  </FloatingWindow>
                )
              }
              if (win.id === "orders") {
                return (
                  <FloatingWindow
                    key={win.id}
                    title={TEACH_WINDOW_TITLES.orders}
                    open={win.open}
                    x={win.x}
                    y={win.y}
                    z={win.z}
                    maxHeightClassName="max-h-[min(70dvh,36rem)]"
                    testId="teach-orders-window"
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
                    title={TEACH_WINDOW_TITLES.province}
                    open={win.open}
                    x={win.x}
                    y={win.y}
                    z={win.z}
                    maxHeightClassName="max-h-[min(70dvh,36rem)]"
                    testId="teach-province-window"
                    onFocus={focus}
                    onClose={stow}
                    onMove={onMove}
                    {...paperProps}
                  >
                    <aside className="flex min-h-0 flex-col">{provincePanel}</aside>
                  </FloatingWindow>
                )
              }
              if (win.id === "legend") {
                return (
                  <FloatingWindow
                    key={win.id}
                    title={TEACH_WINDOW_TITLES.legend}
                    open={win.open}
                    x={win.x}
                    y={win.y}
                    z={win.z}
                    widthClassName="w-[min(17.5rem,calc(100%-1.5rem))]"
                    maxHeightClassName="max-h-[min(36dvh,16.5rem)]"
                    heightCap={legendHeightCap}
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
              return null
            })}
          {desktopShell && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[30]">
              <DocumentTray
                items={orderedTeachTrayItems}
                openById={teachWindowOpen}
                onRestore={onTrayRestore}
                onRestoreAt={onTrayRestoreAt}
                dropHighlight={trayDropActive}
                insertIndex={trayInsertIndex}
                trayOrder={trayOrder}
                onTrayOrderChange={setTrayOrder}
              />
            </div>
          )}
        </div>
        {!desktopShell && (
          <>
            {/* Bounded Lesson so Resolve stays in the viewport; body scrolls inside. */}
            <div
              className="flex min-h-[11rem] flex-1 flex-col overflow-hidden border-t border-leather/35 bg-paper"
              data-testid="teach-lesson-stack"
            >
              {teachPanel}
            </div>
            <aside className="flex max-h-[min(28vh,11rem)] min-h-0 shrink-0 flex-col overflow-hidden border-t border-border">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {sideTab === "orders" ? orderPanel : null}
                  {sideTab === "front" ? provincePanel : null}
                  {sideTab === "legend" ? (
                    <MapLegend
                      embedded
                      showRails={showRails}
                      onToggleRails={() => setShowRails((value) => !value)}
                      overlay={overlay}
                    />
                  ) : null}
                </div>
                <DocumentTray
                  variant="phone"
                  items={orderedTeachPhoneTrayItems}
                  openById={{
                    orders: sideTab === "orders",
                    province: sideTab === "front",
                    legend: sideTab === "legend",
                  }}
                  activeId={
                    sideTab === "front" ? "province" : sideTab === "legend" ? "legend" : "orders"
                  }
                  onRestore={(id) => {
                    if (id === "province") setSideTab("front")
                    else if (id === "legend") setSideTab("legend")
                    else setSideTab("orders")
                  }}
                  className="shrink-0"
                />
              </div>
            </aside>
          </>
        )}
      </div>
      <div className="shrink-0 border-t border-leather/35 bg-paper px-4 py-2 text-center text-xs text-muted-foreground">
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
