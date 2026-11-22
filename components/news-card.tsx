"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import Image from "next/image"
import { NewsMapVignette } from "@/components/news-map-vignette"
import { Button } from "@/components/ui/button"
import { photoSrc } from "@/lib/news/images"
import {
  handleNewsFocusTrapKeydown,
  refocusIntoContainer,
} from "@/lib/news/modal-focus"
import { newsEscapeDismissesQueue } from "@/lib/news/overlay-stack"
import type { NewsEvent } from "@/lib/news/types"
import { FACTION_LABEL } from "@/lib/format"

type NewsCardQueueProps = {
  events: NewsEvent[]
  onDone: () => void
}

export function NewsCardQueue({ events, onDone }: NewsCardQueueProps) {
  const [index, setIndex] = useState(0)
  const overlayRef = useRef<HTMLDivElement>(null)
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  const advance = useCallback(() => {
    if (index >= events.length - 1) onDone()
    else setIndex((value) => value + 1)
  }, [events.length, index, onDone])

  const skipAll = useCallback(() => {
    onDone()
  }, [onDone])

  useEffect(() => {
    if (!events.length) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [events.length])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const overlay = overlayRef.current
      if (overlay && handleNewsFocusTrapKeydown(event, overlay)) return
      if (event.key === "Enter") {
        event.preventDefault()
        advance()
      }
      if (newsEscapeDismissesQueue(event.key, true)) {
        event.preventDefault()
        event.stopPropagation()
        skipAll()
      }
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [advance, skipAll])

  useEffect(() => {
    if (!events.length) return
    const onFocusIn = (event: FocusEvent) => {
      const overlay = overlayRef.current
      if (!overlay) return
      refocusIntoContainer(overlay, event.target)
    }
    document.addEventListener("focusin", onFocusIn, true)
    return () => document.removeEventListener("focusin", onFocusIn, true)
  }, [events.length, index])

  if (!events.length || !mounted) return null
  const event = events[index]!
  const ordinal = index + 1
  const total = events.length

  const overlay = (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[250] flex items-center justify-center bg-leather/55 p-3 backdrop-blur-[2px] sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="news-card-headline"
      data-testid="news-card-overlay"
    >
      <article
        className="flex max-h-[min(92dvh,760px)] w-full max-w-[min(100%,22rem)] flex-col overflow-hidden rounded-sm border border-leather/50 bg-paper text-ink shadow-[0_18px_40px_rgba(36,28,20,0.35)] sm:max-w-md"
        data-testid="news-card"
      >
        <header className="shrink-0 border-b border-leather/25 bg-paper-deep px-3 py-2 sm:px-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] tracking-[0.2em] text-primary uppercase">Front communiqué</p>
              <p className="text-xs text-muted-foreground">
                {FACTION_LABEL[event.faction]} · Fortnight {event.turn + 1}
              </p>
            </div>
            <p className="text-xs font-medium text-primary" data-testid="news-card-counter">
              {ordinal} of {total}
            </p>
          </div>
        </header>
        <div className="relative h-[min(32dvh,11.5rem)] w-full shrink-0 overflow-hidden border-b border-border bg-muted sm:h-[min(34dvh,12.5rem)]">
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
              <NewsMapVignette image={event.image} faction={event.faction} />
            </div>
          )}
        </div>
        <div className="shrink-0 space-y-1.5 px-3 py-2.5 sm:space-y-2 sm:px-4 sm:py-3">
          <h2
            id="news-card-headline"
            className="font-display text-xl leading-tight text-ink sm:text-2xl"
          >
            {event.headline}
          </h2>
          <p className="text-xs leading-snug text-ink/85 sm:text-sm">{event.lore}</p>
          {event.lossesLine ? (
            <p
              className="text-[11px] font-medium tracking-wide text-primary sm:text-xs"
              data-testid="news-card-losses"
            >
              {event.lossesLine}
            </p>
          ) : null}
          {event.image.type === "photo" && (
            <p className="line-clamp-1 text-[10px] leading-4 text-muted-foreground">{event.image.credit}</p>
          )}
        </div>
        <footer className="mt-auto flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2.5 sm:px-4 sm:py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            data-testid="news-skip-all"
            onClick={skipAll}
          >
            Skip all
          </Button>
          <Button type="button" size="sm" data-testid="news-onward" onClick={advance} autoFocus>
            Onward
          </Button>
        </footer>
      </article>
    </div>
  )

  return createPortal(overlay, document.body)
}
