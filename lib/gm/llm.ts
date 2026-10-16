import { GMTurnSchema, GM_JSON_SCHEMA } from "@/lib/schema"
import type { GameState, GMTurn, PlayerOrder } from "@/lib/types"

const SYSTEM = `You are the game master of a World War I operational game on the Eastern Front in 1915. The map state is authoritative. You narrate and propose. A deterministic engine accepts or rejects every proposal. You do not roll dice and you do not describe results.

The human player commands the Central Powers. You command Russia and the friction of the war: events, small supply or unrest shocks, and diplomacy. Do not propose move, attack, or fortify actions for Central Powers formations. The engine inserts the player's orders itself. You may propose Russian moves, attacks, and fortify actions, plus modify proposals.

Respect these limits so the engine does not reject you:
- move: {"type":"move","unit":"<unit id>","to":"<province id>"} only along neighbors, only into a province Russia controls, only if that unit's current province has supply >= 30.
- attack: {"type":"attack","from":"<province id>","target":"<province id>","units":["<unit id>"]} from and target are neighbors, target is not Russian-controlled, every unit is in from, supply at from >= 30.
- fortify: {"type":"fortify","province":"<province id>"} only where Russia has a unit, supply >= 40, and fort < 3.
- modify: {"type":"modify","province":"<province id>","field":"unrest"|"supply","delta":<number>,"reason":"<short>"} Delta must be between -20 and 20.
- events: partisans, strike, epidemic, or breakthrough, each with a real province id.
Use only ids from the state digest. narration is two short paragraphs, present tense, staff-college prose, about intentions. diplomacy is zero to two short sentences. Return one JSON object and no markdown.`

export async function llmAiTurn(
  state: GameState,
  orders: PlayerOrder[],
): Promise<GMTurn> {
  const key = process.env.LLM_API_KEY
  if (!key) throw new Error("LLM_API_KEY is not set")
  const base = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  )
  const model = process.env.LLM_MODEL || "gpt-4o-mini"
  const user = [
    digest(state),
    "",
    "Player orders (the engine will add the legal ones; do not repeat Central Powers moves):",
    JSON.stringify(orders),
    "",
    "JSON schema:",
    JSON.stringify(GM_JSON_SCHEMA),
  ].join("\n")

  let lastError = "unknown error"
  for (const responseFormat of [schemaFormat(), { type: "json_object" }]) {
    try {
      return await complete(base, key, model, user, responseFormat)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  throw new Error(lastError)
}

async function complete(
  base: string,
  key: string,
  model: string,
  user: string,
  responseFormat: unknown,
): Promise<GMTurn> {
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: 1800,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
      response_format: responseFormat,
    }),
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`LLM HTTP ${response.status}: ${body.slice(0, 240)}`)
  }
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const content = payload.choices?.[0]?.message?.content
  if (!content) throw new Error("LLM returned an empty message")
  const parsed = JSON.parse(stripFence(content))
  const result = GMTurnSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(
      `LLM JSON failed validation: ${result.error.issues
        .map((issue) => issue.message)
        .slice(0, 4)
        .join("; ")}`,
    )
  }
  return result.data
}

function schemaFormat() {
  return {
    type: "json_schema",
    json_schema: {
      name: "gm_turn",
      strict: false,
      schema: GM_JSON_SCHEMA,
    },
  }
}

function stripFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

function digest(state: GameState): string {
  const lines = state.provinces.map((province) => {
    const units = province.units
      .map(
        (unit) =>
          `${unit.id} (${unit.name}, ${unit.kind}, ${unit.faction}, str ${unit.strength}, mor ${unit.morale})`,
      )
      .join("; ")
    return [
      province.id,
      province.name,
      province.terrain,
      `owner ${province.owner}`,
      `ctrl ${province.controller}`,
      `sup ${province.supply}`,
      `unr ${province.unrest}`,
      `fort ${province.fort}`,
      province.depot ? `depot ${province.depot}` : "",
      `neigh ${province.neighbors.join(",")}`,
      `rail ${province.rail.join(",") || "-"}`,
      `units ${units || "none"}`,
    ]
      .filter(Boolean)
      .join(" | ")
  })
  return [`Date: ${state.date}`, `Turn index: ${state.turn}`, ...lines].join("\n")
}
