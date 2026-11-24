"use client"

import type { EngagementPreview } from "@/lib/engine/turn"
import { oddsBand } from "@/lib/ui/odds-band"

type OddsBarProps = {
  preview: EngagementPreview
  testId?: "attack-odds" | "combined-odds"
  compact?: boolean
}

const TONE_CLASS: Record<string, string> = {
  good: "bg-[#3d7a52]",
  even: "bg-[#c6a15a]",
  bad: "bg-[#a85b49]",
  open: "bg-[#4a6d90]",
}

export function OddsBar({ preview, testId, compact }: OddsBarProps) {
  const band = oddsBand(preview)
  const tooltip = band.detail.join(" ")

  return (
    <div
      className={compact ? "mt-1" : "mt-2"}
      data-testid={testId}
      data-odds-band={band.tone}
      data-ratio={Number.isFinite(band.ratio) ? band.ratio.toFixed(2) : "open"}
      title={tooltip}
    >
      <div className="flex items-center gap-2">
        <div
          className="h-1.5 w-full min-w-[8rem] max-w-[12rem] shrink-0 overflow-hidden rounded-full bg-muted"
          data-odds-track
        >
          <div
            className={`h-full w-full ${TONE_CLASS[band.tone] ?? TONE_CLASS.even}`}
            data-odds-fill
          />
        </div>
        <span className="shrink-0 text-xs font-medium text-foreground">{band.label}</span>
      </div>
      {!compact && preview.origins > 1 ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {preview.origins === 2 ? "Two-pronged" : "Concentric"} attack
          {preview.encircled ? " · surrounded" : ""}
        </p>
      ) : null}
    </div>
  )
}