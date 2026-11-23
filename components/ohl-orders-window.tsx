"use client"

import { campaignGoalLine } from "@/lib/ui/goal-copy"
import type { ScenarioId } from "@/lib/types"
import { FloatingWindow } from "@/components/floating-window"

type OhlOrdersWindowProps = {
  scenario: ScenarioId
  open: boolean
  x: number
  y: number
  z: number
  onFocus: () => void
  onClose: () => void
  onMove: (x: number, y: number) => void
  onStow?: () => void
}

/** Dismissible Orders from OHL — campaign goal line lives here on the desktop shell. */
export function OhlOrdersWindow({
  scenario,
  open,
  x,
  y,
  z,
  onFocus,
  onClose,
  onMove,
  onStow,
}: OhlOrdersWindowProps) {
  const goal = campaignGoalLine(scenario)
  return (
    <FloatingWindow
      title="Orders from OHL"
      open={open}
      x={x}
      y={y}
      z={z}
      widthClassName="w-[min(36rem,calc(100%-1.5rem))]"
      maxHeightClassName="max-h-[min(40dvh,12rem)]"
      testId="ohl-orders-window"
      onFocus={onFocus}
      onClose={onClose}
      onMove={onMove}
      onStow={onStow}
      resizable={false}
    >
      <div className="px-3 py-2.5">
        <p data-testid="campaign-goal" className="text-sm leading-snug text-ink">
          {goal}
        </p>
      </div>
    </FloatingWindow>
  )
}
