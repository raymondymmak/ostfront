
# Ostfront 1915

A map-first weekend prototype of the Eastern Front in June 1915. You command the Central Powers. Russia is played by a game master that narrates the fortnight and proposes structured changes. The map is the source of truth: a deterministic rules engine accepts or rejects every proposal, then resolves movement, combat, supply, and unrest.

## Run

Requires **Node.js 22+** (see `engines` in `package.json` and `.nvmrc`).

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (Next.js default port).

Other scripts:

- `npm test` — rules engine, game-master routing, and turn API guard tests.
- `npm run lint` — ESLint.
- `npm run map` — print the neighbor graph and any rail pairs that do not share a border.
- `npm run build` — production build.

## Game master

Copy `.env.example` to `.env.local` if you want a live model:

```
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
LLM_MODEL_STRONG=          # optional; used for important turns and one retry
```

`LLM_BASE_URL` is any OpenAI-compatible chat-completions endpoint (including [OpenRouter](https://openrouter.ai/) when pointed at their `/api/v1` base). Optional `LLM_HTTP_REFERER` and `LLM_HTTP_TITLE` headers are sent when set (some providers expect them).

The game master prompt puts static rules and the JSON schema in the **system** message and the live map digest plus player orders in the **user** message so providers can cache the prefix.

**Model routing:** each turn is classified (`routine`, `important`, or `critical`) from player orders—depots, fortresses, attack count, and order volume (`lib/gm/tier.ts`, tunable weights). With `LLM_MODEL_STRONG` set, important and critical turns call the strong model first; routine turns start on `LLM_MODEL`. Otherwise everything uses the cheap model as before. After a cheap reply, the server may retry **once** on the strong model if Zod validation fails or more than 30% of merged proposals would be rejected by the rules engine. There is no further loop; failures fall back to the mock staff. A ~28s wall clock caps both calls so serverless timeouts stay predictable (each call uses at most ~14s).

Each model call logs one JSON line to stdout (`ostfront.gm.call`: tier, model, latency, outcome, escalation, rejection stats). No API keys or full prompts are logged.

With no `LLM_API_KEY`, or if all model attempts fail, a staff simulation writes the Russian proposals so the game stays playable offline.

The model may narrate and propose Russian moves, attacks, fortifications, unrest or supply modifiers, and province events. It is not allowed to order Central Powers units. Those come from you. The engine drops any proposal that tries.

## How a turn works

1. You write a directive, queue arrows on the map, or use the neighbor buttons.
2. Text is parsed into `move`, `attack`, and `fortify` proposals. Structured orders pass through as written.
3. The game master returns narration, proposals, events (`partisans`, `strike`, `epidemic`, `breakthrough`), and a diplomacy line.
4. `resolveTurn` clones the state, decays temporary supply, recomputes supply, applies proposals in order, applies events, recomputes supply, then applies occupation unrest and attrition.
5. Rejected proposals stay in the chronicle with the reason.

The situation is saved in `localStorage` under `ostfront-1915-v1`. Restarting the campaign clears it. A save whose province ids no longer match the catalog is discarded; otherwise units and state are rebound to the current borders and rails.

## Opening, 4 June 1915

Each turn is a fortnight. The first date is 4 June 1915, two days after the recapture of Przemyśl.

Warsaw is Russian-held and is Russia's depot. Königsberg and Kraków are Central Powers depots, and Lemberg is the Austrian forward depot. Kraków still contains Tarnów, Rzeszów, and Przemyśl as one Hearts of Iron IV state. Rovno, inside Volhynia, is the Russian forward railhead. A depot feeds only its own faction, and only while that faction controls it. Taking Warsaw starves Russia. It does not feed the Central Powers.

`owner` is the 1914 sovereign that holds most of the state, used for occupation unrest. `controller` is who holds the ground on 4 June 1915. Katowice is German. Lemberg, Stanislav, and Bukovina are Austrian and already cleared, so they start at home with no unrest. The Russian line in the south is Lublin, Volhynia, and Podolia. These four corrections live in `OWNER_OVERRIDES` in `scripts/build-hoi4-theater.py` and in `lib/data/definitions.ts`.

Formations are spread along the front instead of stacked in one state. Kraków holds the garrison, the Beskiden corps, and the Przemyśl group. Mackensen's artillery and the Guard are in Lemberg. A typed order `Attack Lublin.` commits the best supplied neighbor. The second axis is Kielce–Warsaw; Radom sits in Kielce. East Prussia is Königsberg plus Ermland-Masuren. Pomorze is the 1914 West Prussia state (the map source labels it Gdynia).

On the first fortnight the Russian staff only digs. Later they attack when local odds are at least 1.25, and they do not abandon the last unit on an enemy border.

## Rules

- A unit moves only along a neighbor edge, and only into a friendly province. Entering an enemy province is an attack.
- A unit in a province with supply below 30 cannot advance or attack. A unit may receive one order per turn.
- Combat is `attacker strength × morale × arm modifier × supply` against `defender strength × terrain × fort × supply`, times a d6 from 0.82 to 1.17. The attacker wins when attack × variance / defense is at least 1. An empty province is occupied without losses. On a win, survivors move in and the defenders retreat to the friendly neighbor with the most supply, or are destroyed. Control flips. Occupying a province you do not own raises unrest by 12.
- Terrain defense: plains 1, forest 1.25, urban 1.3, marsh 1.4, mountain 1.55. Each fort level adds 22 percent. Artillery hits harder on the attack and is slightly weaker in defense. Cavalry is better on the plains and worse in forest, marsh, and mountain.
- `modify` deltas are clamped to ±20 per province per field per turn. A larger request is applied at the cap and logged as clamped. A further change after the budget is spent is rejected. Unrest stays inside 0–100. A supply change adjusts a temporary modifier (stored between −40 and +40), then supply is recomputed from the rails. The modifier decays by 10 toward zero at the start of each turn.
- Fortify needs supply of at least 40, a friendly unit, and a fort below 3. One fortify per province per turn.
- Supply is a multi-source Dijkstra to your own controlled depots. Rail edges cost 1. A road costs the terrain of the province entered: urban 2, plains 3, forest 4, mountain 5, marsh 6. Supply is `100 − path cost × 11`, plus the modifier, clamped to 0–100. Unreachable provinces are at 0.
- At the end of the turn, unrest rises by 5 where the controller is not the owner, and falls by 3 at home. Supply below 25 adds 4 unrest. Unrest of 85 or more costs 4 strength. Units under strength 5, or at morale 0, are removed.

Combat dice use a seeded mulberry32 generator (`19150604 + turn × 9973`), so the same orders replay the same battles.

## Architecture

```
lib/data        province catalog, theater geometry, rails, opening order of battle
lib/engine      supply, combat, resolveTurn
lib/gm          text orders, mock staff, OpenAI-compatible game master
lib/schema.ts   Zod models and the JSON Schema sent to the model
app/api/turn    POST { state, orders } → { state, record }
components      map, orders, province, chronicle
```

`Province`, `Unit`, `Proposal`, and `GMTurn` live in `lib/types.ts`. Geometry is not stored in the save. The client joins each province to the catalog polygon. The server rebinds neighbors and rails from the catalog before resolving a turn, so a tampered save cannot invent borders.

The map is MapLibre, with a blank style and no remote tiles. Its worker is served from `public/maplibre-gl-worker.mjs`. Each painted frame is copied onto a normal canvas so the front is still visible in browsers that will not composite a WebGL canvas. If WebGL cannot paint at all, the same polygons are drawn as SVG.

**Map data:** Playable province shapes and adjacency live in `lib/data/theater-geometry.json`. The states are Hearts of Iron IV provinces in MapChart's own pixel space, drawn flat (pixels scaled to a few pseudo-degrees around the equator). There is no real-world basemap. Lakes and the sea are the gaps between those states.

Map geometry: MapChart.net (CC BY-SA 4.0), based on Hearts of Iron IV by Paradox Interactive.

1914 owners are assigned by area from the WorldOS 1914 map, which is an input to the build and is not committed. Regenerate with the sources available locally:

```bash
HOI4_DIR=/path/to/mapchart-hoi4 WORLDOS_REGIONS=/path/to/ww1-1914-regions.geojson npm run build:theater
```

The raw SVG and the full state geojson are not committed. The script snaps shared borders, dissolves non-playable states by 1914 owner, and writes only the theater file.

The MapLibre container sits in a sized wrapper so `maplibregl-map`’s `position: relative` cannot collapse the viewport (which previously stacked labels down the page on narrow screens). Labels and strength counters use MapLibre markers anchored in map space; backdrop layers ignore pointer events.

On the map, the bottom-left legend explains faction colors, depots, and **strength counters**: the numbered pills on each province are the combined strength of all units there (blue text for Central Powers, rust for Russia). Hover a province for “Total unit strength” in the tooltip.

## Deploy to Vercel

No `vercel.json` is required. Vercel detects Next.js and runs `npm run build` with the default `next start` (it sets `PORT` for you).

1. Push this repository to GitHub (for example `raymondymmak/ostfront`).
2. In [Vercel](https://vercel.com/new), import the repo and deploy with the default framework preset.
3. Optional environment variables (Project → Settings → Environment Variables):
   - `LLM_API_KEY` — OpenAI-compatible API key for a live Russian game master.
   - `LLM_BASE_URL` — defaults to `https://api.openai.com/v1` if unset.
   - `LLM_MODEL` — defaults to `gpt-4o-mini` if unset.
   - `LLM_MODEL_STRONG` — optional stronger model for important turns and one escalation retry.
   - `LLM_HTTP_REFERER`, `LLM_HTTP_TITLE` — optional provider headers (e.g. OpenRouter).
   - **Turn API guard** (recommended before sharing a deployment that has `LLM_API_KEY`):
     - `TURN_MAX_BODY_BYTES` — default `512000`.
     - `TURN_RATE_LIMIT_MAX` / `TURN_RATE_LIMIT_WINDOW_MS` — per-IP limit per warm instance (default 24 requests / 60s).
     - `TURN_ALLOWED_ORIGINS` — comma-separated origins (e.g. `https://ostfront-two.vercel.app,http://localhost:3000`). When set, browser requests must send a matching `Origin` or `Referer` unless they present a token.
     - `TURN_API_TOKEN` — optional shared secret; send `X-Ostfront-Turn-Token` or `Authorization: Bearer …`. Required when the token is set and the origin is not on the allow list.
4. If `LLM_API_KEY` is unset, the **mock staff** runs Russian turns on the server route; the game stays fully playable.
5. Campaign state lives in the browser (`localStorage` only). The turn API does not write files on the server.

After deploy, open the production URL and play a fortnight with no env vars to confirm mock mode.

## Add a province

1. Add a `ProvinceDef` in `lib/data/definitions.ts`: `id`, `name`, `lon`, `lat`, `terrain`, `owner`, `controller`, `fort`, and optionally `depot`, `unrest`, and `aliases`.
2. Regenerate `lib/data/theater-geometry.json` with `npm run build:theater` (needs `HOI4_DIR` and `WORLDOS_REGIONS`) and commit the result.
3. Add rail pairs in `lib/data/rails.ts`. A pair is kept only when the two provinces share a border. `npm run map` lists gaps.
4. Place units in `PLACEMENTS` in `lib/data/scenario.ts`.
5. Run `npm test` and `npm run map`.
