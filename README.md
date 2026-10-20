
# Ostfront 1915

A map-first operational game of the Gorlice–Tarnów offensive, 2 May to 11 July 1915. You command the Central Powers. Russia is played by a staff that narrates the fortnight and proposes structured changes. The map is the source of truth: a deterministic rules engine accepts or rejects every proposal, then resolves movement, combat, supply, and unrest.

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

## Opening, 2 May 1915

Each turn is a fortnight. The first date is 2 May 1915, the morning Mackensen's bombardment opened on the Dunajec. The offensive ends with the fortnight of 11 July, before Warsaw fell in August.

You are the Central Powers on the Dunajec. The German 11th Army (Mackensen) and the Austro-Hungarian 4th Army (Archduke Joseph Ferdinand) start in the Kraków province, which on this map also holds Gorlice, Tarnów, Rzeszów and Przemyśl. The Guard Corps and Mackensen's heavy artillery are separate counters. The 11th Army counter stands for the rest of that army: X Corps, XLI Reserve Corps, the Combined Corps and Arz's VI Corps. Radko Dimitriev's Russian 3rd Army holds Lemberg, with XXI Corps and the army artillery. X Corps is on Kielce. XXIV Corps is at Lublin. The III Caucasian Corps is the reserve at Rovno, in Volhynia. Brusilov's 8th Army is on Podolia.

Warsaw is Russian-held and is Russia's depot. Königsberg, Kraków and Lemberg are Central Powers depots. Lemberg starts under Russian occupation, so its depot does not feed Russia; recapture turns the railhead back on. Rovno, inside Volhynia, is the Russian forward railhead. A depot feeds only its own faction, and only while that faction controls it. The Carpathian flank rail runs Kraków–Stanislav–Bukovina, because the old hub at Lemberg is in Russian hands.

`owner` is the 1914 sovereign, used for occupation unrest. `controller` is who holds the province when the offensive opens. Lemberg's owner stays Austro-Hungarian and its controller is Russian, with unrest already raised. Katowice stays German. Bukovina stays Austro-Hungarian: Austrian troops had retaken it on 17 February 1915 and held it into 1916. Stanislav stays Austro-Hungarian on this map too, which is wrong for 2 May 1915 — the Russians held the city from 4 March until 8 June — and is left that way on purpose. Przemyśl was Russian from 22 March until 3 June, but it is an alias inside the Kraków state, and flipping Kraków would hand Russia the Dunajec army. The 1914 owners live in `OWNER_OVERRIDES` in `scripts/build-hoi4-theater.py`. Controllers live in `lib/data/definitions.ts`.

Lemberg is an eastern objective, worth the campaign on its own, and must be held by the fortnight of 13 June to count toward a Brilliant (the city fell on 22 June). Lublin is the pursuit. Rovno counts toward a Brilliant only if already held by the fortnight of 27 June: the city did not fall in 1915, and taking it later is still a victory. Kielce is the Russian shoulder, not an objective. Kraków is the home city: still Russian at the last fortnight, the campaign is a defeat. A second home city is not drawn. Teschen, where the Austro-Hungarian high command sat, is reachable from Kielce through Katowice, and a raid there would throw away a Galician victory. A typed order `Attack Lemberg.` commits the best supplied neighbor. The northern armies are a holding front, not a second offensive: the German 8th Army in East Prussia, the 9th Army and Woyrsch's Landwehr opposite the Polish salient, Thorn and Danzig as fortresses. Opposite them are the Russian 1st, 2nd and 10th Armies, the Grenadier Corps at Warsaw and the Kovno garrison. Borojević's 3rd Army is in Carpathian Ruthenia. Cavalry Corps Hauer screens Stanislav. Group Pflanzer-Baltin holds Bukovina. East Prussia is Königsberg plus Ermland-Masuren. Pomorze is the 1914 West Prussia state (the map source labels it Gdynia).

On Easy and Normal the first fortnight is the player's: Stavka digs and raises troops, and does not attack or redeploy. Hard Stavka is already in motion. After that they attack when local odds are good, keep a garrison on victory cities and depots, and once the front is broken they try to seal the breach instead of invading Galicia and Silesia at the same time. A second Russian province joins an attack only when no single province already has the odds. On Normal that pair has to be clearly over the line, and only to retake Russian soil. They do not abandon the last unit on an enemy border. On Hard a Russian depot keeps two formations behind.

## Rules

- A unit moves only along a neighbor edge, and only into a friendly province. Entering an enemy province is an attack.
- A unit in a province with supply below 30 cannot advance or attack. A unit may receive one order per turn.
- Combat is `attacker strength × morale × arm modifier × supply` against `defender strength × terrain × fort × supply`, times a d6 from 0.82 to 1.17. The attacker wins when attack × variance / defense is at least 1. An empty province is occupied without losses. On a win, survivors move in and the defenders retreat to the friendly neighbor with the most supply, shaken to 45 percent of what remains, or are destroyed. Control flips. Occupying a province you do not own raises unrest by 12.
- Attacks from two or more neighboring provinces against the same target, ordered by the same side in the same fortnight, are one battle and one die. Their strength is added, then multiplied by 1.12 for two directions, 1.22 for three, and 1.30 for four or more. Every prong loses the same fraction of its strength. On a win, the survivors of every prong enter the province. If the defender has no friendly neighbor left, that is an encirclement: the defender loses an extra 18 percent and the remnants cannot retreat. The odds preview says two-pronged or concentric, and so does the chronicle. Easy Stavka never has a spare attack for it. On Normal, Stavka adds a second prong only to retake Russian soil one province cannot crack. Hard may pinch a Central Powers province the same way.
- Terrain defense: plains 1, forest 1.2, urban 1.18, marsh 1.35, mountain 1.48. Each fort level adds 14 percent. Artillery hits harder on the attack and harder still against forts; it is slightly weaker in defense. A defender cut off from their depots still fights, but only at 30 percent supply. Cavalry is better on the plains and worse in forest, marsh, and mountain.
- `modify` deltas are clamped to ±20 per province per field per turn. A larger request is applied at the cap and logged as clamped. A further change after the budget is spent is rejected. Unrest stays inside 0–100. A supply change adjusts a temporary modifier (stored between −40 and +40), then supply is recomputed from the rails. The modifier decays by 10 toward zero at the start of each turn.
- Fortify needs supply of at least 40, a friendly unit, and a fort below 3. One fortify per province per turn.
- Supply is a multi-source Dijkstra to your own controlled depots. Rail edges cost 1. A road costs the terrain of the province entered: urban 2, plains 3, forest 4, mountain 5, marsh 6. Supply is `100 − path cost × 11`, plus the modifier, clamped to 0–100. Unreachable provinces are at 0.
- At the end of the turn, unrest rises by 5 where the controller is not the owner, and falls by 3 at home. Supply below 25 adds 4 unrest. Unrest of 85 or more costs 4 strength. Units under strength 5, or at morale 0, are removed.

Combat dice use a seeded mulberry32 generator (`19150502 + turn × 9973`), so the same orders replay the same battles.

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

1914 owners are sampled from a local political map (a GeoJSON with an `owner_1914` property). That file is an input to the build and is not committed. Regenerate with the sources available locally:

```bash
HOI4_DIR=/path/to/mapchart-hoi4 OWNER_1914_GEOJSON=/path/to/1914-regions.geojson npm run build:theater
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
2. Regenerate `lib/data/theater-geometry.json` with `npm run build:theater` (needs `HOI4_DIR` and `OWNER_1914_GEOJSON`) and commit the result.
3. Add rail pairs in `lib/data/rails.ts`. A pair is kept only when the two provinces share a border. `npm run map` lists gaps.
4. Place units in `PLACEMENTS` in `lib/data/scenario.ts`. The only scenario is Gorlice–Tarnów.
5. Run `npm test` and `npm run map`.
