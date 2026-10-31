"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  advisorCardAction,
  type AdvisorCard,
  type AdvisorChatMessage,
  type AdvisorOrder,
  type AdvisorResponse,
} from "@/lib/gm/advisor-types"
import { refreshAdvisorCards } from "@/lib/gm/advisor-cards"
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
      .map((item) => ({ role: item.role, content: item.content }))
  } catch {
    return []
  }
}

const STARTERS = [
  { id: "weakest", label: "Where is the Russian line weakest?" },
  { id: "fortnight", label: "What should I do this fortnight?" },
] as const

type ChatTurn = AdvisorChatMessage & {
  suggestions?: AdvisorCard[]
}

type AdvisorPanelProps = {
  open: boolean
  state: GameState
  queue: QueuedOrder[]
  closed: boolean
  epoch: number
  onClose: () => void
  onAccept: (orders: AdvisorOrder[], mode: "accept" | "override") => { ok: boolean; reason?: string }
}

export function AdvisorPanel({ open, state, queue, closed, epoch, onClose, onAccept }: AdvisorPanelProps) {
  const [messages, setMessages] = useState<ChatTurn[]>(readHistory)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [offline, setOffline] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const thread = useRef<HTMLDivElement>(null)
  const seenEpoch = useRef<number | null>(null)
  const seenTurn = useRef(state.turn)
  const seenOver = useRef(Boolean(state.result))
  const over = Boolean(state.result)

  useEffect(() => {
    if (seenEpoch.current === null) {
      seenEpoch.current = epoch
      return
    }
    if (seenEpoch.current === epoch) return
    seenEpoch.current = epoch
    setMessages([])
    setDraft("")
    setOffline(false)
    setNotice(null)
    try {
      window.sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* private mode */
    }
  }, [epoch])

  useEffect(() => {
    if (seenTurn.current === state.turn && seenOver.current === over) return
    seenTurn.current = state.turn
    seenOver.current = over
    setMessages((current) =>
      current.map((message) => (message.suggestions ? { ...message, suggestions: undefined } : message)),
    )
  }, [state.turn, over])

  const queuedOrders = queuedToPlayerOrders(queue)

  useEffect(() => {
    try {
      const slim = messages.slice(-HISTORY_KEEP).map((message) => ({
        role: message.role,
        content: message.content,
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

  if (!open) return null

  async function ask(text: string) {
    const question = text.trim()
    if (!question || busy) return
    const prior: AdvisorChatMessage[] = messages.map((message) => ({
      role: message.role,
      content: message.content,
    }))
    const userTurn: ChatTurn = { role: "user", content: question }
    const history = [...prior, userTurn].slice(-HISTORY_SEND)
    setMessages((current) => [...current, userTurn].slice(-HISTORY_KEEP))
    setDraft("")
    setNotice(null)
    setBusy(true)
    try {
      const response = await fetch("/api/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state,
          messages: history,
          queuedOrders: queuedToPlayerOrders(queue),
        }),
        signal: AbortSignal.timeout(25_000),
      })
      const payload = (await response.json()) as Partial<AdvisorResponse> & { error?: string }
      if (!response.ok || typeof payload.reply !== "string") {
        throw new Error(
          response.status === 429
            ? "The chief of staff has too many dispatches. Wait a minute."
            : "The chief of staff is unavailable offline.",
        )
      }
      const suggestions = over || payload.ordersClosed ? [] : payload.suggestions ?? []
      setOffline(Boolean(payload.unavailable))
      setMessages((current) =>
        [
          ...current,
          {
            role: "advisor" as const,
            content: payload.reply as string,
            suggestions,
          },
        ].slice(-HISTORY_KEEP),
      )
    } catch {
      setOffline(true)
      setMessages((current) =>
        [
          ...current,
          {
            role: "advisor" as const,
            content: "The chief of staff is unavailable offline.",
          },
        ].slice(-HISTORY_KEEP),
      )
    } finally {
      setBusy(false)
    }
  }

  function fileCard(messageIndex: number, card: AdvisorCard, mode: "accept" | "override") {
    const orders = [card.order, ...(card.companions ?? [])]
    const result = onAccept(orders, mode)
    if (result.ok) {
      setNotice(null)
      dismiss(messageIndex, card.id)
      return
    }
    setNotice(result.reason ?? "Nothing was filed.")
    setMessages((current) =>
      current.map((message, index) =>
        index === messageIndex && message.suggestions
          ? { ...message, suggestions: refreshAdvisorCards(state, message.suggestions, queuedOrders) }
          : message,
      ),
    )
  }

  function dismiss(messageIndex: number, cardId: string) {
    setMessages((current) =>
      current.map((message, index) =>
        index === messageIndex
          ? { ...message, suggestions: message.suggestions?.filter((card) => card.id !== cardId) }
          : message,
      ),
    )
  }

  return (
    <section
      className="pointer-events-auto absolute right-3 bottom-3 z-30 flex max-h-[min(32rem,calc(100%-1.5rem))] w-[min(24rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-lg border border-[#c6a15a]/45 bg-[#241c14]/95 text-[#f3e2a8] shadow-lg"
      data-testid="advisor-panel"
      aria-label="Chief of the General Staff"
    >
      <header className="flex items-start justify-between gap-2 border-b border-[#c6a15a]/30 px-3 py-2.5">
        <div>
          <p className="text-[10px] tracking-[0.14em] text-[#c6a15a] uppercase">OHL</p>
          <h2 className="font-display text-lg leading-none">Erich von Falkenhayn</h2>
          <p className="mt-1 text-xs text-[#f3e2a8]/70">
            Chief of the General Staff
            {offline ? " · offline" : ""}
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          Hide
        </Button>
      </header>
      {notice && (
        <p className="border-b border-[#c6a15a]/30 px-3 py-2 text-xs text-[#f3e2a8]" role="status" data-testid="advisor-notice">
          {notice}
        </p>
      )}
      <div ref={thread} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3" aria-live="polite">
        {messages.length === 0 && (
          <p className="text-sm text-[#f3e2a8]/80">
            May to July 1915. I read the map the engine gives me. I do not issue orders, and I have not seen the Russian ones.
          </p>
        )}
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className="flex flex-col gap-2">
            <p
              className={
                message.role === "user"
                  ? "text-sm text-[#f3e2a8]/75"
                  : "text-sm leading-6 whitespace-pre-wrap"
              }
              data-testid={message.role === "advisor" ? "advisor-reply" : undefined}
            >
              {message.role === "user" ? `You. ${message.content}` : message.content}
            </p>
            {refreshAdvisorCards(state, message.suggestions ?? [], queuedOrders).map((card) => {
              const action = advisorCardAction(card)
              return (
              <article
                key={card.id}
                className="rounded-md border border-[#c6a15a]/35 bg-[#1a140e]/80 p-2.5"
                data-testid="advisor-suggestion"
                data-advisor-state={card.queue}
              >
                <p className="text-sm">{card.label}</p>
                {card.queue === "duplicate" && (
                  <p className="mt-1 text-xs text-[#f3e2a8]/75" data-testid="advisor-queue">
                    Already queued
                  </p>
                )}
                {card.queue === "conflict" && card.conflict && (
                  <p className="mt-1 text-xs text-[#f3e2a8]/75" data-testid="advisor-queue">
                    Conflicts with: {card.conflict}
                  </p>
                )}
                {card.valid && card.detail && (
                  <p className="mt-1 text-xs text-[#f3e2a8]/75" data-testid="advisor-odds">
                    {card.detail}
                  </p>
                )}
                {card.depotWarning && (
                  <p className="mt-1 text-xs text-[#e0a15a]" data-testid="advisor-depot-warning">
                    {card.depotWarning}
                  </p>
                )}
                {!card.valid && card.note && (
                  <p className="mt-1 text-xs text-[#e07a6a]">The engine rejects this. {card.note}</p>
                )}
                <div className="mt-2 flex gap-2">
                  {action === "accept" && !closed && (
                    <Button
                      type="button"
                      size="xs"
                      data-testid="advisor-accept"
                      onClick={() => fileCard(index, card, "accept")}
                    >
                      {card.companions?.length ? "Accept all" : "Accept"}
                    </Button>
                  )}
                  {action === "override" && !closed && (
                    <Button
                      type="button"
                      size="xs"
                      data-testid="advisor-override"
                      onClick={() => fileCard(index, card, "override")}
                    >
                      Override
                    </Button>
                  )}
                  {action === "disabled" && !closed && (
                    <Button type="button" size="xs" data-testid="advisor-accept" disabled>
                      Accept
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    data-testid="advisor-dismiss"
                    onClick={() => dismiss(index, card.id)}
                  >
                    Dismiss
                  </Button>
                </div>
              </article>
              )
            })}
          </div>
        ))}
        {busy && (
          <p className="text-sm text-[#f3e2a8]/70" role="status">
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
                className="rounded-md border border-[#c6a15a]/35 px-2.5 py-2 text-left text-sm hover:bg-[#c6a15a]/10 disabled:opacity-50"
                onClick={() => void ask(starter.label)}
              >
                {starter.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <form
        className="flex flex-col gap-2 border-t border-[#c6a15a]/30 p-3"
        onSubmit={(event) => {
          event.preventDefault()
          void ask(draft)
        }}
      >
        {closed && (
          <p className="text-xs text-[#f3e2a8]/70">
            The campaign is over. I can still read the final map. Suggestions are closed.
          </p>
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
          className="w-full resize-none rounded-md border border-[#c6a15a]/35 bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-[#f3e2a8]/40 focus-visible:border-[#c6a15a]"
        />
        <Button type="submit" size="sm" disabled={busy || !draft.trim()}>
          Send
        </Button>
      </form>
    </section>
  )
}
