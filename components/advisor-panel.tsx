"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import type { AdvisorChatMessage } from "@/lib/gm/advisor-types"
import {
  CLIENT_ADVISOR_TIMEOUT_MS,
  type CampaignCoachResponse,
  type CoachHighlight,
} from "@/lib/gm/campaign-coach"
import { queuedToPlayerOrders, type QueuedOrder } from "@/lib/orders"
import type { GameState } from "@/lib/types"

const STORAGE_KEY = "ostfront-advisor-v1"
const HISTORY_KEEP = 16
const HISTORY_SEND = 10

function readHistory(): ChatTurn[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const stored = JSON.parse(raw) as ChatTurn[]
    if (!Array.isArray(stored)) return []
    return stored
      .filter((item) => item && (item.role === "user" || item.role === "advisor") && typeof item.content === "string")
      .slice(-HISTORY_KEEP)
      .map((item) => ({
        role: item.role,
        content: item.content,
        followUp: typeof item.followUp === "string" ? item.followUp : null,
        highlights: Array.isArray(item.highlights) ? item.highlights : undefined,
      }))
  } catch {
    return []
  }
}

const STARTERS = [
  { id: "plan", label: "What do you make of my queued plan?" },
  { id: "explain", label: "Explain the selected province." },
  { id: "review", label: "Review the last battle from the chronicle." },
] as const

type ChatTurn = AdvisorChatMessage & {
  followUp?: string | null
  highlights?: CoachHighlight[]
}

type AdvisorPanelProps = {
  open: boolean
  gameId: string | undefined
  state: GameState
  queue: QueuedOrder[]
  selectedProvinceId: string | null
  closed: boolean
  epoch: number
  onClose: () => void
  onHighlights: (highlights: CoachHighlight[]) => void
  /** When true, fill a floating window (no absolute map-corner chrome). */
  embedded?: boolean
}

function advisorErrorMessage(error: unknown, timedOut: boolean): string {
  if (timedOut) return "The staff wire timed out. Try again."
  if (error instanceof Error && error.message.trim()) return error.message
  return "I could not reach the staff wire."
}

export function AdvisorPanel({
  open,
  gameId,
  state,
  queue,
  selectedProvinceId,
  closed,
  epoch,
  onClose,
  onHighlights,
  embedded = false,
}: AdvisorPanelProps) {
  const [messages, setMessages] = useState<ChatTurn[]>(readHistory)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [offline, setOffline] = useState(false)
  const thread = useRef<HTMLDivElement>(null)
  const seenEpoch = useRef<number | null>(null)
  const askSerial = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (seenEpoch.current === null) {
      seenEpoch.current = epoch
      return
    }
    if (seenEpoch.current === epoch) return
    seenEpoch.current = epoch
    abortRef.current?.abort()
    askSerial.current += 1
    setBusy(false)
    setMessages([])
    setDraft("")
    setOffline(false)
    onHighlights([])
    try {
      window.sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* private mode */
    }
  }, [epoch, onHighlights])

  useEffect(() => {
    try {
      const slim = messages.slice(-HISTORY_KEEP).map((message) => ({
        role: message.role,
        content: message.content,
        followUp: message.followUp ?? null,
        highlights: message.highlights,
      }))
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(slim))
    } catch {
      /* ignore quota */
    }
  }, [messages])

  useEffect(() => {
    const node = thread.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [messages, busy, open])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  async function ask(text: string) {
    const question = text.trim()
    if (!question || busy) return
    if (!gameId) {
      setMessages((current) =>
        [
          ...current,
          { role: "user" as const, content: question },
          {
            role: "advisor" as const,
            content: "Start a campaign before you ask the chief of staff.",
          },
        ].slice(-HISTORY_KEEP),
      )
      return
    }
    const prior: AdvisorChatMessage[] = messages.map((message) => ({
      role: message.role,
      content: message.content,
    }))
    const userTurn: ChatTurn = { role: "user", content: question }
    const history = [...prior, userTurn].slice(-HISTORY_SEND)
    setMessages((current) => [...current, userTurn].slice(-HISTORY_KEEP))
    setDraft("")

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const serial = ++askSerial.current
    setBusy(true)
    const timeoutId = window.setTimeout(() => controller.abort(), CLIENT_ADVISOR_TIMEOUT_MS)

    try {
      const response = await fetch("/api/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId,
          expectedTurn: state.turn,
          messages: history,
          queuedOrders: queuedToPlayerOrders(queue),
          selectedProvinceId,
        }),
        signal: controller.signal,
      })
      if (serial !== askSerial.current) return
      const payload = (await response.json()) as Partial<CampaignCoachResponse> & {
        error?: string
        suggestions?: unknown
      }
      if (serial !== askSerial.current) return
      if (!response.ok || typeof payload.reply !== "string") {
        throw new Error(
          response.status === 429
            ? "The chief of staff has too many dispatches. Wait a minute."
            : response.status === 404
              ? "No campaign was found. Start a new campaign."
              : "I could not reach the staff wire.",
        )
      }
      if ("suggestions" in payload && payload.suggestions != null) {
        console.warn("[ostfront] coach returned forbidden suggestions; ignored")
      }
      const highlights = Array.isArray(payload.highlights) ? payload.highlights : []
      onHighlights(highlights)
      setOffline(Boolean(payload.unavailable))
      setMessages((current) =>
        [
          ...current,
          {
            role: "advisor" as const,
            content: payload.reply as string,
            followUp: payload.followUp ?? null,
            highlights,
          },
        ].slice(-HISTORY_KEEP),
      )
    } catch (error) {
      if (serial !== askSerial.current) return
      const timedOut = controller.signal.aborted
      setOffline(true)
      onHighlights([])
      setMessages((current) =>
        [
          ...current,
          {
            role: "advisor" as const,
            content: advisorErrorMessage(error, timedOut),
          },
        ].slice(-HISTORY_KEEP),
      )
    } finally {
      window.clearTimeout(timeoutId)
      if (serial === askSerial.current) setBusy(false)
    }
  }

  if (!open) return null

  const shellClass = embedded
    ? "flex h-full max-h-full w-full flex-col overflow-hidden bg-transparent text-ink"
    : "pointer-events-auto absolute right-3 bottom-3 z-30 flex max-h-[min(32rem,calc(100%-1.5rem))] w-[min(24rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-sm border border-leather/50 bg-paper/95 text-ink shadow-[0_12px_28px_rgba(36,28,20,0.28)]"

  return (
    <section className={shellClass} data-testid="advisor-panel" aria-label="Chief of the General Staff">
      <header className="flex items-start justify-between gap-2 border-b border-leather/30 px-3 py-2.5">
        <div>
          <p className="text-[10px] tracking-[0.14em] text-primary uppercase">OHL</p>
          <h2 className="font-display text-lg leading-none">Erich von Falkenhayn</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Campaign coach
            {offline ? " · offline" : ""}
          </p>
        </div>
        {!embedded && (
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            Hide
          </Button>
        )}
      </header>
      <div ref={thread} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3" aria-live="polite">
        {messages.length === 0 && (
          <p className="text-sm text-ink/80">
            Ask about your queued plan, a selected province, or a chronicle battle. I do not issue orders.
          </p>
        )}
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className="flex flex-col gap-1.5" data-testid="advisor-exchange">
            <p
              className={
                message.role === "user" ? "text-sm text-ink/75" : "text-sm leading-6 whitespace-pre-wrap"
              }
              data-testid={message.role === "advisor" ? "advisor-reply" : undefined}
            >
              {message.role === "user" ? `You: ${message.content}` : message.content}
            </p>
            {message.role === "advisor" && message.followUp ? (
              <p className="text-xs text-muted-foreground" data-testid="advisor-follow-up">
                {message.followUp}
              </p>
            ) : null}
            {message.role === "advisor" && message.highlights?.length ? (
              <p className="sr-only" data-testid="advisor-highlights">
                {JSON.stringify(message.highlights)}
              </p>
            ) : null}
          </div>
        ))}
        {busy && (
          <p className="text-sm text-muted-foreground" role="status">
            The chief of staff is reading the map…
          </p>
        )}
        {messages.length === 0 && (
          <div className="flex flex-col gap-2">
            {STARTERS.map((starter) => (
              <button
                key={starter.id}
                type="button"
                disabled={busy}
                data-testid={`advisor-starter-${starter.id}`}
                className="rounded-md border border-leather/40 bg-paper px-2.5 py-2 text-left text-sm hover:bg-brass/15 disabled:opacity-50"
                onClick={() => void ask(starter.label)}
              >
                {starter.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <form
        className="flex flex-col gap-2 border-t border-leather/30 p-3"
        onSubmit={(event) => {
          event.preventDefault()
          void ask(draft)
        }}
      >
        {closed && (
          <p className="text-xs text-muted-foreground">The campaign is over. I can still read the final map and chronicle.</p>
        )}
        <label className="sr-only" htmlFor="advisor-draft">
          Message to Falkenhayn
        </label>
        <textarea
          id="advisor-draft"
          data-testid="advisor-input"
          value={draft}
          rows={2}
          disabled={busy}
          placeholder={closed ? "Ask about the final map." : "Ask the chief of staff."}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              void ask(draft)
            }
          }}
          className="w-full resize-none rounded-md border border-leather/40 bg-paper px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-brass"
        />
        <Button type="submit" size="sm" disabled={busy || !draft.trim()} data-testid="advisor-send">
          Send
        </Button>
      </form>
    </section>
  )
}
