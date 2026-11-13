# Developing Ostfront

How to run, test, and extend the Ostfront codebase. Player-facing rules are in **[docs/RULES.md](./RULES.md)**; system design in **[ARCHITECTURE.md](../ARCHITECTURE.md)**.

## Run it locally

Requires Node.js 22 or newer (`engines` in `package.json`, and `.nvmrc`).

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### npm scripts

| Command | Purpose |
| --- | --- |
| `npm test` | Vitest for the rules, Stavka, victory, and the turn API |
| `npm run typecheck` | Generate Next types, then `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run build` | Production build |

CI runs typecheck, lint (0 warnings), test, and build on every PR.

| Command | Purpose |
| --- | --- |
| `npm run llm-logs` | List Blob LLM logs when `LLM_LOG_BLOB` was enabled (`BLOB_READ_WRITE_TOKEN`) |
| `npm run map` | Neighbor graph, and rail pairs that do not share a border. |
| `npx tsx scripts/balance-sim.ts` | Scripted Central Powers opponents (greedy, frontier, sensible) through six seeds on Easy, Normal, and Hard. Clears any model key and plays against Stavka. |

## Environment

Copy `.env.example` to `.env.local` only if you want a live narrator. The game is fully playable with none of these set.

```
LLM_API_KEY=
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
LLM_MODEL_STRONG=
```

`LLM_BASE_URL` is any OpenAI-compatible chat-completions endpoint. Optional `LLM_HTTP_REFERER` and `LLM_HTTP_TITLE` are sent when set. The chief of staff uses `LLM_MODEL`, the fast model. `LLM_MODEL_STRONG` stays on important Russian diplomacy turns.

When a key is present, the server still asks Stavka for the Russian orders. The model is called only for diplomacy (and chief-of-staff chat). Turns are classed routine, important, or critical (`lib/gm/tier.ts`). With `LLM_MODEL_STRONG` set, important and critical turns try the strong model first. A cheap reply may be retried once on the strong model if validation fails or more than 30 percent of that draft’s proposals would be rejected. The wall clock for both calls is about 90 seconds (`GM_BUDGET_MS`), and each call is capped at about 45 seconds (`LLM_TIMEOUT_MS`). The turn function allows 120 seconds, and the browser waits longer than that. One JSON line is logged per call (`ostfront.gm.call`), without the key or the prompt. If the model fails, Stavka’s own diplomacy is kept.

OpenRouter calls ask for low reasoning effort and leave that trace out of the message, with a 4000-token completion cap. Invalid JSON, a schema miss, or an empty message (the budget was spent reasoning and `content` came back blank) is tried once more when about eight seconds of `GM_BUDGET_MS` remain. The player-facing debug line adds `finish length` when the reply was cut off, and token counts, including reasoning tokens, when the provider sent them.

### Campaign storage (Upstash Redis)

| Variable | Role |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL (primary on Vercel Marketplace) |
| `UPSTASH_REDIS_REST_TOKEN` | REST token |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Accepted aliases when provisioning under KV names |

Campaign keys TTL to 30 days. Without these variables, **local dev and Vitest** use an in-memory store. **Preview and production** return **503** when `VERCEL_ENV` is set and creds are missing (`lib/campaign/availability.ts`).

### Optional LLM Blob archive

Blob logging is **off by default** (saves Hobby advanced-operation quota).

| Variable | Role |
| --- | --- |
| `LLM_LOG_BLOB` | Set to `1` / `true` to upload LLM responses to private Blob |
| `LLM_LOG_BLOB_PREVIEW` | Required on preview deployments in addition to the above |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token when logging is enabled |

Console logs (`ostfront.llm.log`) always record outcomes without a Blob put.

### Turn route guard

The turn route can be guarded when a deployment has a key:

| Variable | Default / role |
| --- | --- |
| `TURN_MAX_BODY_BYTES` | `512000` |
| `TURN_RATE_LIMIT_MAX` / `TURN_RATE_LIMIT_WINDOW_MS` | Per-IP limit on a warm instance, default 24 requests / 60 seconds |
| `TURN_ALLOWED_ORIGINS` | Comma-separated origins, e.g. `https://raymondymmak-ostfront.vercel.app,http://localhost:3000` |
| `TURN_API_TOKEN` | Client sends `X-Ostfront-Turn-Token` or `Authorization: Bearer …` |

`POST /api/advisor` takes `{ state, messages, queuedOrders }` and returns the chief of staff's reply and any suggestions. It uses the same body size, rate limit, origin, and token checks. It does not write a save, and it does not resolve the turn.

## Campaign storage and APIs

Campaign state and the combat seed live on the server in **Upstash Redis** when REST credentials are set. The browser keeps only `gameId`, a render copy, and the chronicle for convenience.

| Endpoint | Body | Response |
| --- | --- | --- |
| `POST /api/new-game` | `{ difficulty }` | `{ gameId, state, log }` — server picks the seed |
| `GET /api/game?gameId=…` | — | Reload authoritative state after a refresh |
| `POST /api/turn` | `{ gameId, expectedTurn, orders }` only | Client cannot send map state or dice |

Turn commits use atomic Lua: immutable `campaign:{gameId}:turn:{n}` (`SET NX`) plus head advance in one step. Parallel close-turn requests → exactly one **200**, others **409** (`storage_conflict` or `stale_turn`). API responses strip the seed; the authoritative seed is only on `campaign:{gameId}:head`. See **ARCHITECTURE.md**.

Local dev and Vitest fall back to an in-memory store when Redis env is missing. Preview and production return **503** without Redis REST credentials on Vercel.

## Project structure

```
app/page.tsx              the game
app/api/new-game/route.ts POST { difficulty } → { gameId, state, log }
app/api/game/route.ts     GET ?gameId= → { gameId, state, log }
app/api/turn/route.ts     POST { gameId, expectedTurn, orders } → { state, record }
app/api/advisor/route.ts  POST { state, messages, queuedOrders } → advice
components/               map, orders, province, chronicle, HUD
lib/data/                 catalog, 2 May order of battle, objectives, rails, geometry
lib/engine/               supply, combat, economy, victory, resolveTurn
lib/ai/stavka.ts          Russian staff
lib/gm/                   order text, staff turn, optional diplomacy model
lib/campaign/             store, Redis keys/scripts, public state
lib/redis/                Upstash client, env, Vitest fake
lib/api/turn-guard.ts     body size, rate limit, origin, token
scripts/balance-sim.ts    scripted playthroughs
scripts/build-hoi4-theater.py
public/maplibre-gl-worker.mjs
```

`Province`, `Unit`, `Proposal`, and `GameState` live in `lib/types.ts`. Geometry is not stored in the save.

## Map geometry

The map is MapLibre with a blank style and no remote tiles. Rail edges are the same links the supply rules use, drawn between the province anchors. A link held at both ends by one side is drawn in full, tinted for that side. A link whose ends differ is dimmed and broken. The legend toggles them, on by default, and they fade out with the province labels when the map is zoomed out. Selecting a province highlights its rails. If WebGL cannot paint, the same polygons are drawn as SVG. Province shapes and adjacency are in `lib/data/theater-geometry.json`: Hearts of Iron IV states in MapChart’s pixel space, drawn flat. There is no real-world basemap.

**Attribution:** MapChart.net (CC BY-SA 4.0), based on Hearts of Iron IV by Paradox Interactive.

1914 owners are sampled from a local GeoJSON (`owner_1914`) that is not committed. Regenerate only when those sources are on the machine:

```bash
HOI4_DIR=/path/to/mapchart-hoi4 OWNER_1914_GEOJSON=/path/to/1914-regions.geojson npm run build:theater
```

Do not commit the raw Hearts of Iron IV files, the MapChart SVG, or the full state GeoJSON. The script writes only the theater file.

### Add a province

1. Add a `ProvinceDef` in `lib/data/definitions.ts`
2. Regenerate the theater file (`npm run build:theater` with sources present)
3. Add rail pairs in `lib/data/rails.ts`
4. Place units in `PLACEMENTS` in `lib/data/scenario.ts`
5. Run `npm test` and `npm run map`
