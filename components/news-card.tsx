"use client"

import { useCallback, useEffect, useState } from "react"
import Image from "next/image"
import { NewsMapVignette } from "@/components/news-map-vignette"
import { Button } from "@/components/ui/button"
import { photoSrc } from "@/lib/news/images"
import type { NewsEvent } from "@/lib/news/types"
import { FACTION_LABEL } from "@/lib/format"

type NewsCardQueueProps = {
  events: NewsEvent[]
  onDone: () => void
}

export function NewsCardQueue({ events, onDone }: NewsCardQueueProps) {
  const [index, setIndex] = useState(0)

  const advance = useCallback(() => {
    if (index >= events.length - 1) onDone()
    else setIndex((value) => value + 1)
  }, [events.length, index, onDone])

  const skipAll = useCallback(() => {
    onDone()
  }, [onDone])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault()
        advance()
      }
      if (event.key === "Escape") {
        event.preventDefault()
        skipAll()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [advance, skipAll])

  if (!events.length) return null
  const event = events[index]!
  const remaining = events.length - index - 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="news-card-headline"
      data-testid="news-card-overlay"
    >
      <article
        className="flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-[#c6a15a]/40 bg-[#221c17] shadow-2xl"
        data-testid="news-card"
      >
        <header className="border-b border-[#c6a15a]/25 bg-[#1a140e]/90 px-4 py-2">
          <p className="text-[10px] tracking-[0.2em] text-[#c6a15a] uppercase">Front communiqué</p>
          <p className="text-xs text-muted-foreground">
            {FACTION_LABEL[event.faction]} · Fortnight {event.turn + 1}
          </p>
        </header>
        <div className="relative aspect-[16/10] w-full overflow-hidden border-b border-border bg-[#14110e]">
          {event.image.type === "photo" ? (
            <Image
              src={photoSrc(event.image.key)}
              alt=""
              fill
              className="object-cover sepia-[.35] contrast-[1.05]"
              sizes="(max-width: 480px) 100vw, 400px"
              priority
              data-testid="news-card-photo"
            />
          ) : (
            <div className="h-full w-full" data-testid="news-card-map">
              <NewsMapVignette image={event.image} />
            </div>
          )}
        </div>
        <div className="space-y-2 px-4 py-3">
          <h2 id="news-card-headline" className="font-display text-2xl leading-tight text-[#f3e2a8]">
            {event.headline}
          </h2>
          <p className="text-sm leading-snug text-[#ebe4d4]/85">{event.lore}</p>
          {event.image.type === "photo" && (
            <p className="text-[10px] leading-4 text-muted-foreground">{event.image.credit}</p>
          )}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            data-testid="news-skip-all"
            onClick={skipAll}
          >
            Skip all{remaining > 0 ? ` (${events.length})` : ""}
          </Button>
          <Button type="button" size="sm" data-testid="news-onward" onClick={advance} autoFocus>
            Onward{remaining > 0 ? ` · ${remaining} left` : ""}
          </Button>
        </footer>
      </article>
    </div>
  )
}