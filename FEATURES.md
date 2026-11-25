# Ostfront features

## Teaching drill (Sprint 1–2 / Phase 2A–2B / Phase 2D Part 6)

Route **`/teach`**. Entry link on the scenario picker: `[data-testid=begin-teach]`. Campaign at **`/`** is unchanged.

On desktop (`lg+`, ≥1024px) `/teach` uses the same general’s-table shell as the campaign: full-width map, parchment HUD (title, date, `[data-testid=teach-goal]` — no window buttons), and draggable **Lesson** / **Orders** / **Province** / **Legend** papers (`[data-testid=teach-lesson-window]`, `[data-testid=teach-orders-window]`, `[data-testid=teach-province-window]`, `[data-testid=legend-window]`). Stowed papers sit in `[data-testid=document-tray]` as tabs (`[data-testid=teach-lesson-toggle]`, `[data-testid=tab-orders]`, …). Drag a paper onto the tray (`data-drop-active` / `data-over-tray` / insert marker) to file it at the drop slot, or press Escape; drag a tab sideways (or Alt+←/→) to reorder, drag up or Enter to take it out — no Stow buttons or click-to-toggle. Tray order persists in sessionStorage. Restore keeps width and last height. Press–drag–release on `[data-testid=floating-window-drag-handle]` (header stays above the tray while dragging; release on/below the tray or at/past the viewport bottom files); height does not change while dragging; optional `[data-testid=floating-window-resize-handle]`. Default-open: Lesson (top-left), Legend under it, Orders (top-right) — non-overlapping at 1440×900 / 1280×800 so Kraków/Kielce/Lublin stay clear. Exactly one Resolve: `[data-testid=teach-resolve]` in Lesson (pinned in `[data-testid=teach-resolve-bar]`); Orders has no `[data-testid=end-turn]`. `[data-testid=teach-app]` carries `data-teach-shell=desktop|stacked`. Brass lesson-focus via `data-lesson-highlights`. Below `lg`, `h-dvh` stacked map → bounded Lesson (`[data-testid=teach-lesson-stack]`, Resolve in-viewport) → phone tray swapping Orders/Province/Legend — checked at 390×844.

| Step | Selector / API | Proof |
| --- | --- | --- |
| Open drill | `[data-testid=teach-begin]` or `[data-testid=teach-begin-supply]` | `[data-testid=teach-app]`; lessons `converging-lublin` \| `supply-tradeoff` |
| Coach question | `[data-testid=teach-question]` | Short map-first prompt; longer copy behind `[data-testid=teach-briefing-toggle]` → `[data-testid=teach-briefing]` |
| Lesson focus | Map `data-lesson-highlights` | Target + prong province ids highlighted on load |
| Hints | `[data-testid=teach-request-hint]` | Guided only; supply hints reference `[data-testid=map-mode-supply]` |
| Plan on map | Same arrows / Province **Attack** as campaign | `[data-testid=queued-orders]`; engine preview attack/defence lines |
| Reasoning | `[data-testid=teach-reasoning]` | Free text; coach compares to server plan |
| Prediction (required) | `[data-testid=teach-prediction]` | Server rejects resolve if under 12 chars; stored on attempt; compared post-resolve in feedback |
| Post-resolve verdict | Lesson evidence lines | Grades use engine `Resolution.battle` (odds, roll, prongs, launch supply, win/loss) — not parsed battle summary text |
| Belief recall | `[data-testid=teach-belief-recall]` | Silent session with `priorAttemptId`; server-loaded belief — not client-writable |
| Discuss plan (guided) | `[data-testid=teach-discuss-plan]` | POST **`/api/teach/coach`** |
| Pedagogy notice | `[data-testid=teach-pedagogy-notice]` | Guided fixed die roll disclosed (expandable) before resolve |
| Resolve | `[data-testid=teach-resolve]` | POST **`/api/teach/resolve`** with `prediction` (strict schema). `[data-testid=teach-belief-stored]` shows belief persistence status |
| Silent follow-up | `[data-testid=teach-start-silent]` | After **converging-lublin** guided only; no hints; optional belief recall from prior guided attempt. Supply lesson ends at **Drill complete**. |
| Supply lesson | `[data-testid=teach-start-supply]` or setup button | Trade-off Katowice (heavy, lower supply) vs Kraków (lean, depot-fed); preview ratios from engine |

Session: GET **`/api/teach/session?lessonId=…&variant=…&priorAttemptId=…`**.

Verified supply/combat (engine): attacker `max(0.15, supply/100)`; defender floor `0.3`; march/attack blocked below supply `30`; network supply `100 − pathCost×11`, rail edge cost `1`.

### Province supply capacity (Sprint 3)

Each province has a **garrison supply capacity** (terrain base + depot bonus when controlled + 6× rail links). When fighting strength in the province exceeds capacity, **effective supply** scales as `networkSupply × min(1, capacity ÷ garrisonStrength)` — shown on the map Supply overlay and used for **attacks launched from** that province. **Defenders** still use the network line (`networkSupply`) in combat. **Your depot** still issues bulk rations: attacks launched from a depot you control never march below **72% of network supply**, even when the map shows overcrowding. Over-capacity provinces are spelled out in the fortnight **Chronicle** logistics.

**Converging attacks:** when any prong marches below supply **60**, the flank bonus is off and the pooled battle uses the **worst prong’s launch supply**, then scales it by `objective capacity ÷ (garrison + attackers)` when the combined column overfills the target. Well-fed prongs (all ≥ 60) still pool per-prong power with the normal flank multiplier (converging Lublin lesson).

### Fortify (Sprint 3)

**Fortify** costs **2 industry**, binds the province garrison for that fortnight (no move/attack), and raises fort **one level on the next fortnight** (max 3). While that order is queued, a drag or neighbour button onto another province is refused before release (`Digging in`) and draws no arrow. Capturing a fortified province reduces its fort by **one level** when control changes. Queue text still uses `[data-testid=fortify]`; the resolution log names IP spent and when entrenchments complete.

Trust: teaching resolve does **not** accept client `GameState` for grading. Full campaign **`/api/turn`** loads state from server Redis by `gameId` and accepts only `expectedTurn` and `orders` (server seed, #26).

## News cards (HOI4-style)

After each fortnight resolves, up to four headline cards (`[data-testid=news-card]`) appear in a viewport-level overlay (`[data-testid=news-card-overlay]`, `z-index` above sidebar and map). **Onward** (`[data-testid=news-onward]`) or Enter advances; **Skip all** (`[data-testid=news-skip-all]`) or Esc dismisses the queue. Images use `[data-testid=news-card-photo]` or `[data-testid=news-card-map]` (stylized vignette, not the live map). Encirclement beats (when the engine marks a pocket) trump duplicate city headlines; city and encirclement cards may show a factual `[data-testid=news-card-losses]` line (`Ours −N · Theirs −M`) from engine `BattleFacts`, not from lore text.

The map uses the full main height (no bottom Chronicle bar). Open **Log** (`[data-testid=chronicle-log-toggle]`) for the Chronicle (`[data-testid=chronicle-drawer]`; panel shell `[data-testid=mobile-chronicle-panel]`). On desktop (`lg+`, min-width 1024px) the campaign is a general's table: full-width map, no fixed 23rem right dock; **Orders**, **Province**, **Log**, **Legend**, **Chief of Staff**, and **Orders from OHL** are draggable parchment papers filed into / taken from `[data-testid=document-tray]` (HUD has no window buttons). Press–drag–release; drag onto the whole tray bar (or Escape) files a paper at the drop slot (insertion marker; including short OHL) — papers never paint behind the tray; drag and resting positions (and session restore) keep the header grip fully above the tray; release on the tray, below it, or at/past the viewport bottom files (pointer capture + cancel/lost-capture). Sideways tab drag or Alt+←/→ reorders; drag up or Enter restores (width/last size kept); tray order persists — no Stow buttons. Default-open after Begin: Orders, Legend (bottom-left), Orders from OHL. Below `lg`, the app frame is the phone viewport (`100dvh`, safe-area insets, no document scroll or pull-to-refresh). `html` and `body` keep `overscroll-behavior: none` and do not use `overflow: hidden`, so a mouse wheel or trackpad scrolls a desktop paper from anywhere in the panel, not only the scrollbar. Stacked map + tray tab strip for Orders / OHL / Province / Chief of Staff; only that panel scrolls. A touch drag on an army chip queues an order and does not scroll the page; the map still pans and pinches when the gesture misses a unit. The map-corner Log control stays above the legend at every width from 640–1023px (no `sm:bottom-3` overlap). Inside `[data-testid=chronicle]`, the latest fortnight shows compact routine rows (`[data-testid=chronicle-routine]`) including short battle loss lines when `Resolution.battle` is present; **Details** (`[data-testid=chronicle-details-toggle]` → `[data-testid=chronicle-details]`) holds full narration, resolutions (`[data-testid=resolution-log]`), and logistics.

## Chief of Staff (campaign coach)

Phase **2G Sprint 1** advisor harness (ADR 019). The panel is `[data-testid=advisor-panel]` (tray tab `[data-testid=advisor-toggle]`). It is a **coach**, not an order clerk: it never issues orders and never shows Accept / Override / suggestion cards.

Ask with starters (`[data-testid=advisor-starter-plan|explain|review]`), or `[data-testid=advisor-input]` + `[data-testid=advisor-send]`. POST **`/api/advisor`** with `{ gameId, expectedTurn, messages, queuedOrders, selectedProvinceId? }` only — the server loads campaign state and chronicle by `gameId`. Replies land in `[data-testid=advisor-reply]` with `data-coach-stance` (`probe` | `warn` | `confirm` | `brief`). Highlights use province ids (`[data-testid=advisor-highlights]`); `warn` stances may paint one province via `data-coach-highlights` on `[data-testid=war-map]`.

Before each model call the server injects **5–8 GAME_FACTS lines** (`lib/gm/advisor-game-facts.ts`): fortnight *N* of 6, campaign end **11 July 1915**, legal move/attack neighbors (same checks as map arrows), and supply-below-30 / depot-empty / encirclement-risk flags — not a full-board dump.

Harness JSON is `{ stance, reply, highlightProvinceId? }`; soft length is via `max_tokens` only (no sentence-count retries). Hard safety scrub: no filed/noted/queued claims, no concrete order prescription, no invented odds (misfires log as `ostfront.coach.harness_misfire`).

**Order warnings (UI):** Drag/queue hints may mention low supply or an emptying depot (`[data-testid=order-hint]`). Queued rows may show `[data-testid=depot-warning]` or `[data-testid=supply-warning]` (including thin depot garrisons, not only full empties). `[data-testid=war-map]` exposes `data-encirclement-risk` (comma-separated province ids with thin friendly exits).

**Advisor GAME_FACTS:** Always includes **Selected province (UI)** when the Province tab/map selection is set (name, controller, supply, fort, strength, neighbors, orderable targets). Lists queued arrows, Orders-panel odds, `legalTargets` without reach-only, supply &lt; 30, depot drain, and encirclement. The explain chip is disabled until a province is selected.

**Scenario eval:** `npm run eval:coach` — sixteen fixtures including playtest calendar (fortnight 5 of 6) and Kraków legality; Layer 1 is safety-only. CI: `tests/coach-eval.test.ts`, `tests/advisor-game-facts.test.ts`, demo-check steps **15–16b** (stance + encirclement attribute).

## Game-master events

An event the engine rejects stays on the turn record with status `rejected`. The chronicle shows it as **Rejected**. It is not removed before the turn is resolved.

---

# Ostfront feature map (QA & agents)

Route for every feature: **`/`** (single-page app). Unless noted, actions assume a campaign is in progress (scenario picker closed).

Stable selectors prefer `[data-testid=…]`. Button labels are fallbacks when test ids are not set.

| Feature | How to reach it | Proof it worked |
| --- | --- | --- |
| **Start campaign / pick difficulty** | First load or Restart → Confirm: full-screen `[data-testid=scenario-picker]` (`[data-testid=campaign-start-backdrop]` only — no live map). Parchment card `[data-testid=campaign-start-card]` is centred when it fits the phone (incl. iOS safe areas) and the start panel scrolls from the top when **More** briefing is taller than the viewport; difficulty `[data-testid=difficulty]` and actions `[data-testid=campaign-start-actions]` span the card padding with equal left/right insets. Pick `[data-testid=difficulty-easy\|normal\|hard]`, **Begin** `[data-testid=begin-scenario]`, optional **More** briefing. | Picker hidden; `[data-testid=war-map]` and HUD mount; date **2 May 1915**. |
| **Read campaign goal** | Pre-start: `[data-testid=briefing-task]` on the start screen. After Begin: `[data-testid=campaign-goal]` inside **Orders from OHL** (`[data-testid=ohl-orders-window]`), not the HUD strength readout. Desktop: dismissible floating window, 27rem wide (default open; reopen with the **OHL** tray tab). Below `lg`: the same goal is the **OHL** tab (`[data-testid=ohl-toggle]`) beside Orders, Province, and Chief of Staff — not a strip under the header. Teaching drill: `[data-testid=teach-goal]` shows the lesson title (not the campaign objective); campaign scoring (treasury / VP / grade) is hidden. | One-line objective. Full paragraphs only behind **More**. |
| **Top bar readout** | Always in `<header data-testid=table-hud>` after campaign start — slim strip (strength bar + one stats row on wide screens). No Chief of Staff on the HUD. | `[data-testid=objectives]` strength bar; labels **Strength** (no provinces-held count); `[data-testid=treasury]` manpower/industry; **★ VP** fraction; `[data-testid=grade]` provisional or final grade; date and fortnight counter with **Options** `[data-testid=hud-options]` (gear) to the right. Window papers open from the bottom **document tray** (`[data-testid=document-tray]`): **Orders** `[data-testid=tab-orders]`, **Province** `[data-testid=tab-province]`, **Log** `[data-testid=chronicle-log-toggle]`, **Legend** `[data-testid=legend-toggle]`, **Chief of Staff** `[data-testid=advisor-toggle]`, **OHL** `[data-testid=ohl-toggle]`. Below `lg`, the phone strip includes Orders / OHL / Province / Chief of Staff (same `ohl-toggle` and `advisor-toggle`) in `trayOrder`. |
| **Economy breakdown** | Hover or click **Manpower** `[data-testid=economy-manpower]` or **Industry** `[data-testid=economy-industry]` in the top bar. Click again or **Escape** closes it. | `[data-testid=economy-breakdown]` (`data-economy-focus` `manpower` or `industry`) shows the yield rule — base × (1 − unrest/100), halved if occupied, 0 if supply is under 30 — then one terse line per held province, such as `Austrian Silesia: 1 MP, 1 IND` or `Carpathian Ruthenia: 0 (supply 27 < 30)`. Both say reinforcing damaged armies costs 1 manpower per 4 strength. Industry also shows Central Powers industry ×1.3. Manpower does not. The panel does not repeat the treasury, this fortnight’s income, or rounding. |
| **Legal move / attack highlights** | Select any province (or switch selection). | Neighbour move/attack/reach provinces lighten from their own fill with a short fade-in (same pulse when switching). Non-targets keep their normal base fill — no whole-map dim. `data-map-targets` lists ids and `order:true|false`. A small cursor tooltip appears only when the hover adds something the map does not already show, such as why a neighbor is blocked or would empty a depot. Province name and total strength stay on the map; there is no fixed corner box repeating them. |
| **Attack odds bar** | Queue an attack or open an enemy neighbor on **Province**. | `[data-testid=attack-odds]` or `[data-testid=combined-odds]` with `data-odds-band` and `data-ratio`; equal-width track (`data-odds-track` / full `data-odds-fill`); tone colour and label carry the ratio; long caveat on hover/title. |
| **Select province (map)** | After Begin / teach start, **no** province is selected (no Kraków/Lublin auto-select). Click a province on `[data-testid=war-map]` (MapLibre canvas); click again or press **Esc** (when news/Log are closed) to clear selection. | **Province** tab `h2` shows that province (demo clicks **Katowice** after an explicit map click). Labels/counters are symbol layers, not HTML markers. |
| **Select province (list)** | **Orders** → **Your formations** row, or **Province** tab after map selection. | Province panel title updates. |
| **Province tab** | `[data-testid=tab-province]` (**Province**). | Supply/unrest meters, then that province’s yield (`[data-testid=province-yield]`). The line is only the terse text, `2 MP, 2 IND` or `0 (supply 27 < 30)`, with no Yield label. Neighbors list, fortify/recruit when eligible. Each formation leads with type, strength, and morale; the army name is smaller and grey. Resources mode does not print MP/IND labels on the map. |
| **Neighbor Move** | **Province** tab: neighbor row with **Move** (friendly target). | **Orders** queue: **Move to … from …** |
| **Neighbor Attack** | **Province** tab: neighbor row with **Attack** (enemy). | Queue shows attack line; optional `[data-testid=attack-odds]`. |
| **Draw arrows on map** | **Orders** tab: **Draw arrows** `[data-testid=draw-arrows]`; drag between provinces when mode is on (optional in demo-check). A drop is drawn and queued only when `assessManeuvers` would accept it. Supply under 30, no shared border, already ordered, and digging in show the province blocked (`data-drag-block`, `data-drag-reason`, for example `Supply 22 < 30`) with no preview line (`data-arrow-drag="invalid"`, not-allowed cursor). The chronicle still records battles and other results that are not knowable until the fortnight resolves. Neighbor buttons are unchanged. | `aria-pressed="true"`; queue entry appears for legal neighbors only. |
| **Drag a formation chip** | Zoom the map in past the opening frame (chips at zoom ≥ 7.4). Each formation is a strength chip `[data-testid=army-chip]` on its province. Drag a Central Powers chip onto a neighbour. The map frame shows `data-drag-order="valid"` or `"invalid"`, and `data-drag-pan` while the pointer is near an edge (the map pans). Russian chips are not draggable. | A legal drop adds one **Move** or **Attack** line for that formation. An illegal drop (same province, non-neighbour, supply under 30, already ordered, digging in) does not change the queue and shows the one-line reason on the chip (`Supply 29 < 30`). |
| **Fortify** | **Province** tab: **Fortify …** `[data-testid=fortify]` (disabled state shows `[data-testid=fortify-reason]`). | **Orders** queue shows **Fortify** line (`[data-testid=queued-orders]`). |
| **Recruit** | **Province** tab at a yard: `[data-testid=recruit-panel]`; `[data-testid=recruit-infantry]` etc. | Queue shows **Raise … at** |
| **Map mode Control / Supply / Unrest / Resources** | `[data-testid=map-mode-none]`, `map-mode-supply`, `map-mode-unrest`, `map-mode-resources`. | `[data-testid=overlay-scale]` visible for Supply, Unrest, and Resources. Resources shades local manpower + industry yield (not the national ×1.3). |
| **Toggle rails** | Map legend → `[data-testid=rail-toggle]`. | Label **On** ↔ **Off**. Held rails: light casing + near-black track (~2.0–3.0px, ~0.85 opacity); cut rails dashed at the same weight; above fills/borders, under labels/counters. |
| **Chief of Staff (coach)** | Document tray tab `[data-testid=advisor-toggle]` (not the HUD). Desktop: drag up / Enter to take the paper out; Escape or drag onto the tray files it. Phone: tray tab swaps the embedded panel. Panel `[data-testid=advisor-panel]`. Starters (`advisor-starter-plan\|explain\|review`), or `[data-testid=advisor-input]` + `[data-testid=advisor-send]`. POST **`/api/advisor`** (`gameId` + `expectedTurn`; no client state). | `[data-testid=advisor-reply]` (+ optional follow-up); map `data-coach-highlights`; **no** Accept/Override cards. |
| **End turn (button)** | **Close the fortnight** `[data-testid=end-turn]`. POST **`/api/turn`**. | `[data-testid=stavka-deliberating]` clears; new Chronicle date; `[data-testid=resolution-log]` includes **Resolved** / **Rejected**. |
| **End turn (keyboard)** | **Ctrl+Enter** / **Cmd+Enter** with focus on the page. | Same as button. |
| **GM narration** | Chronicle article after end turn. | Narration paragraphs; badge **Game master** (not **Staff simulation** when LLM ran). |
| **Finale banner / end screen** | Not run in `demo-check` (needs a finished campaign). Closing the last fortnight (or sudden death) commits successfully; the client keeps the **final map** on the closing date (e.g. **11 July 1915**, Fortnight 6/6) with `[data-testid=finale-banner]` / **See result** `[data-testid=see-result]` — map undimmed, papers usable — until the grade modal `[data-testid=endgame]` opens. | Grade modal is portaled to `document.body` at z above every paper/HUD/tray (`ENDGAME_OVERLAY_Z`); its dim covers the table; only the grade card sits above. Focus stays in the modal; chrome is `inert`. **Back to the map** / **Play again** → `[data-testid=scenario-picker]`. |
| **Restart** | HUD **Options** `[data-testid=hud-options]` → **Restart** `[data-testid=hud-options-restart]` → **Confirm restart** (same menu item). Menu also lists disabled **Settings (soon)** `[data-testid=hud-options-settings]`. | `[data-testid=scenario-picker]` opens. |

## Automated demo path

```bash
npx playwright install chromium   # once per machine
DEMO_URL=https://your-preview.vercel.app npm run demo-check
# Flags: --continue --allow-fallback --force-fail
```

Default without `DEMO_URL`: warns and uses production. **Agents must set `DEMO_URL` to their preview.** Do not pass share tokens via `npm run demo-check -- --url` (npm logs the command line).

Protected previews: `VERCEL_AUTOMATION_BYPASS_SECRET` or share link in **`DEMO_URL` only**. See `AGENTS.md` for redaction limits.

Writes screenshots and redacted logs under `demo-check-output/` (gitignored).

When you add or change a player-visible feature, update this file and extend `scripts/demo-check.mjs`.
