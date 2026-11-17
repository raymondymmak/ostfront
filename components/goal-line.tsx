"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { BRIEFING } from "@/lib/data/scenario"
import { campaignGoalLine } from "@/lib/ui/goal-copy"
import type { Difficulty } from "@/lib/types"

type GoalLineProps = {
  difficulty: Difficulty
  onDifficulty: (value: Difficulty) => void
  beginBusy: boolean
  onBegin: () => void
}

export function GoalLine({ difficulty, onDifficulty, beginBusy, onBegin }: GoalLineProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const goal = campaignGoalLine("gorlice")

  return (
    <div
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-3 py-3 shadow-lg backdrop-blur-sm sm:px-4"
      data-testid="scenario-picker"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="font-display text-lg leading-none text-primary">Gorlice–Tarnów</p>
          <p
            className="min-w-0 flex-1 text-sm font-medium text-foreground"
            data-testid="briefing-task"
          >
            {goal}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5" data-testid="difficulty">
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
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${difficulty === id ? "border-primary bg-primary/10" : "border-border"}`}
              >
                {title}
              </button>
            ))}
          </div>
          <Button type="button" size="sm" data-testid="begin-scenario" disabled={beginBusy} onClick={onBegin}>
            {beginBusy ? "Opening…" : "Begin"}
          </Button>
          <a
            href="/teach"
            className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted"
            data-testid="begin-teach"
          >
            Teaching drill
          </a>
          <button
            type="button"
            className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setMoreOpen((value) => !value)}
          >
            {moreOpen ? "Less" : "More"}
          </button>
        </div>
        {moreOpen ? (
          <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
            {BRIEFING.map((paragraph) => (
              <p key={paragraph.slice(0, 32)} className="mt-2 first:mt-0">
                {paragraph}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}