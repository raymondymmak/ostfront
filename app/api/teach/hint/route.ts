import {
  enforceTurnGuards,
  readBodyWithLimit,
  turnGuardConfig,
} from "@/lib/api/turn-guard"
import { coachHints } from "@/lib/teach/coach"
import { authoritativeLessonState, lessonMeta } from "@/lib/teach/lessons"
import { TeachHintRequestSchema } from "@/lib/schema"

export const maxDuration = 30

export async function POST(request: Request) {
  const { maxBody } = turnGuardConfig()
  const raw = await readBodyWithLimit(request, maxBody)
  if (!raw.ok) {
    return Response.json({ error: raw.error }, { status: raw.status })
  }

  const guard = enforceTurnGuards(request, new TextEncoder().encode(raw.text).byteLength)
  if (!guard.ok) {
    return Response.json({ error: guard.error }, { status: guard.status })
  }

  let body: unknown
  try {
    body = JSON.parse(raw.text)
  } catch {
    return Response.json({ error: "The hint request was not valid JSON." }, { status: 400 })
  }

  const parsed = TeachHintRequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: "Invalid hint request." }, { status: 400 })
  }

  const state = authoritativeLessonState(parsed.data.lessonId, parsed.data.variant)
  const meta = lessonMeta(parsed.data.lessonId, parsed.data.variant)
  const hints = coachHints(meta, state, parsed.data.variant)
  const hint = hints.find((item) => item.level === parsed.data.level) ?? null

  if (!hint) {
    return Response.json({ error: "No hint at that level." }, { status: 404 })
  }

  return Response.json({ hint })
}
