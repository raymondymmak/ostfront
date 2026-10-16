import { TurnRequestSchema } from "@/lib/schema"
import { playTurn } from "@/lib/gm"

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "The turn request was not valid JSON." }, { status: 400 })
  }

  const parsed = TurnRequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      {
        error: "The turn request did not match the game schema.",
        issues: parsed.error.issues.slice(0, 6).map((issue) => issue.message),
      },
      { status: 400 },
    )
  }

  try {
    const result = await playTurn(parsed.data.state, parsed.data.orders)
    return Response.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "The turn failed."
    return Response.json({ error: message }, { status: 500 })
  }
}
