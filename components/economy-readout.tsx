"use client"

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import {
  CENTRAL_INDUSTRY_MULTIPLIER,
  INCOME_FORMULA,
  REFIT_FORMULA,
  describeProvinceIncome,
  explainIncome,
  explainRefit,
} from "@/lib/engine/economy"
import type { GameState } from "@/lib/types"

type Focus = "manpower" | "industry"

export function EconomyReadout({
  state,
  refitSkipIds = [],
}: {
  state: GameState
  /** Formations ordered to attack this fortnight. They are left out of the refit bill. */
  refitSkipIds?: readonly string[]
}) {
  const [pinned, setPinned] = useState<Focus | null>(null)
  const [hover, setHover] = useState<Focus | null>(null)
  const [suppressed, setSuppressed] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLSpanElement>(null)
  const panelId = useId()
  const focus = suppressed ? null : (pinned ?? hover)
  const open = focus !== null

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      setPinned(null)
      setHover(null)
      setSuppressed(true)
    }
    function onPointer(event: PointerEvent) {
      const root = rootRef.current
      if (!root || !(event.target instanceof Node) || root.contains(event.target)) return
      setPinned(null)
      setHover(null)
      setSuppressed(false)
    }
    document.addEventListener("keydown", onKey, true)
    document.addEventListener("pointerdown", onPointer)
    return () => {
      document.removeEventListener("keydown", onKey, true)
      document.removeEventListener("pointerdown", onPointer)
    }
  }, [open])

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!open || !panel) return
    panel.style.transform = ""
    const rect = panel.getBoundingClientRect()
    const margin = 12
    let shift = 0
    if (rect.right > window.innerWidth - margin) {
      shift -= rect.right - (window.innerWidth - margin)
    }
    if (rect.left + shift < margin) {
      shift += margin - (rect.left + shift)
    }
    panel.style.transform = shift === 0 ? "" : `translateX(${shift}px)`
  }, [open, focus])

  const explanation = explainIncome(state, "central")
  const income = explanation.income
  const purse = state.treasury.central
  const refit = explainRefit(state, "central", new Set(refitSkipIds))
  const provinces = [...explanation.provinces].sort(
    (a, b) => a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id),
  )

  function show(kind: Focus) {
    setSuppressed(false)
    setHover(kind)
  }

  function activate(kind: Focus) {
    if (pinned === kind) {
      setPinned(null)
      setHover(null)
      setSuppressed(true)
      return
    }
    setSuppressed(false)
    setPinned(kind)
  }

  return (
    <span
      ref={rootRef}
      data-testid="treasury"
      className="relative inline-flex max-w-full flex-wrap items-center"
      onMouseLeave={() => {
        setHover(null)
        setSuppressed(false)
      }}
    >
      <EconomyButton
        testId="economy-manpower"
        kind="manpower"
        expanded={focus === "manpower"}
        panelId={panelId}
        onShow={() => show("manpower")}
        onActivate={() => activate("manpower")}
      >
        Manpower <span className="font-semibold text-ink">{purse.mp}</span>{" "}
        <span>(+{income.mp})</span>
      </EconomyButton>
      <span aria-hidden="true"> · </span>
      <EconomyButton
        testId="economy-industry"
        kind="industry"
        expanded={focus === "industry"}
        panelId={panelId}
        onShow={() => show("industry")}
        onActivate={() => activate("industry")}
      >
        Industry <span className="font-semibold text-ink">{purse.ip}</span>{" "}
        <span>(+{income.ip})</span>
      </EconomyButton>
      {open && focus && (
        <span
          ref={panelRef}
          id={panelId}
          role="region"
          aria-label={focus === "manpower" ? "How manpower is computed" : "How industry is computed"}
          data-testid="economy-breakdown"
          data-economy-focus={focus}
          data-income-mp={income.mp}
          data-income-ip={income.ip}
          data-refit-mp={refit.mp}
          data-industry-multiplier={CENTRAL_INDUSTRY_MULTIPLIER}
          className="absolute left-0 top-full z-30 mt-1 max-h-80 w-[min(22rem,calc(100vw-1.5rem))] overflow-y-auto rounded-sm border border-leather/50 bg-paper px-2.5 py-2 text-left text-[11px] font-normal leading-snug text-ink shadow-[0_8px_18px_rgba(36,28,20,0.22)]"
        >
          <p className="font-semibold text-[#3d342b]">
            {focus === "manpower" ? "Manpower" : "Industry"}
          </p>
          <p className="mt-1" data-testid="economy-formula">
            {INCOME_FORMULA}
          </p>
          {focus === "industry" ? (
            <p className="mt-1" data-testid="economy-industry-multiplier">
              Central Powers industry is ×{CENTRAL_INDUSTRY_MULTIPLIER}.
            </p>
          ) : null}
          <p className="mt-1" data-testid="economy-reinforcements">
            {REFIT_FORMULA}
          </p>
          <ul className="mt-1.5 space-y-1 border-t border-leather/25 pt-1.5 text-[10px] text-[#3d342b]">
            {provinces.map((province) => (
              <li key={province.id}>{describeProvinceIncome(province)}</li>
            ))}
          </ul>
        </span>
      )}
    </span>
  )
}

function EconomyButton({
  testId,
  kind,
  expanded,
  panelId,
  onShow,
  onActivate,
  children,
}: {
  testId: string
  kind: Focus
  expanded: boolean
  panelId: string
  onShow: () => void
  onActivate: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-expanded={expanded}
      aria-controls={panelId}
      title={kind === "manpower" ? "How manpower is computed" : "How industry is computed"}
      className="cursor-pointer rounded-sm underline decoration-dotted decoration-ink/40 underline-offset-2 hover:bg-paper-deep"
      onMouseEnter={onShow}
      onFocus={onShow}
      onClick={onActivate}
    >
      {children}
    </button>
  )
}
