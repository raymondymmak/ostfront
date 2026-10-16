# Ostfront 1915

A map-first weekend prototype of the Eastern Front in June 1915. You command the Central Powers. Russia is played by a game master that narrates the fortnight and proposes structured changes. The map is the source of truth: a deterministic rules engine accepts or rejects every proposal, then resolves movement, combat, supply, and unrest.

## Run

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:4179](http://127.0.0.1:4179).

Other scripts:

- `npm test` — rules-engine tests (move legality, supply pathing, combat, clamping, the opening scenario).
- `npm run lint` — ESLint.
- `npm run map` — print the neighbor graph and any rail pairs that do not share a border.
- `npm run build` — production build.

## Game master

Copy `.env.example` to `.env.local` if you want a live model:

```
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

`LLM_BASE_URL` is any OpenAI-compatible chat-completions endpoint. The request asks for JSON Schema output, then falls back to `json_object`. The reply is parsed with Zod. With no `LLM_API_KEY`, or if the call fails, a staff simulation writes the Russian proposals so the game stays playable offline.

The model may narrate and propose Russian moves, attacks, fortifications, unrest or supply modifiers, and province events. It is not allowed to order Central Powers units. Those come from you. The engine drops any proposal that tries.

## How a turn works

1. You write a directive, queue arrows on the map, or use the neighbor buttons.
2. Text is parsed into `move`, `attack`, and `fortify` proposals. Structured orders pass through as written.
3. The game master returns narration, proposals, events (`partisans`, `strike`, `epidemic`, `breakthrough`), and a diplomacy line.
4. `resolveTurn` clones the state, decays temporary supply, recomputes supply, applies proposals in order, applies events, recomputes supply, then applies occupation unrest and attrition.
5. Rejected proposals stay in the chronicle with the reason.

The situation is saved in `localStorage` under `ostfront-1915-v1`. Restarting the campaign clears it. A save whose province count is not 40 is discarded.

## Opening, 4 June 1915

Each turn is a fortnight. The first date is 4 June 1915, two days after the recapture of Przemyśl.

Warsaw is Russian-held and is Russia's depot, which matches the front after the 1914 retreat from Poland. Königsberg is the German depot. Two extra railheads keep both wings supplied: Kraków for the Austro-Hungarian South, and Rovno for the Russian South-West Front. A depot feeds only its own faction, and only while that faction controls it. Taking Warsaw starves Russia. It does not feed the Central Powers.

`owner` is the 1914 sovereign, used for occupation unrest. `controller` is who holds the ground. Lemberg, Stanislav, and Tarnopol are Austrian homeland under Russian control, so they start with unrest. Przemyśl is Central Powers, fort level 2.

The campaign that can actually move is Galicia. The Tarnów group must march to Przemyśl before it can attack Lemberg, because only Przemyśl borders Lemberg on your side. A typed order `Attack Lemberg.` commits the Przemyśl assault group alone, at poor odds. The panel shows those odds before you close the fortnight. The second axis is Kraków–Kielce–Radom–Warsaw. East Prussia is long and thin on supply.

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
lib/data        province centers, rails, Voronoi graph, opening order of battle
lib/engine      supply, combat, resolveTurn
lib/gm          text orders, mock staff, OpenAI-compatible game master
lib/schema.ts   Zod models and the JSON Schema sent to the model
app/api/turn    POST { state, orders } → { state, record }
components      map, orders, province, chronicle
```

`Province`, `Unit`, `Proposal`, and `GMTurn` live in `lib/types.ts`. Geometry is not stored in the save. The client joins each province to the catalog polygon. The server rebinds neighbors and rails from the catalog before resolving a turn, so a tampered save cannot invent borders.

The map is MapLibre, with a blank style and no remote tiles. Its worker is served from `public/maplibre-gl-worker.mjs`. Each painted frame is copied onto a normal canvas so the front is still visible in browsers that will not composite a WebGL canvas. If WebGL cannot paint at all, the same polygons are drawn as SVG.

## Add a province

1. Add a `ProvinceDef` in `lib/data/definitions.ts`: `id`, `name`, `lon`, `lat`, `terrain`, `owner`, `controller`, `fort`, and optionally `depot`, `unrest`, and `aliases`. Neighbors and the polygon come from the Voronoi of these points. Adjacencies longer than 1.66 projected degrees are dropped so the bounding box does not create teleports.
2. Add rail pairs in `lib/data/rails.ts`. A pair is kept only when the two provinces share a border. `npm run map` lists gaps.
3. Place units in `PLACEMENTS` in `lib/data/scenario.ts`.
4. Run `npm test` and `npm run map`. A new province count makes old `localStorage` saves reset on their own, because a save is kept only when it has 40 provinces. If you want a different count to persist, change that check in `lib/storage.ts`.
