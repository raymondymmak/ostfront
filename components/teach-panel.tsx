"use client"

import { Button } from "@/components/ui/button"
import type { CoachHint } from "@/lib/teach/coach"
import type { TeachFeedback } from "@/lib/teach/feedback"
import type { LessonMeta } from "@/lib/teach/lessons"
import { persistenceShortLabel } from "@/lib/teach/record"

type TeachPanelProps = {
  meta: LessonMeta
  intro: string
  question: string
  variant: "guided" | "silent"
  pedagogyDisclosure: string
  reasoning: string
  onReasoning: (value: string) => void
  hints: CoachHint[]
  hintLevel: number
  onHint: () => void
  coachReply: string | null
  coachSource: string | null
  coachStance: string | null
  followUp: string | null
  onDiscussPlan: () => void
  busy: boolean
  onResolve: () => void
  feedback: TeachFeedback | null
  onSilent: () => void
  silentAvailable: boolean
}

export function TeachPanel({
  meta,
  intro,
  question,
  variant,
  reasoning,
  onReasoning,
  hints,
  hintLevel,
  onHint,
  pedagogyDisclosure,
  coachReply,
  coachSource,
  coachStance,
  followUp,
  onDiscussPlan,
  busy,
  onResolve,
  feedback,
  onSilent,
  silentAvailable,
}: TeachPanelProps) {
  const nextHint = hints.find((item) => item.level === hintLevel + 1)

  return (
    <aside
      className="flex min-h-0 flex-col border-l border-border bg-background"
      data-testid="teach-panel"
      data-teach-variant={variant}
    >
      <div className="border-b border-border px-4 py-3">
        <p className="text-xs tracking-wide text-muted-foreground uppercase">Teaching drill</p>
        <h2 className="font-display text-xl leading-tight">{meta.title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{intro}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm leading-6">
        <p className="font-medium" data-testid="teach-question">
          {question}
        </p>
        {variant === "guided" && (
          <div className="mt-3 space-y-2" data-testid="teach-hints">
            {hints
              .filter((item) => item.level <= hintLevel)
              .map((hint) => (
                <p key={hint.level} className="rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs">
                  <span className="font-medium">Hint {hint.level}. </span>
                  {hint.text}
                </p>
              ))}
            {nextHint && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="teach-request-hint"
                disabled={busy}
                onClick={onHint}
              >
                Request hint {nextHint.level}
              </Button>
            )}
          </div>
        )}
        {variant === "silent" && (
          <p className="mt-3 text-xs text-muted-foreground" data-testid="teach-silent-banner">
            Coach is silent until after you resolve. Plan on the map and state your reasoning. After resolve,
            the server reports whether your attempt was stored privately — only when that write is verified.
          </p>
        )}
        {variant === "guided" && (
          <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs" data-testid="teach-pedagogy-notice">
            {pedagogyDisclosure}
          </p>
        )}
        <label className="mt-4 block text-xs font-medium text-muted-foreground" htmlFor="teach-reasoning">
          Your reasoning
        </label>
        <textarea
          id="teach-reasoning"
          data-testid="teach-reasoning"
          className="mt-1 min-h-[4.5rem] w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          value={reasoning}
          onChange={(event) => onReasoning(event.target.value)}
          placeholder="A sentence on why you chose this plan…"
          disabled={Boolean(feedback) || busy}
        />
        {variant === "guided" && !feedback && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            data-testid="teach-discuss-plan"
            disabled={busy || !reasoning.trim()}
            onClick={onDiscussPlan}
          >
            Discuss my reasoning
          </Button>
        )}
        {coachReply && !feedback && (
          <div className="mt-3 space-y-1 rounded-md border border-border bg-muted/30 p-2 text-xs" data-testid="teach-coach-reply" data-coach-source={coachSource ?? undefined} data-coach-stance={coachStance ?? undefined}>
            <p>{coachReply}</p>
            {coachSource === "fallback" && (
              <p className="text-muted-foreground">Deterministic coach fallback (model unavailable or timed out).</p>
            )}
            {followUp && <p className="italic text-muted-foreground">{followUp}</p>}
          </div>
        )}
        {feedback && <TeachFeedbackBlock feedback={feedback} />}
      </div>
      <div className="border-t border-border p-3">
        {!feedback ? (
          <Button
            type="button"
            className="w-full"
            data-testid="teach-resolve"
            disabled={busy}
            onClick={onResolve}
          >
            {busy ? "Resolving…" : "Resolve this fortnight"}
          </Button>
        ) : silentAvailable && variant === "guided" ? (
          <Button type="button" className="w-full" data-testid="teach-start-silent" onClick={onSilent}>
            Continue to silent variation
          </Button>
        ) : (
          <p className="text-center text-xs text-muted-foreground">Drill complete.</p>
        )}
      </div>
    </aside>
  )
}

function TeachFeedbackBlock({ feedback }: { feedback: TeachFeedback }) {
  return (
    <div className="mt-4 space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3" data-testid="teach-feedback">
      <p className="font-display text-lg" data-feedback-kind={feedback.kind}>
        {feedback.headline}
      </p>
      {feedback.coachReply && (
        <p data-testid="teach-coach-post">{feedback.coachReply}</p>
      )}
      {feedback.paragraphs.map((line) => (
        <p key={line.slice(0, 48)}>{line}</p>
      ))}
      {feedback.attemptId && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="teach-attempt-id"
          data-record-persistence={feedback.recordPersistence}
        >
          {feedback.recordPersistenceMessage ?? (
            <>
              Attempt {feedback.attemptId} ({persistenceShortLabel(feedback.recordPersistence)})
            </>
          )}
        </p>
      )}
      <ul className="list-disc pl-4 text-xs text-muted-foreground" data-testid="teach-evidence">
        {feedback.evidence.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  )
}
