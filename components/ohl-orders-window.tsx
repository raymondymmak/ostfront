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
  widthPx?: number
  heightPx?: number
  onFocus: () => void
  onClose: () => void
  onMove: (x: number, y: number) => void
  onSize?: (size: { width: number; height: number }) => void
  onStow?: (clientX?: number) => void
  onTrayHover?: (over: boolean, clientX?: number) => void
}

/** Campaign goal line. Shared by the desktop paper and the phone OHL tab. */
export function OhlOrdersBody({ scenario }: { scenario: ScenarioId }) {
  return (
    <p data-testid="campaign-goal" className="text-sm leading-snug text-ink">
      {campaignGoalLine(scenario)}
    </p>
  )
}

/** Dismissible Orders from OHL — campaign goal line lives here on the desktop shell. */
export function OhlOrdersWindow({
  scenario,
  open,
  x,
  y,
  z,
  widthPx,
  heightPx,
  onFocus,
  onClose,
  onMove,
  onSize,
  onStow,
  onTrayHover,
}: OhlOrdersWindowProps) {
  return (
    <FloatingWindow
      title="Orders from OHL"
      open={open}
      x={x}
      y={y}
      z={z}
      widthPx={widthPx}
      heightPx={heightPx}
      widthClassName="w-[min(27rem,calc(100%-1.5rem))]"
      maxHeightClassName="max-h-[min(40dvh,12rem)]"
      testId="ohl-orders-window"
      onFocus={onFocus}
      onClose={onClose}
      onMove={onMove}
      onSize={onSize}
      onStow={onStow}
      onTrayHover={onTrayHover}
      resizable={false}
    >
      <div className="px-3 py-2.5">
        <OhlOrdersBody scenario={scenario} />
      </div>
    </FloatingWindow>
  )
}
