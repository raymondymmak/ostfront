# Ostfront

Ostfront is a turn-based strategy game of the First World War’s Eastern Front, set only in the historical Gorlice–Tarnów offensive. You command the Central Powers from 2 May to 11 July 1915. Each turn is a fortnight: 2 May, 16 May, 30 May, 13 June, 27 June, and 11 July.

The design aim is a game in the manner of Call of War, with no real-time clock, and with the depth of Hearts of Iron IV in the browser.

Play it at [https://raymondymmak-ostfront.vercel.app](https://raymondymmak-ostfront.vercel.app).

## What you do

You give orders for your own formations: move along a friendly border, attack into an enemy province, fortify, or recruit. A typed directive, a map arrow, or a neighbor button all become the same orders. A unit may receive one order per turn, and a unit in a province with supply below 30 cannot advance or attack. Entering an enemy province is always an attack.

Russia is played by Stavka, a rule-based staff. The rules engine is the source of truth. It accepts or rejects every proposal, then resolves the fortnight as one simultaneous turn. Stavka writes the Russian orders and the chronicle of the fortnight from the map as it stands when the fortnight opens. It does not see the Central Powers' orders. If a model key is set, the model may replace up to two diplomacy sentences. It does not order units, and it does not decide battles. With no key, the game plays the same way.

General Erich von Falkenhayn, chief of the German General Staff, can be asked for advice from the Chief of Staff panel. He sees only the map the engine has already computed: ownership, supply, strengths, morale, rails, odds, and victory points. Attacks that converge on one province in the same fortnight are one battle, and he quotes that pooled figure. Those odds are against the garrison and the forts as they stand at the start of the fortnight. A simultaneous Russian march can leave a rear guard, empty the province, or meet the columns, and he says so. A suggestion may be the whole set. Accept puts a suggestion in the queue; Dismiss throws it away. He never changes the state, and he does not see the Russian orders for the fortnight. With no key, the panel says the chief of staff is unavailable offline and reads a short summary off the map.

## How a turn works

Both sides lock their orders from the same start-of-turn map. The order of the proposal list does not matter, and neither does which side wrote the order. The same state, orders, and seed always produce the same result. Dice are drawn in battle-key order.

1. **Digging, shocks, events, and the yards.** Fortify orders and supply or unrest shocks are applied first, so a fort dug this fortnight stands for this fortnight's battles. Game-master events share that ±20 unrest and supply budget and land before the battles. They never target Central Powers home soil. Both sides may dig. Recruiting is decided now but paid later, from the purse collected at the close, and the new formation still arrives when the fortnight closes.
2. **Marches and attacks, together.** Every move and attack is checked against the map from step 1. A formation has one order. Then the battles are fought.
3. **Supply, refit, victory.** Supply is traced again from the map after the marches. Income, refit, recruiting, and the grade of the fortnight come last. A depot or rail taken this fortnight does not feed or starve a battle that was already locked. It can drop a province under supply 30 for the next march. The chronicle says when a province was cut off this fortnight.

Conflict rules:

- **One battle.** Every attack by one side against the same province is one battle and one die, including columns that were not next to each other in the order list. Two directions multiply strength by 1.12, three by 1.22, and four or more by 1.30. If the defender has no friendly neighbor at the start of the turn, the attack is an encirclement: the defender loses an extra 18 percent, and the remnants cannot retreat. A neighbor that falls to a different battle this same fortnight is not an encirclement by itself. The remnants simply cannot go there.
- **Rear guard.** A formation ordered to attack still leaves a rear guard at half defensive strength. The column attacks at full strength. Losses from both are taken off the same formation. A formation ordered to move has left, and does not defend.
- **Meeting engagement.** Attacks that cross the same border in both directions are one clash in the open. Forts and terrain do not apply. The side whose province id comes first is the nominal attacker, so the die can swing an even fight. Neither column enters the other's province. Both fall back. The chronicle calls it a meeting engagement.
- **Empty provinces and bounces.** An attack into a province with no garrison, and nobody else marching in, occupies it without a fight. If the other side is also marching into that empty province, both columns bounce and the controller does not change.
- **Vacating.** If the garrison moves away and nobody of that side marches in, the attack finds the province empty and takes it. The garrison arrives at its own destination.
- **Late reinforcements.** A move into a friendly province does not join a battle there. If the province holds, the column enters. If it falls, the column falls back.
- **Swaps.** Two friendly columns that exchange provinces pass on the road. Opposing columns that try to exchange provinces fight a meeting engagement instead, and both fall back.

The orders panel and Falkenhayn quote odds against the garrison as it stands. They do not know whether that garrison will march, dig, or meet the attack. The chronicle is the result.

The situation is saved in the browser under `ostfront-1915-v1`. Restarting clears it. A save from another scenario is discarded. Neighbors and rails are rebound from the catalog, so a save cannot invent borders.

## Economy, recruiting, and reinforcement

Each province yields manpower and industry at the end of the fortnight when its supply is at least 30. Unrest reduces the yield, and a province held by someone other than its 1914 owner yields half. Central Powers industry is then multiplied by 1.3. Russian manpower is multiplied by 1.12 and Russian industry by 0.55, and Russian income is scaled again by difficulty: 0.62 on Easy, 0.82 on Normal, and 1.18 on Hard.

Recruiting spends that purse. A yard is a province you control, with supply of at least 60, that is either your depot or one of your own urban cities.

| Kind | Manpower | Industry | Arrives | Strength | Morale |
| --- | ---: | ---: | --- | ---: | ---: |
| Infantry corps | 6 | 3 | when this fortnight closes | 40 | 72 |
| Cavalry division | 4 | 2 | when this fortnight closes | 25 | 76 |
| Heavy artillery | 2 | 7 | in two fortnights | 25 | 74 |

Formations that did not attack, and that sit in supply of at least 50, refit automatically: up to 8 strength, at 1 manpower per 4 points. Morale recovers by 5 toward 80 even if the formation attacked.

## Victory

Eastern victory points are counted only while you hold the province.

| Objective | Points | On time for a Brilliant |
| --- | ---: | --- |
| Lemberg | 4 | by the fortnight of 13 June |
| Lublin | 2 | by the fortnight of 11 July |
| Rovno (Volhynia) | 3 | held by the fortnight of 27 June |

Nine points are available. A Brilliant outranks the point totals: it needs all three objectives on that schedule, and Kraków still yours. Otherwise, with Kraków held, 7 or more is a Decisive, 4 or more is a Victory, and 2 or more is a Marginal. Fewer than 2 is a draw. Kraków is the only home city. If it is Russian at the end of any fortnight, a Brilliant is no longer possible, even if you take it back. If Russia still holds it on 11 July, the campaign is a defeat.

Holding Lemberg, Lublin, and Rovno together ends the offensive early. On schedule, with Kraków held throughout, that is a Brilliant. Later, it is a Decisive.

Lemberg fell on 22 June 1915, inside the fortnight of 13 June. Rovno did not fall in 1915. Kielce is the Russian shoulder and is not an objective. Teschen, where the Austro-Hungarian high command sat, is not a second home: it can be reached from Kielce through Katowice.

## Concentric attacks

Two or more of your provinces attacking the same target in the same fortnight are one battle and one die. Their strength is added, then multiplied by 1.12 for two directions, 1.22 for three, and 1.30 for four or more. Every prong loses the same fraction of its strength. On a win, the survivors of every prong enter. If the defender has no friendly neighbor left, the attack is an encirclement: the defender loses an extra 18 percent, and the remnants cannot retreat.

A single attack uses the same combat, without the flank multiplier. Strength, morale, arm, terrain, forts, and supply all count, and a seeded die between 0.82 and 1.17 decides the margin. The attacker wins when attack times that die, divided by defense, is at least 1. Defense is counted as at least 8. An empty province is occupied without a fight, unless the other side is marching in too, in which case both bounce. Defenders who are not encircled retreat to the friendly neighbor with the most supply that is still friendly after this fortnight's other battles. Supply and forts used in the battle are the values after digging and before the marches.

Terrain defense is plains 1, forest 1.2, urban 1.18, marsh 1.35, and mountain 1.48. Each fort level adds 14 percent. Artillery is stronger on the attack and against forts, and slightly weaker in defense. Cavalry is better on the plains and worse in forest, marsh, and mountain. A defender cut off from its depots still fights, at 30 percent supply. An attacker in the same position fights at 15 percent.

## Stavka

Stavka is deterministic. Difficulty changes the Russian army, Russian income, and how boldly the staff attacks. The map and the opening controllers do not change.

| | Easy | Normal | Hard |
| --- | --- | --- | --- |
| Russian strength | ×0.84, morale −4 | as written | ×1.28, morale +3 |
| Odds to attack Central Powers soil | 1.55 | 1.28 | 1.08 |
| Attacks in a fortnight | 1 | 2 | 3 |
| Concentric prongs | never | up to 2 | up to 3 |

On Easy and Hard those strength and morale adjustments stay inside a floor of 10 strength, a ceiling of 100, and a morale band of 42 to 94. Retaking a Russian province is 0.12 easier than the row above, and never below 1.

On the first fortnight, Easy and Normal dig and raise troops. They do not attack or redeploy. Hard is already in motion. After that, Easy shifts reserves only on even turns. A second prong is added only when one province is short of the odds. On Normal that pair must clear 1.45, and only to retake Russian soil. Hard may pinch a Central Powers province at its ordinary odds. Once you hold Russian soil, attacks into a Central Powers province use a higher bar: Easy will not make them, Normal needs 2.35, and Hard needs 2.15. Depots, objectives, and provinces on your border keep a garrison. On Hard a Russian depot keeps two formations, so Warsaw is not uncovered. A one-corps reserve depot may still march when some other province is already in contact. Rovno's corps can reach Lublin in that same fortnight.

On Hard, a province the enemy can already hurt (their best neighbor is at least four-fifths of the defense) stands. Its garrison does not march off, and it may strike only the neighbor that threatens it. The dig goes to the in-contact objective worth the most victory points, so Lemberg is entrenched before a weaker city. Stavka still reads only the opening map.

## The map on 2 May 1915

`owner` is the 1914 sovereign, used for occupation unrest. `controller` is who holds the ground when the offensive opens. Controllers live in `lib/data/definitions.ts`. The 1914 owners are forced in `OWNER_OVERRIDES` in `scripts/build-hoi4-theater.py`.

Mackensen’s German 11th Army and Archduke Joseph Ferdinand’s Austro-Hungarian 4th Army start in Kraków, with the Guard Corps and Mackensen’s heavy artillery. The 11th Army counter also stands for X Corps, XLI Reserve Corps, the Combined Corps, and Arz’s VI Corps. Radko Dimitriev’s Russian 3rd Army holds Lemberg, with XXI Corps and the army artillery. X Corps is on Kielce, XXIV Corps is at Lublin, and the III Caucasian Corps is the reserve at Rovno. Brusilov’s 8th Army is on Podolia. Borojević’s 3rd Army is in Carpathian Ruthenia. Cavalry Corps Hauer screens Stanislav, and Group Pflanzer-Baltin holds Bukovina. The German 8th and 9th Armies, Woyrsch, Thorn, and Danzig are a holding front opposite the Russian 1st, 2nd, and 10th Armies, the Grenadier Corps at Warsaw, and the Kovno garrison.

Kraków, Königsberg, and Lemberg are Central Powers depots. Warsaw and Rovno are Russian depots. A depot feeds only its own faction, and only while that faction controls it. Lemberg’s depot stays Austro-Hungarian, so it does not feed Russia; recapture turns that railhead back on. Because Lemberg starts Russian, the Carpathian flank is railed Kraków–Stanislav–Bukovina.

Lemberg’s owner is Austro-Hungarian and its controller is Russian. Russia held the city from 3 September 1914 until 22 June 1915, and unrest there has already risen. Katowice stays German. Bukovina stays Austro-Hungarian: Austrian troops had retaken it on 17 February 1915 and held it into 1916.

Two places are drawn off the historical front, on purpose. Przemyśl was Russian from 22 March until 3 June 1915, but it is an alias inside Kraków, with Gorlice, Tarnów, and Rzeszów. The polygon cannot be split, and Kraków stays the Central Powers base. Stanislav starts Austro-Hungarian and Central Powers-held. Historically the Russians held it from 4 March until 8 June 1915.

## Run it locally

Requires Node.js 22 or newer (`engines` in `package.json`, and `.nvmrc`).

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

- `npm test` — Vitest for the rules, Stavka, victory, and the turn API.
- `npm run typecheck` — generate Next types, then `tsc --noEmit`.
- `npm run lint` — ESLint.
- `npm run build` — production build.

CI runs typecheck, lint (0 warnings), test and build on every PR.
- `npm run llm-logs` — list stored LLM responses (`BLOB_READ_WRITE_TOKEN`). `vercel blob ls llm-log/` does the same.
- `npm run map` — neighbor graph, and rail pairs that do not share a border.
- `npx tsx scripts/balance-sim.ts` — scripted Central Powers opponents (greedy, frontier, sensible) through six seeds on Easy, Normal, and Hard. It clears any model key and plays against Stavka.

## Environment

Copy `.env.example` to `.env.local` only if you want a live narrator. The game is fully playable with none of these set.

```
LLM_API_KEY=
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
LLM_MODEL_STRONG=
```

`LLM_BASE_URL` is any OpenAI-compatible chat-completions endpoint. Optional `LLM_HTTP_REFERER` and `LLM_HTTP_TITLE` are sent when set. The chief of staff uses `LLM_MODEL`, the fast model. `LLM_MODEL_STRONG` stays on important Russian diplomacy turns.

When a key is present, the server still asks Stavka for the Russian orders. The model is called only for diplomacy. Turns are classed routine, important, or critical (`lib/gm/tier.ts`). With `LLM_MODEL_STRONG` set, important and critical turns try the strong model first. A cheap reply may be retried once on the strong model if validation fails or more than 30 percent of that draft’s proposals would be rejected. The wall clock for both calls is about 90 seconds (`GM_BUDGET_MS`), and each call is capped at about 45 seconds (`LLM_TIMEOUT_MS`). The turn function allows 120 seconds, and the browser waits longer than that. One JSON line is logged per call (`ostfront.gm.call`), without the key or the prompt. If the model fails, Stavka’s own diplomacy is kept.

OpenRouter calls ask for low reasoning effort and leave that trace out of the message, with a 4000-token completion cap. Invalid JSON, a schema miss, or an empty message (the budget was spent reasoning and `content` came back blank) is tried once more when about eight seconds of `GM_BUDGET_MS` remain. The player-facing debug line adds `finish length` when the reply was cut off, and token counts, including reasoning tokens, when the provider sent them.

Set `BLOB_READ_WRITE_TOKEN` to keep every game-master and chief-of-staff response in a private Blob, one file per attempt at `llm-log/YYYY-MM-DD/<timestamp>-<turn|advisor>-<id>.json`. The upload does not block the turn. With no token, nothing is stored. List the files with `npm run llm-logs`.

The turn route can be guarded when a deployment has a key:

- `TURN_MAX_BODY_BYTES` — default `512000`.
- `TURN_RATE_LIMIT_MAX` / `TURN_RATE_LIMIT_WINDOW_MS` — per-IP limit on a warm instance, default 24 requests / 60 seconds.
- `TURN_ALLOWED_ORIGINS` — comma-separated origins, for example `https://raymondymmak-ostfront.vercel.app,http://localhost:3000`.
- `TURN_API_TOKEN` — send `X-Ostfront-Turn-Token` or `Authorization: Bearer …`.

`POST /api/advisor` takes `{ state, messages, queuedOrders }` and returns the chief of staff's reply and any suggestions. It uses the same body size, rate limit, origin, and token checks. It does not write a save, and it does not resolve the turn.

Campaign state stays in the browser. The turn API does not write a save on the server.

## Project structure

```
app/page.tsx              the game
app/api/turn/route.ts     POST { state, orders } → { state, record }
app/api/advisor/route.ts  POST { state, messages, queuedOrders } → advice
components/               map, orders, province, chronicle, HUD
lib/data/                 catalog, 2 May order of battle, objectives, rails, geometry
lib/engine/               supply, combat, economy, victory, resolveTurn
lib/ai/stavka.ts          Russian staff
lib/gm/                   order text, staff turn, optional diplomacy model
lib/api/turn-guard.ts     body size, rate limit, origin, token
scripts/balance-sim.ts    scripted playthroughs
scripts/build-hoi4-theater.py
public/maplibre-gl-worker.mjs
```

`Province`, `Unit`, `Proposal`, and `GameState` live in `lib/types.ts`. Geometry is not stored in the save.

The map is MapLibre with a blank style and no remote tiles. Rail edges are the same links the supply rules use, drawn between the province anchors. A link held at both ends by one side is drawn in full, tinted for that side. A link whose ends differ is dimmed and broken. The legend toggles them, on by default, and they fade out with the province labels when the map is zoomed out. Selecting a province highlights its rails. If WebGL cannot paint, the same polygons are drawn as SVG. Province shapes and adjacency are in `lib/data/theater-geometry.json`: Hearts of Iron IV states in MapChart’s pixel space, drawn flat. There is no real-world basemap.

Map geometry: MapChart.net (CC BY-SA 4.0), based on Hearts of Iron IV by Paradox Interactive.

1914 owners are sampled from a local GeoJSON (`owner_1914`) that is not committed. Regenerate only when those sources are on the machine:

```bash
HOI4_DIR=/path/to/mapchart-hoi4 OWNER_1914_GEOJSON=/path/to/1914-regions.geojson npm run build:theater
```

Do not commit the raw Hearts of Iron IV files, the MapChart SVG, or the full state GeoJSON. The script writes only the theater file.

To add a province: add a `ProvinceDef` in `lib/data/definitions.ts`, regenerate the theater file, add rail pairs in `lib/data/rails.ts`, place units in `PLACEMENTS` in `lib/data/scenario.ts`, then run `npm test` and `npm run map`.
