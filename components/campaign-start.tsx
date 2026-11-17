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

  return (
    <div
      className="relative flex min-h-dvh flex-col overflow-hidden bg-[#120f0c] text-[#f3e2a8]"
      data-testid="scenario-picker"
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden data-testid="campaign-start-backdrop">
        <svg viewBox="0 0 800 500" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
          <defs>
            <radialGradient id="ost-vignette" cx="48%" cy="42%" r="72%">
              <stop offset="0%" stopColor="#3d3228" stopOpacity="0.55" />
              <stop offset="55%" stopColor="#1a1510" stopOpacity="0.92" />
              <stop offset="100%" stopColor="#0a0806" />
            </radialGradient>
            <linearGradient id="ost-front" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#4a6d90" stopOpacity="0.35" />
              <stop offset="48%" stopColor="#8e4a3a" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#5c261c" stopOpacity="0.45" />
            </linearGradient>
            <marker id="ost-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="#c6a15a" fillOpacity="0.85" />
            </marker>
          </defs>
          <rect width="800" height="500" fill="url(#ost-vignette)" />
          <path
            d="M 40 380 Q 120 280 200 240 T 420 210 Q 520 195 620 220 T 760 280 L 760 420 L 40 420 Z"
            fill="url(#ost-front)"
            fillOpacity="0.55"
          />
          <path
            d="M 60 260 Q 180 220 320 200 Q 460 185 560 210 Q 640 228 700 250"
            fill="none"
            stroke="#2a2118"
            strokeWidth="3"
            strokeOpacity="0.5"
          />
          <line
            x1="140"
            y1="318"
            x2="620"
            y2="268"
            stroke="#c6a15a"
            strokeWidth="2.5"
            strokeDasharray="12 10"
            strokeOpacity="0.75"
            markerEnd="url(#ost-arrow)"
          />
          <text x="400" y="88" textAnchor="middle" fill="#c6a15a" fillOpacity="0.35" fontSize="22" fontFamily="Georgia, serif">
            Eastern Front, May 1915
          </text>
        </svg>
      </div>

      <main className="relative z-10 mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 py-10 sm:px-6">
        <p className="font-display text-4xl italic leading-none tracking-wide text-[#c6a15a]">Ostfront</p>
        <p className="mt-3 font-display text-2xl leading-tight text-[#ebe4d4]">Gorlice–Tarnów</p>
        <p className="text-sm text-[#b3a48f]">2 May 1915</p>
        <p className="mt-4 text-sm font-medium leading-snug text-[#ebe4d4]" data-testid="briefing-task">
          {goal}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-2" data-testid="difficulty">
          {(
            [
              ["easy", "Easy"],
              ["normal", "Normal"],
              ["hard", "Hard"],
            ] as const
          ).map(([id, title]) => (
            <button
              key={id}
              type="button"
              data-testid={`difficulty-${id}`}
              onClick={() => onDifficulty(id)}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium ${difficulty === id ? "border-[#c6a15a] bg-[#c6a15a]/15 text-[#f3e2a8]" : "border-[#4a4034] text-[#b3a48f] hover:border-[#6a5e4e]"}`}
            >
              {title}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            data-testid="begin-scenario"
            disabled={beginBusy}
            className="min-w-[7rem]"
            onClick={onBegin}
          >
            {beginBusy ? "Opening…" : "Begin"}
          </Button>
          <a
            href="/teach"
            className="rounded-md border border-[#4a4034] px-3 py-2 text-sm font-medium text-[#ebe4d4] hover:bg-[#2a241e]"
            data-testid="begin-teach"
          >
            Teaching drill
          </a>
          <button
            type="button"
            className="ml-auto text-sm text-[#b3a48f] underline-offset-2 hover:underline"
            onClick={() => setMoreOpen((value) => !value)}
          >
            {moreOpen ? "Less" : "More"}
          </button>
        </div>

        {moreOpen ? (
          <div className="mt-4 max-h-36 overflow-y-auto rounded-md border border-[#3d3228] bg-[#1a1510]/90 p-3 text-xs leading-5 text-[#b3a48f]">
            {BRIEFING.map((paragraph) => (
              <p key={paragraph.slice(0, 32)} className="mt-2 first:mt-0">
                {paragraph}
              </p>
            ))}
          </div>
        ) : null}
      </main>
    </div>
  )
}