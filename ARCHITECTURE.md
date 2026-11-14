# Ostfront architecture

Turn-based browser wargame (Next.js, TypeScript, MapLibre) for the Gorlice–Tarnów offensive, May–July 1915. This document is a **codemap**: where requests go, what owns truth, and which files to open when debugging.

Raymond’s learning question — *where is the POST, turn guard, and server→client send-back?* — is answered in **Turn flow** below.

**Related:** `README.md` (introduction), `docs/RULES.md` (full player rules), `docs/DEVELOPMENT.md` (local run and env), `FEATURES.md` (QA-visible behaviour), `docs/decisions/` (ADRs).

---

## Bird’s-eye view

```text
Browser (components/game-app.tsx)
    │  POST { gameId, expectedTurn, orders }
    ▼
app/api/turn/route.ts          ← turn guard, load store, resolve, commit
    ├─ lib/api/turn-guard.ts
    ├─ lib/campaign/store.ts   ← Upstash Redis or in-memory
    ├─ lib/campaign/resolve-turn.ts → lib/gm/index.ts playTurn
    │       └─ lib/engine/turn.ts resolveTurn
    └─ lib/campaign/public-state.ts stripSeedFromState
    │  JSON { gameId, state, record }
    ▼
Browser updates map, chronicle, clears order queue
```

| Layer | Role | Search here |
| --- | --- | --- |
| `app/` | Pages and HTTP routes | `app/api/*/route.ts` |
| `components/` | Map, HUD, panels | `game-app.tsx`, `war-map.tsx` |
| `lib/engine/` | Rules of war (ground truth) | `turn.ts`, `simultaneous.ts`, `combat.ts` |
| `lib/gm/` | Orders → proposals, LLM cascade, advisor | `index.ts`, `interpret.ts`, `cascade.ts`, `advisor.ts` |
| `lib/ai/` | Rule-based Stavka | `stavka.ts` |
| `lib/campaign/` | Server saves, public JSON | `store.ts`, `resolve-turn.ts`, `public-state.ts` |
| `lib/redis/` | Upstash REST client, env, test fake | `env.ts`, `client.ts`, `fake-client.ts` |
| `lib/data/` | Scenario, map, objectives | `scenario.ts`, `objectives.ts`, `theater-geometry.json` |
| `lib/teach/` | Lesson drills (no full campaign) | `lessons.ts`, `resolve.ts`, `record.ts` |
| `tests/` | Vitest specs per mechanic | `npm test` |
| `scripts/` | Map build, balance sim, `demo-check` | `scripts/demo-check.mjs` |
| `.github/workflows/ci.yml` | `typecheck`, `lint`, `test`, webpack `build` | CI job `check` |

Stack: Next.js App Router, React client components for the game shell, server routes for adjudication. Map rendering uses MapLibre (`components/war-map.tsx`, worker in `public/maplibre-gl-worker.mjs`).

---

## Turn flow (campaign)

### Client: close the fortnight

In `components/game-app.tsx`, `endTurn`:

1. Builds `PlayerOrder[]` from the queue (`queuedToPlayerOrders`) plus optional text directive.
2. Requires `game.gameId` (from `POST /api/new-game`); otherwise shows an error.
3. `fetch("/api/turn", { method: "POST", body: { gameId, expectedTurn: game.state.turn, orders } })`.
4. On success: merges `payload.state` and `payload.record` into React state, clears queue, flashes control changes.
5. On failure: leaves map and queue unchanged; sets `staleCampaign` for `stale_turn` / `unknown_game`.

Local persistence: `lib/storage.ts` writes `gameId` + seed-stripped state to `localStorage` (`ostfront-1915-v1`) after play. On load, a one-shot `GET /api/game?gameId=…` refreshes from the server.

### Server: `app/api/turn/route.ts`

Gate order (first failure wins):

| Step | Check | Typical HTTP |
| --- | --- | --- |
| 1 | `campaignStorageStatus()` — Redis REST creds required on Vercel | 503 `storage_unavailable` |
| 2 | `readBodyWithLimit` | 413 payload too large |
| 3 | `enforceTurnGuards` — size again, rate limit, origin/token | 429 / 403 / 401 |
| 4 | `JSON.parse` | 400 invalid JSON |
| 5 | `ServerTurnRequestSchema` (Zod) — **only** `gameId`, `expectedTurn`, `orders` | 400 schema |
| 6 | `loadStoredCampaign` | 404 `unknown_game` |
| 7 | `head.turn === expectedTurn` | 409 `stale_turn` |
| 8 | `withServerSeed(state, head.seed)` | — |
| 9 | `resolveCampaignTurn` → `playTurn` | 409 `stale_turn` / `campaign_closed` / 400 `missing_game` |
| 10 | `commitCampaignTurn` — atomic Redis Lua or in-memory serialize | 409 `storage_conflict` or `stale_turn` |
| 11 | Response | 200 `{ gameId, state: stripSeedFromState(...), record }` |

Turn guard defaults (`lib/api/turn-guard.ts`): body ≤ 512_000 bytes; 24 requests per IP per 60s per warm instance; optional `TURN_API_TOKEN` and `TURN_ALLOWED_ORIGINS`. Access (`checkAccess`): a matching `X-Ostfront-Turn-Token` or `Authorization: Bearer` value always passes; else, if `TURN_ALLOWED_ORIGINS` is non-empty, the request must carry a matching `Origin`/`Referer` (**403** if missing or not listed) and **does not need the token**; else, if only a token is configured, missing credentials yield **401**; with neither token nor allow-list, the route is open (typical local dev).

### Resolution chain

```mermaid
sequenceDiagram
  participant UI as game-app.tsx
  participant API as /api/turn
  participant Store as campaign/store
  participant GM as gm/playTurn
  participant Eng as engine/resolveTurn

  UI->>API: POST gameId, expectedTurn, orders
  API->>API: storage + body + turn guard + Zod
  API->>Store: loadStoredCampaign
  Store-->>API: head + save snapshot
  API->>API: withServerSeed
  API->>GM: resolveCampaignTurn → playTurn
  GM->>GM: interpretOrders + mockAiTurn (Stavka)
  opt LLM configured
    GM->>GM: fetchGmWithCascade (diplomacy flavour only)
  end
  GM->>Eng: resolveTurn
  Eng-->>GM: next state + TurnRecord
  GM-->>API: SaveGame + record
  API->>Store: commitCampaignTurn (Lua: NX snapshot + head)
  Store-->>API: ok or 409
  API-->>UI: state (no seed), record
```

**Key functions**

- `resolveCampaignTurn` — `lib/campaign/resolve-turn.ts`
- `playTurn` — `lib/gm/index.ts`
- `mockAiTurn` → `stavkaTurn` — `lib/gm/mock.ts`, `lib/ai/stavka.ts`
- `resolveTurn` — `lib/engine/turn.ts`

### Storage layout (Upstash Redis)

`lib/campaign/store.ts` with keys from `lib/campaign/redis-keys.ts`:

| Key | Payload |
| --- | --- |
| `campaign:{gameId}:head` | `CampaignHead` — `turn`, **authoritative `seed`**, `difficulty`, `createdAt` |
| `campaign:{gameId}:turn:{n}` | `TurnSnapshot` — `SaveGame` **without** `state.seed` |

- **Create:** `CREATE_CAMPAIGN_LUA` — dual `SET NX` with 30-day TTL (`CAMPAIGN_TTL_SECONDS`).
- **Commit:** `COMMIT_TURN_LUA` — one atomic step: verify expected turn, `SET NX` on turn `N+1`, write new head. Losers → **409** (`storage_conflict` or `stale_turn`). Fixes the old Blob orphan-snapshot failure mode (ADR 004, superseded).
- **No Redis creds:** in-memory `Map` for local dev and Vitest (`campaignStorageMode(): "memory"`).
- **Vercel without creds:** `lib/campaign/availability.ts` → **503** fail closed.

Teach persistence: `teach:attempt:{day}:{id}`, `teach:belief:{attemptId}` in `lib/teach/record.ts` and `lib/teach/belief.ts`.

Legacy Blob campaigns are not migrated.

---

## Advisor flow (`POST /api/advisor`)

`components/advisor-panel.tsx` sends chat history, **full client `GameState`**, and queued orders. Route: `app/api/advisor/route.ts`.

Same turn guard as turn (body limit, rate, origin/token) but **no** campaign storage check.

`lib/gm/advisor.ts` `advise()`:

- Rebinds topology, builds a “dispatch” from engine previews (`engagementOdds`, supply, objectives).
- If `llmConfigured()`, calls the model; else rules-only fallback (`source: "rules"`, `unavailable: true`).
- Suggestions are validated with the same helpers as real orders; nothing is applied until the player accepts into the queue.

Advisor does **not** persist chat on the server in the campaign store.

```mermaid
flowchart LR
  A["advisor-panel"] -->|"POST state + messages"| B["/api/advisor"]
  B --> C["advise"]
  C --> D["engine previews"]
  C --> E["optional LLM"]
  C --> F["AdvisorResponse JSON"]
  F --> A
```

---

## Teach mode (`app/teach/`, `/api/teach/*`)

Isolated lessons (e.g. converging attacks) without a `gameId`. State is **built on the server** from lesson id + variant, not trusted from the client.

| Route | Role |
| --- | --- |
| `GET /api/teach/session` | Lesson meta, authoritative `state`, hints, trust copy |
| `POST /api/teach/hint` | Levelled hint from `coachHints` |
| `POST /api/teach/coach` | Reasoning coach (LLM optional) |
| `POST /api/teach/resolve` | Validates orders; `teachResolveTurn`; may persist attempt to Redis |

`lib/teach/resolve.ts` uses fixed combat rolls in guided/silent variants (stated in session JSON). Belief fields are server-owned; hostile client fields → 400.

UI: `components/teaching-app.tsx`, `teach-panel.tsx`.

---

## Other API routes

| Route | Purpose |
| --- | --- |
| `POST /api/new-game` | `createStoredCampaign` → `publicSavePayload` |
| `GET /api/game?gameId=` | Load latest snapshot; `withServerSeed` then strip seed in JSON |

---

## Game rules (code pointers)

Numbers below are from source, not paraphrase.

### Combat and concentric attacks (`lib/engine/combat.ts`)

- Flank multiplier: 2 prongs ×1.12, 3 ×1.22, 4+ ×1.30 (`flankMultiplier`).
- Encirclement extra defender loss fraction: **0.18** (`ENCIRCLEMENT_DEFENDER_LOSS`); applied in `simultaneous.ts` when multi-prong attack and **no retreat neighbor at turn open** (`exitAtStart.length === 0`).
- Terrain defense: plains 1, forest 1.2, urban 1.18, marsh 1.35, mountain 1.48.
- Fort: +14% defense per level (`defenderPower`).
- Die band 0.82–1.17 (`resolveCombat`).

### Fortify (`lib/engine/economy.ts`, `lib/engine/turn.ts`)

- Cost **2 IP** (`FORTIFY_IP_COST`); treasury deducted when proposal accepted.

### Supply (`lib/engine/supply.ts`)

- March/attack requires province supply ≥ **30** (rejection in `turn.ts`).
- Converging flank bonus needs attack supply ≥ **60** (`CONVERGING_FLANK_MIN_SUPPLY`).
- Capacity by terrain (e.g. urban 62, plains 44) plus depot +34, +6 per rail edge.
- Depot attacks floor at **72%** of network supply (`DEPOT_ATTACK_SUPPLY_FLOOR`).

### Economy highlights (`lib/engine/economy.ts`)

- Recruit costs and arrivals in `RECRUIT` table (infantry 6 mp / 3 ip, etc.).
- Russian income scale: easy 0.62, normal 0.82, hard 1.18 (`DIFFICULTY_INCOME`).
- Yards: controller match, supply ≥ **60**, depot or own urban city (`recruitmentYard`).

### Victory (`lib/data/objectives.ts`, `lib/engine/victory.ts`)

Gorlice scenario (`SCENARIOS.gorlice`):

| Objective | VP | Brilliant par turn |
| --- | ---: | ---: |
| Lemberg (`lwow`) | 4 | turn ≤ 3 (13 June) |
| Lublin | 2 | turn ≤ 5 (11 July) |
| Rovno (`wolyn`) | 3 | turn ≤ 4 (27 June) |
| Kraków (home) | 2 | must stay Central Powers |

Grade thresholds (eastern VP captured, Kraków not Russian): Decisive ≥ **7**, Victory ≥ **4**, Marginal ≥ **2**; Brilliant needs all eastern objectives on par turns and no `homeLost`. Kraków Russian at end → defeat paths in `decideFortnight`.

---

## AI and game master

### Stavka (always runs)

`playTurn` always calls `mockAiTurn` → `stavkaTurn` for Russian **proposals**. Difficulty sets attack thresholds (`STAVKA_THRESHOLD` in `lib/ai/stavka.ts`).

### LLM cascade (`lib/gm/cascade.ts`)

When `LLM_API_KEY` is set, `planCascade` (`lib/gm/tier.ts`) picks models by tier. `fetchGmWithCascade` failure falls back to **staff simulation** (Stavka only).

**Surprising fact (verify in `lib/gm/index.ts`):** even when the cascade succeeds, **only up to two diplomacy lines** are taken from the LLM. Russian unit orders, events, and narration still come from Stavka.

### Advisor

Separate prompt in `lib/gm/advisor.ts`; uses `llmChat`, not the turn cascade.

### LLM Blob logging (`lib/gm/llm-log.ts`)

Opt-in only (`LLM_LOG_BLOB`, plus `LLM_LOG_BLOB_PREVIEW` on preview). Default: console JSON only — no Blob advanced ops on the request path.

---

## Invariants and trust boundaries

| Asset | Owner | Notes |
| --- | --- | --- |
| Dice seed | Server `CampaignHead` only | Never in API JSON or turn snapshots (`stripSeedFromState` on responses) |
| Campaign snapshots | Server Redis / memory | Client sends only `gameId` + turn index + orders |
| Turn outcome | `lib/engine` | Deterministic given seed + orders + Stavka |
| Advisor map view | **Client POSTed state** | Trusts browser for briefing; does not change saved campaign |
| Teach lesson state | Server `authoritativeLessonState` | Client cannot substitute another scenario |
| localStorage save | Browser | Convenience cache; can be stale until `/api/game` sync |

Engine is **ground truth** for adjudication. AI proposes; `resolveTurn` decides.

---

## Known gaps and surprising facts

1. **LLM turn cascade is mostly cosmetic today** — only diplomacy flavour reaches the chronicle; Stavka still moves Russia.
2. **`measureRejectionRate` in cascade** dry-runs LLM proposals to choose escalation, but those proposals are not used in the live turn.
3. **`lib/storage.ts` is not dead code** — `game-app.tsx` still mirrors saves locally; server campaigns are authoritative for adjudication.
4. **Turn guard rate limit** is per serverless instance, not global.
5. **In-memory dev store** serializes commits per `gameId` via `runCampaignSerialized`; Redis relies on Lua for parallel safety.

---

## Glossary

| Term | Meaning |
| --- | --- |
| **Fortnight** | One turn (~two weeks); turn index 0…5 in Gorlice scenario |
| **Stavka** | Rule-based Russian AI in `lib/ai/stavka.ts` |
| **GM** | Game master package (`lib/gm/`) — interpret, LLM, advisor |
| **Cascade** | Fast LLM call, optional strong-model retry (`lib/gm/cascade.ts`) |
| **Tier** | Turn importance score for model routing (`lib/gm/tier.ts`) |
| **Dispatch** | Advisor briefing blob built from engine previews |
| **Echelon** | Unit grouping / corps structure (`lib/engine/echelon.ts`) |
| **Lua CAS** | Atomic turn commit script in `lib/campaign/redis-scripts.ts` |
| **Proposal** | Typed order (move, attack, fortify, …) before resolution |
| **Chronicle** | `TurnRecord` log shown in `timeline-panel.tsx` |

---

## CI and agents

- Local gate: `npm run typecheck`, `npm run lint -- --max-warnings=0`, `npm test`, `npm run build`.
- Preview QA: `DEMO_URL=… npm run demo-check` (see `AGENTS.md`).
- Coding agents: read this file first; update it and add an ADR when changing architecture, routes, storage, trust boundaries, or coded game rules.
