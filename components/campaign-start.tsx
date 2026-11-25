"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { BRIEFING } from "@/lib/data/scenario"
import { campaignGoalLine } from "@/lib/ui/goal-copy"
import type { Difficulty } from "@/lib/types"

type CampaignStartProps = {
  difficulty: Difficulty
  onDifficulty: (value: Difficulty) => void
  beginBusy: boolean
  onBegin: () => void
}

/** Pre-game full viewport — static art only; live map mounts after Begin. */
export function CampaignStart({
  difficulty,
  onDifficulty,
  beginBusy,
  onBegin,
}: CampaignStartProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const goal = campaignGoalLine("gorlice")

  const difficulties = [
    ["easy", "Easy"],
    ["normal", "Normal"],
    ["hard", "Hard"],
  ] as const

  return (
    <div
      className="relative flex h-dvh max-h-dvh flex-col overflow-hidden bg-background text-foreground"
      data-testid="scenario-picker"
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden data-testid="campaign-start-backdrop">
        <svg viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
          <defs>
            <radialGradient id="ost-vignette" cx="50%" cy="46%" r="78%">
              <stop offset="0%" stopColor="#2a241e" stopOpacity="0.2" />
              <stop offset="55%" stopColor="#14110e" stopOpacity="0.75" />
              <stop offset="100%" stopColor="#0a0806" />
            </radialGradient>
            <filter id="ost-paper" x="0%" y="0%" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="4" seed="8" result="noise" />
              <feColorMatrix in="noise" type="saturate" values="0" result="gray" />
              <feComponentTransfer in="gray" result="grain">
                <feFuncA type="linear" slope="0.07" />
              </feComponentTransfer>
              <feBlend in="SourceGraphic" in2="grain" mode="multiply" />
            </filter>
            <linearGradient id="ost-ink-wash" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ebe4d4" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#c6a15a" stopOpacity="0.04" />
            </linearGradient>
          </defs>
          <rect width="1200" height="800" fill="#14110e" />
          <g filter="url(#ost-paper)" opacity="0.92">
            <path
              d="M 80 520 Q 140 380 260 320 T 520 280 Q 640 265 760 290 T 980 360 L 1020 620 L 60 640 Z"
              fill="#4a6d90"
              fillOpacity="0.22"
            />
            <path
              d="M 520 240 Q 680 220 820 250 T 1080 340 L 1120 580 Q 900 560 700 500 T 420 460 Q 300 450 180 480 L 80 520 Z"
              fill="#a85b49"
              fillOpacity="0.2"
            />
            <path
              d="M 200 200 Q 360 170 520 185 T 820 230 Q 920 255 1000 300"
              fill="none"
              stroke="#ebe4d4"
              strokeWidth="1.2"
              strokeOpacity="0.12"
            />
            <path
              d="M 120 340 Q 280 300 440 290 T 760 310 Q 900 330 1020 380"
              fill="none"
              stroke="#c6a15a"
              strokeWidth="0.8"
              strokeOpacity="0.18"
            />
            <circle cx="540" cy="360" r="3" fill="#c6a15a" fillOpacity="0.35" />
            <circle cx="620" cy="320" r="2.5" fill="#c6a15a" fillOpacity="0.28" />
            <circle cx="480" cy="400" r="2" fill="#ebe4d4" fillOpacity="0.2" />
          </g>
          <rect width="1200" height="800" fill="url(#ost-vignette)" />
          <rect width="1200" height="800" fill="url(#ost-ink-wash)" />
        </svg>
      </div>

      <main className="relative z-10 mx-auto flex w-full max-w-md min-h-0 flex-1 flex-col items-center overflow-y-auto overscroll-contain pt-[calc(1.5rem+env(safe-area-inset-top,0px))] pr-[calc(1.25rem+env(safe-area-inset-right,0px))] pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pl-[calc(1.25rem+env(safe-area-inset-left,0px))] text-center sm:max-w-lg sm:pr-[calc(2rem+env(safe-area-inset-right,0px))] sm:pl-[calc(2rem+env(safe-area-inset-left,0px))] lg:max-h-dvh lg:pt-[calc(2rem+env(safe-area-inset-top,0px))] lg:pb-[calc(2rem+env(safe-area-inset-bottom,0px))]">
        <div
          className="my-auto flex w-full shrink-0 flex-col items-stretch rounded-sm border border-leather/45 bg-paper/95 px-5 py-6 text-ink shadow-[0_16px_36px_rgba(20,14,8,0.35)] sm:px-8 sm:py-8"
          data-testid="campaign-start-card"
        >
          <h1 className="font-display text-5xl font-normal italic leading-none tracking-wide text-primary sm:text-6xl md:text-7xl">
            Ostfront
          </h1>
          <p className="mt-4 font-display text-xl leading-tight text-ink sm:text-2xl">Gorlice–Tarnów</p>
          <p className="mt-1 text-sm text-muted-foreground">2 May 1915</p>

          <p
            className="mx-auto mt-6 w-full max-w-sm text-base font-medium leading-snug text-ink sm:text-[1.05rem]"
            data-testid="briefing-task"
          >
            {goal}
          </p>

          <div
            className="mt-8 flex w-full rounded-sm border border-leather/40 bg-paper-deep p-1 shadow-sm"
            data-testid="difficulty"
            role="group"
            aria-label="Difficulty"
          >
            {difficulties.map(([id, title]) => {
              const selected = difficulty === id
              return (
                <button
                  key={id}
                  type="button"
                  data-testid={`difficulty-${id}`}
                  onClick={() => onDifficulty(id)}
                  className={`flex-1 rounded-md px-3 py-2.5 text-sm font-semibold transition-colors ${
                    selected
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  {title}
                </button>
              )
            })}
          </div>

          <div className="mt-6 flex w-full flex-col gap-2.5" data-testid="campaign-start-actions">
            <Button
              type="button"
              data-testid="begin-scenario"
              disabled={beginBusy}
              size="lg"
              className="h-11 w-full text-base font-semibold"
              onClick={onBegin}
            >
              {beginBusy ? "Opening…" : "Begin"}
            </Button>
            <a
              href="/teach"
              data-testid="begin-teach"
              className="group/button inline-flex h-10 w-full shrink-0 items-center justify-center rounded-lg border border-transparent bg-secondary px-2.5 text-base font-medium text-secondary-foreground transition-all hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]"
            >
              Teaching drill
            </a>
          </div>

          <button
            type="button"
            className="mt-5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => setMoreOpen((value) => !value)}
          >
            {moreOpen ? "Less briefing" : "More briefing"}
          </button>

          {moreOpen ? (
            <div
              className="mx-auto mt-3 max-h-[min(32vh,14rem)] w-full max-w-sm shrink-0 overflow-y-auto overscroll-contain rounded-sm border border-leather/35 bg-paper p-4 text-left text-xs leading-5 text-muted-foreground shadow-sm"
              data-testid="campaign-more-briefing"
            >
              {BRIEFING.map((paragraph) => (
                <p key={paragraph.slice(0, 32)} className="mt-2 first:mt-0">
                  {paragraph}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  )
}
