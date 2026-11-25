import { beforeEach, describe, expect, it, vi } from "vitest"
import { resetTurnGuardStateForTests } from "@/lib/api/turn-guard"
import {
  createStoredCampaign,
  commitCampaignTurn,
  resetCampaignStoreForTests,
  withServerSeed,
} from "@/lib/campaign/store"
import {
  capCoachReply,
  coachCampaign,
  extractCoachOddsRatio,
  extractPlayerPrediction,
  fitCoachReplyLength,
  formatBattleForCoach,
  formatBattleReviewForPlayer,
  detectQueuedOrderConflicts,
  fortLevelPhrase,
  hasDanglingCoachClause,
  hasMissingQuestionMark,
  hasVerblessTrailingSubordinate,
  coachAttackOrderCheck,
  conversationStatedReinforceCaveat,
  reinforcementsPlausiblyMatter,
  shouldQuoteReinforceCaveat,
  queuedAttackOddsByTarget,
  renderQueuedResolutionOdds,
  resolveReachabilityEndpoints,
  collectMentionedProvinceIds,
  keepOneOddsFigure,
  latestChronicleEvidence,
  renderChronicle,
  latestBattleFacts,
  playerStatedIntent,
  putQuestionFirst,
  queuedAttackPreview,
  sanitizeHighlights,
  scrubCoachFiledClaims,
  scrubPrescribedOrders,
  scrubCoachFortLabels,
  scrubCoachJargon,
  scrubCoachOddsDecimals,
  scrubCoachOddsLanguage,
  scrubDanglingOddsClauses,
  scrubVerblessSubordinates,
  shapeCoachReply,
  splitCoachSentences,
} from "@/lib/gm/campaign-coach"
import { staffMap } from "@/lib/gm/advisor"
import { engagementOdds, resolveTurn } from "@/lib/engine/turn"
import type { BattleFacts, TurnRecord } from "@/lib/types"
import { playTurn } from "@/lib/gm"
import { createInitialState } from "@/lib/data/scenario"
import type { PlayerOrder } from "@/lib/types"

function battleFactsFixture(
  battle: Omit<
    BattleFacts,
    "attack" | "defense" | "ratio" | "roll" | "launchSupply" | "pooledSupply"
  > &
    Partial<Pick<BattleFacts, "attack" | "defense" | "ratio" | "roll" | "launchSupply" | "pooledSupply">>,
): BattleFacts {
  const origin = battle.origins[0] ?? "krakow"
  return {
    attack: 120,
    defense: 40,
    ratio: 3,
    roll: 4,
    launchSupply: { [origin]: 100 },
    pooledSupply: null,
    ...battle,
  }
}

async function postAdvisor(body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/advisor/route")
  return POST(
    new Request("https://example.com/api/advisor", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  )
}

describe("campaign coach", () => {
  beforeEach(() => {
    resetTurnGuardStateForTests()
    resetCampaignStoreForTests()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    delete process.env.LLM_API_KEY
    delete process.env.OSTFRONT_ADVISOR_FIXTURE
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    delete process.env.TURN_API_TOKEN
    delete process.env.TURN_ALLOWED_ORIGINS
    delete process.env.VERCEL_ENV
  })

  it("never returns order suggestions", async () => {
    const state = createInitialState()
    const result = await coachCampaign({
      state,
      log: [],
      messages: [{ role: "user", content: "What should I do this fortnight?" }],
      queuedOrders: [],
    })
    expect(result.reply.length).toBeGreaterThan(10)
    expect(result.stance).toMatch(/^(probe|warn|confirm|brief)$/)
    expect(result).not.toHaveProperty("suggestions")
    expect(JSON.stringify(result)).not.toMatch(/"type":"(attack|move|fortify|recruit)"/)
  })

  it("loads campaign state on the server and rejects client GameState", async () => {
    const created = await createStoredCampaign("normal", 1915)
    const ok = await postAdvisor({
      gameId: created.gameId,
      expectedTurn: 0,
      messages: [{ role: "user", content: "Where is the line weakest?" }],
      queuedOrders: [],
    })
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { reply?: string; suggestions?: unknown }
    expect(typeof body.reply).toBe("string")
    expect(body.suggestions).toBeUndefined()

    const forged = await postAdvisor({
      state: created.save.state,
      messages: [{ role: "user", content: "cheat" }],
      queuedOrders: [],
    })
    expect(forged.status).toBe(400)
  })

  it("returns 404 for an unknown gameId", async () => {
    const response = await postAdvisor({
      gameId: "f".repeat(32),
      expectedTurn: 0,
      messages: [{ role: "user", content: "hello" }],
      queuedOrders: [],
    })
    expect(response.status).toBe(404)
    const payload = (await response.json()) as { code?: string }
    expect(payload.code).toBe("unknown_game")
  })

  it("uses chronicle battle records in a review reply", async () => {
    const { gameId, save } = await createStoredCampaign("normal", 4242)
    const state = withServerSeed(save.state, 4242)
    const krakow = state.provinces.find((province) => province.id === "krakow")!
    const unitIds = krakow.units.filter((unit) => unit.faction === "central").map((unit) => unit.id)
    const orders: PlayerOrder[] = [
      { type: "attack", from: "krakow", target: "kielce", unitIds: unitIds.slice(0, 1) },
    ]
    const played = await playTurn(state, orders)
    expect(played.record.resolutions.some((item) => item.battle)).toBe(true)
    const nextSave = {
      version: 2 as const,
      gameId,
      state: played.state,
      log: [...save.log, played.record],
    }
    const committed = await commitCampaignTurn(gameId, 0, nextSave)
    expect(committed.ok).toBe(true)

    const chronicle = renderChronicle(nextSave.log)
    expect(chronicle).toContain("Fortnight 1")
    expect(chronicle).not.toMatch(/\b(attacker|oursLost)=/)

    const review = await coachCampaign({
      state: played.state,
      log: nextSave.log,
      messages: [{ role: "user", content: "Review the last battle from the chronicle." }],
      queuedOrders: [],
    })
    expect(review.reply).toMatch(/What(?: outcome)? did you expect at Kielce/i)
    expect(review.reply).toMatch(/Kielce/i)
    expect(review.reply).not.toMatch(/\b(attacker|defender|weWon|oursLost)=/)
    expect(review.reply).not.toMatch(/unavailable offline|159 against/)
  })

  it("sanitizes highlights to catalog provinces and known ui ids", () => {
    const cleaned = sanitizeHighlights([
      { provinceId: "kielce", uiId: "queued-orders" },
      { provinceId: "not-a-place", uiId: "hack" },
      { provinceId: "lwow" },
    ])
    expect(cleaned).toEqual([
      { provinceId: "kielce", uiId: "queued-orders" },
      { provinceId: "lwow" },
    ])
  })

  it("discusses a queued attack with engine facts and map highlights", async () => {
    const state = createInitialState()
    const krakow = state.provinces.find((province) => province.id === "krakow")!
    const unitIds = krakow.units.filter((unit) => unit.faction === "central").map((unit) => unit.id)
    expect(unitIds.length).toBeGreaterThan(0)
    const queued: PlayerOrder[] = [
      { type: "attack", from: "krakow", target: "kielce", unitIds: unitIds.slice(0, 1) },
    ]
    const result = await coachCampaign({
      state,
      log: [],
      messages: [{ role: "user", content: "What do you make of my queued plan?" }],
      queuedOrders: queued,
      selectedProvinceId: "krakow",
    })
    expect(result.reply.toLowerCase()).toMatch(/kielce|expect|odds/)
    expect(result.highlights).toHaveLength(1)
    expect(result.highlights[0]?.provinceId).toBe("kielce")
  })

  it("labels ours/theirs from the Central Powers view when Russia attacked", () => {
    const battle: BattleFacts = battleFactsFixture({
      targetId: "krakow",
      attacker: "russia",
      defender: "central",
      kind: "assault",
      prongs: 1,
      origins: ["kielce"],
      attackerLoss: 12,
      defenderLoss: 40,
      encircled: false,
      attackerWon: true,
    })
    const line = formatBattleForCoach(battle)
    expect(line).toMatch(/Russian assault from Kielce/i)
    expect(line).toMatch(/Russia took Kraków|Krakow/i)
    expect(line).toContain("We lost 40, they lost 12")
    expect(line).not.toMatch(/\w+=\w+/)
  })

  it("writes battle reviews as plain sentences, never key=value debug fields", () => {
    const battle: BattleFacts = battleFactsFixture({
      targetId: "kielce",
      attacker: "central",
      defender: "russia",
      kind: "assault",
      prongs: 1,
      origins: ["krakow"],
      attackerLoss: 7,
      defenderLoss: 30,
      encircled: false,
      attackerWon: true,
      ratio: 5.48,
      roll: 6,
    })
    const summary =
      "Attack from Kraków into Kielce succeeds, odds 5.48 (roll 6). Kielce passes to the Central Powers. The remnants retreat to Warsaw, shaken. Losses — attackers 7, defenders 30."
    const line = formatBattleReviewForPlayer(0, "2 May 1915", battle, summary)
    expect(line).toMatch(/In fortnight 1 \(2 May 1915\) our assault from Kraków took Kielce at 5\.5:1 \(roll 6\)/i)
    expect(line).toContain("we lost 7, they lost 30")
    expect(line).not.toMatch(/159 against 56|remnants fell back/)
    expect(line).not.toMatch(/\b(attacker|defender|weWon|oursLost|theirsLost|kind)=/)
    expect(line).not.toMatch(/\.\./)
  })

  it("reviews the latest battle from structured records, not the oldest fortnight text", async () => {
    const early: TurnRecord = {
      turn: 0,
      date: "2 May 1915",
      narration: "",
      diplomacy: [],
      resolutions: [
        {
          proposal: { type: "attack", from: "krakow", target: "kielce", units: ["g-kra-11"] },
          status: "applied",
          summary: "Early fight at Kielce.",
          battle: battleFactsFixture({
            targetId: "kielce",
            attacker: "central",
            defender: "russia",
            kind: "assault",
            prongs: 1,
            origins: ["krakow"],
            attackerLoss: 1,
            defenderLoss: 2,
            encircled: false,
            attackerWon: true,
          }),
        },
      ],
      events: [],
      controlChanges: [],
      logistics: ["Central Powers collect 1 manpower."],
      notes: [],
      gmSource: "mock",
    }
    const late: TurnRecord = {
      ...early,
      turn: 2,
      date: "13 June 1915",
      resolutions: [
        {
          proposal: { type: "attack", from: "krakow", target: "lublin", units: ["g-kra-11"] },
          status: "applied",
          summary:
            "Attack from Kraków into Lublin fails, odds 0.80 (roll 2). Lublin holds. Losses — attackers 3, defenders 5.",
          battle: battleFactsFixture({
            targetId: "lublin",
            attacker: "central",
            defender: "russia",
            kind: "assault",
            prongs: 1,
            origins: ["krakow"],
            attackerLoss: 3,
            defenderLoss: 5,
            encircled: false,
            attackerWon: false,
            ratio: 0.8,
            roll: 2,
          }),
        },
      ],
      logistics: ["Central Powers collect 2 manpower."],
    }
    expect(latestBattleFacts([early, late]).at(-1)?.battle.targetId).toBe("lublin")
    const result = await coachCampaign({
      state: createInitialState(),
      log: [early, late],
      messages: [{ role: "user", content: "Review the last battle from the chronicle." }],
      queuedOrders: [],
    })
    expect(result.reply).toMatch(/Lublin/i)
    expect(result.reply).toMatch(/What(?: outcome)? did you expect at Lublin/i)
    expect(result.reply).toMatch(/fortnight 3/i)
    expect(result.reply).not.toMatch(/Kielce/i)
    expect(result.reply).not.toMatch(/\b(attacker|defender|weWon|oursLost|theirsLost)=/)
    expect(result.reply).not.toMatch(/unavailable offline|no battle (had )?resolved this fortnight/i)
    expect(result.highlights).toEqual([{ provinceId: "lublin" }])
  })

  it("reviews the most recent chronicle battle when asked how it went", async () => {
    const late: TurnRecord = {
      turn: 1,
      date: "16 May 1915",
      narration: "",
      diplomacy: [],
      resolutions: [
        {
          proposal: { type: "attack", from: "krakow", target: "kielce", units: ["g-kra-11"] },
          status: "applied",
          summary:
            "Attack from Kraków into Kielce succeeds, odds 5.48 (roll 6). Kielce passes to the Central Powers. Losses — attackers 7, defenders 30.",
          battle: battleFactsFixture({
            targetId: "kielce",
            attacker: "central",
            defender: "russia",
            kind: "assault",
            prongs: 1,
            origins: ["krakow"],
            attackerLoss: 7,
            defenderLoss: 30,
            encircled: false,
            attackerWon: true,
            ratio: 5.48,
            roll: 6,
          }),
        },
      ],
      events: [],
      controlChanges: [],
      logistics: [],
      notes: [],
      gmSource: "mock",
    }
    const result = await coachCampaign({
      state: createInitialState(),
      log: [late],
      messages: [{ role: "user", content: "how did that battle go?" }],
      queuedOrders: [],
    })
    expect(result.reply).toMatch(/fortnight 2/i)
    expect(result.reply).toMatch(/Kielce/i)
    expect(result.reply).not.toMatch(/no battle (had )?resolved this fortnight|no battles are recorded/i)
  })

  it("says plainly when the chronicle has no battles at all", async () => {
    const result = await coachCampaign({
      state: createInitialState(),
      log: [],
      messages: [{ role: "user", content: "how did that battle go?" }],
      queuedOrders: [],
    })
    expect(result.reply).toMatch(/No battles are recorded in the chronicle yet/i)
    expect(result.reply).not.toMatch(/before the dice/i)
  })

  it("asks intent first on a queued plan, with one odds fact and one highlight", async () => {
    const state = createInitialState()
    const krakow = state.provinces.find((province) => province.id === "krakow")!
    const unitIds = krakow.units.filter((unit) => unit.faction === "central").map((unit) => unit.id)
    const queued: PlayerOrder[] = [
      { type: "attack", from: "krakow", target: "kielce", unitIds },
    ]
    const result = await coachCampaign({
      state,
      log: [],
      messages: [{ role: "user", content: "What do you make of my queued plan?" }],
      queuedOrders: queued,
      selectedProvinceId: "krakow",
    })
    expect(playerStatedIntent([{ role: "user", content: "What do you make of my queued plan?" }])).toBe(false)
    expect(result.reply).toMatch(
      /What do you (?:expect taking Kielce|need Kielce)|How do you take Kielce/i,
    )
    expect(result.reply).toMatch(/about [\d.]+:1 on this queued column if the Russians don't reinforce/i)
    expect(result.reply).not.toMatch(/before the dice|as the engine resolves this fortnight/i)
    expect(result.reply).not.toMatch(/Ordered:|unavailable offline|159 against|Filed as noted/i)
    expect(result.reply).not.toMatch(/\.\./)
    expect(result.highlights).toEqual([{ provinceId: "kielce" }])
    const sentences = splitCoachSentences(result.reply)
    expect(sentences.length).toBeLessThanOrEqual(3)
    expect(sentences[0]).toMatch(/\?/)
  })

  it("compares a stated prediction to the chronicle result on review", async () => {
    const late: TurnRecord = {
      turn: 0,
      date: "2 May 1915",
      narration: "",
      diplomacy: [],
      resolutions: [
        {
          proposal: { type: "attack", from: "krakow", target: "kielce", units: ["g-kra-11"] },
          status: "applied",
          summary:
            "Attack from Kraków into Kielce succeeds, odds 5.48 (roll 6). Kielce passes to the Central Powers. Losses — attackers 7, defenders 30.",
          battle: battleFactsFixture({
            targetId: "kielce",
            attacker: "central",
            defender: "russia",
            kind: "assault",
            prongs: 1,
            origins: ["krakow"],
            attackerLoss: 7,
            defenderLoss: 30,
            encircled: false,
            attackerWon: true,
            ratio: 5.48,
            roll: 6,
          }),
        },
      ],
      events: [],
      controlChanges: [],
      logistics: [],
      notes: [],
      gmSource: "mock",
    }
    const messages = [
      { role: "user" as const, content: "I expect to take Kielce easily this fortnight." },
      { role: "user" as const, content: "Review the last battle from the chronicle." },
    ]
    expect(extractPlayerPrediction(messages)).toMatch(/expect to take Kielce/i)
    const result = await coachCampaign({
      state: createInitialState(),
      log: [late],
      messages,
      queuedOrders: [],
    })
    expect(result.reply).toMatch(/You expected/i)
    expect(result.reply).toMatch(/took Kielce/i)
    expect(result.reply).toMatch(/we lost 7, they lost 30/i)
    expect(result.reply).not.toMatch(/159 against 56/)
    expect(result.highlights).toEqual([{ provinceId: "kielce" }])
  })

  it("caps long coach replies to three sentences", () => {
    const long =
      "One. Two. Three. Four more that should go. Five should also go. And a sixth."
    const capped = capCoachReply(long)
    expect(splitCoachSentences(capped)).toHaveLength(3)
    expect(capped).not.toMatch(/Four more/)
  })

  it("scrubs supply ledger pairs from coach replies", () => {
    const noisy =
      "You took Kielce — the chronicle shows our over-supply of 159 against their 56 there. What did you expect?"
    const cleaned = capCoachReply(noisy)
    expect(cleaned).not.toMatch(/159 against 56/)
    expect(cleaned).toMatch(/You took Kielce/)
    expect(cleaned).toMatch(/What did you expect/)
  })

  it("quotes the same engagementOdds resolve uses when the enemy does not move", async () => {
    const state = createInitialState()
    const krakow = state.provinces.find((province) => province.id === "krakow")!
    const unitIds = krakow.units.filter((unit) => unit.faction === "central").map((unit) => unit.id)
    const attack: PlayerOrder = { type: "attack", from: "krakow", target: "kielce", unitIds }
    const queued: PlayerOrder[] = [attack]

    const resolvedMap = staffMap(state)
    const resolvedPreview = engagementOdds(resolvedMap, "krakow", "kielce", unitIds)
    expect(resolvedPreview).toBeTruthy()
    expect(Number.isFinite(resolvedPreview!.ratio)).toBe(true)

    // Order-panel style preview that skips the resolve-time staffMap path and inflates launch supply.
    const cardState = structuredClone(state)
    const cardFrom = cardState.provinces.find((province) => province.id === "krakow")!
    cardFrom.supply = 100
    cardFrom.networkSupply = 100
    const cardPreview = engagementOdds(cardState, "krakow", "kielce", unitIds)
    expect(cardPreview).toBeTruthy()
    expect(cardPreview!.ratio).toBeGreaterThan(resolvedPreview!.ratio)

    const coachPreview = queuedAttackPreview(resolvedMap, queued)
    expect(coachPreview?.odds).toMatch(/if the Russians don't reinforce/)
    expect(coachPreview?.odds).not.toMatch(/before the dice|as the engine resolves/i)
    const quotedPreview = extractCoachOddsRatio(coachPreview?.odds ?? "")
    expect(quotedPreview).toBeCloseTo(Math.round(resolvedPreview!.ratio * 10) / 10, 5)
    expect(quotedPreview!).toBeLessThan(Math.round(cardPreview!.ratio * 10) / 10)

    // Fixed state, no enemy moves: resolveTurn attack/defense floor matches engagementOdds.
    const { record } = resolveTurn(
      state,
      {
        proposals: [
          {
            type: "attack",
            from: "krakow",
            target: "kielce",
            units: unitIds,
          },
        ],
        events: [],
        narration: "",
        diplomacy: [],
      },
      { rng: () => 0 },
    )
    const battleLine = record.resolutions.find((item) => item.battle)?.summary ?? ""
    const postDice = battleLine.match(/odds\s+([\d.]+)/i)
    expect(postDice).toBeTruthy()
    // Chronicle prints post-dice ratio; coach must quote the pre-dice preview instead.
    expect(Number(postDice![1])).not.toBeCloseTo(quotedPreview!, 1)

    const result = await coachCampaign({
      state,
      log: [],
      messages: [{ role: "user", content: "What do you make of my queued plan?" }],
      queuedOrders: queued,
    })
    const quotedReply = extractCoachOddsRatio(result.reply)
    expect(quotedReply).toBeCloseTo(quotedPreview!, 5)
    expect(result.reply).toMatch(/if the Russians don't reinforce/i)
    expect(result.reply.match(/\d+(?:\.\d+)?\s*:\s*1/g)?.length ?? 0).toBe(1)
  })

  it("opens odds-only replies with a question and names the plan", () => {
    const shaped = shapeCoachReply("About 2.8:1 if the Russians don't reinforce.", null)
    const sentences = splitCoachSentences(shaped.reply)
    expect(sentences[0]).toMatch(/What does that figure change in your decision\?/)
    expect(sentences[0]).not.toMatch(/^\s*about\s+\d/i)
    expect(shaped.reply).toMatch(/2\.8:1/)
    expect(shaped.reply).not.toMatch(/on the queued plan/i)
    expect(sentences.length).toBeLessThanOrEqual(3)
    const planned = shapeCoachReply("About 2.8:1 if the Russians don't reinforce.", null, { queuedAttacks: true })
    expect(splitCoachSentences(planned.reply)[0]).toMatch(/\?/)
    expect(planned.reply).toMatch(/on the queued plan/i)
  })

  it("does not relabel chronicle battle odds as a queued plan", () => {
    const raw =
      "What outcome did you expect at Kielce? The chronicle shows our assault from Kraków into Kielce failed at 0.7:1 (roll 1); we lost 61, they lost 23."
    const plain = capCoachReply(raw)
    expect(plain).toMatch(/0\.7:1 \(roll 1\)/)
    expect(plain).not.toMatch(/on the queued plan/i)
    expect(plain).not.toMatch(/What does that ratio change in your plan/i)
    const withQueue = capCoachReply(raw, { queuedAttacks: true })
    expect(withQueue).toMatch(/0\.7:1 \(roll 1\)/)
    expect(withQueue).not.toMatch(/on the queued plan/i)
    expect(withQueue).not.toMatch(/What does that ratio change in your plan/i)
    const contact = capCoachReply("Kraków into Kielce is the strongest contact at about 4.2:1 if the Russians don't reinforce.")
    expect(contact).not.toMatch(/on the queued plan/i)
    expect(contact).toMatch(/about 4\.2:1/)
    expect(splitCoachSentences(contact)[0]).toMatch(/What does that figure change in your decision\?/)
    const bareBattle = capCoachReply("Our assault failed at 0.7:1 (roll 1); we lost 61, they lost 23.")
    expect(splitCoachSentences(bareBattle)[0]).toMatch(/What does that figure change in your decision\?/)
    expect(bareBattle).toMatch(/0\.7:1 \(roll 1\)/)
    expect(bareBattle).not.toMatch(/on the queued plan/i)
  })

  it("turns a clerk command into a tradeoff question", () => {
    const raw = "I file no orders. Cancel the fortify at Kraków before you march."
    const scrubbed = scrubPrescribedOrders(raw)
    expect(scrubbed).not.toMatch(/cancel the fortify/i)
    expect(scrubbed).not.toMatch(/i file no orders/i)
    expect(scrubbed).toMatch(/tradeoff/i)
    expect(scrubbed).toMatch(/I do not file orders/i)
    const shaped = shapeCoachReply(raw, null)
    expect(splitCoachSentences(shaped.reply)[0]).toMatch(/\?/)
    expect(shaped.reply).not.toMatch(/cancel the fortify/i)
  })

  it("puts the intent question first and keeps one odds figure in post-processing", () => {
    const messy =
      "The engine rates that column at about 6.0:1 if the Russians don't reinforce, and also about 8.1:1 combined. What do you need Kielce for this fortnight?"
    const shaped = shapeCoachReply(messy, null)
    expect(shaped.reply.startsWith("What do you need")).toBe(true)
    expect(shaped.reply.match(/\d+(?:\.\d+)?\s*:\s*1/g)?.length ?? 0).toBe(1)
    expect(putQuestionFirst(messy)).toMatch(/^What do you need/)
    expect(keepOneOddsFigure(messy).match(/\d+(?:\.\d+)?\s*:\s*1/g)?.length ?? 0).toBe(1)
  })

  it("drops whole comparison clauses instead of leaving dangling odds tails", () => {
    const samples = [
      "Your Kraków column is about 5.8:1 if the Russians don't reinforce, but adding Katowice would raise it to 7.6:1.",
      "That stand is about 1.2:1 if the Russians don't reinforce, and adding Bukovina and Stanislav would lift it to 2.1:1.",
      "Katowice alone is about 0.9:1 if the Russians don't reinforce; adding Kraków would make it two-pronged at 7.6:1.",
      "The starved prong pools to only 0.5:1 if the Russians don't reinforce while Kraków offers about 5.8:1.",
      "About 5.8:1 if the Russians don't reinforce, rising to 7.6:1 if you add the Silesian Landwehr from Katowice.",
    ]
    for (const sample of samples) {
      const cleaned = keepOneOddsFigure(sample)
      expect(cleaned.match(/\d+(?:\.\d+)?\s*:\s*1/g)?.length ?? 0).toBe(1)
      expect(hasDanglingCoachClause(cleaned)).toBe(false)
      expect(cleaned).not.toMatch(/\braise it to\s*[.!?]|\blift it to\s*[.!?]|\bpools? to only\s*[.!?]|\bmake it two-pronged at\s*[.!?]|\brising to if\b/i)
      expect(scrubDanglingOddsClauses("Adding Katowice would raise it to.")).toBe("")
    }
    expect(
      shapeCoachReply(
        "What do you need Kielce for this fortnight? About 5.8:1 if the Russians don't reinforce, adding Katowice would raise it to 7.6:1.",
        null,
      ).reply,
    ).not.toMatch(/raise it to\s*\./i)
  })

  it("does not strip ordinary when/than clauses that are not post-odds fragments", () => {
    const conditional = "Kielce is held lightly, and Lemberg falls when the Russians reinforce."
    expect(hasVerblessTrailingSubordinate(conditional)).toBe(false)
    expect(hasDanglingCoachClause(conditional)).toBe(false)
    expect(capCoachReply(conditional)).toMatch(/when the Russians reinforce/i)

    const comparison = "Kielce is weaker than Lublin."
    expect(hasVerblessTrailingSubordinate(comparison)).toBe(false)
    expect(capCoachReply(comparison)).toMatch(/weaker than Lublin/i)
  })

  it("cuts verbless when-clauses after stripping a second odds figure and restores ?", () => {
    const liveBroken =
      "Do you accept Lublin's two forts at about 2.20:1 when Kielce, taken by the same Kraków columns plus Katowice's Landwehr. The map shows Kielce held only by X Corps with no fort, while Lublin's garrison sits behind fort 2."
    expect(hasVerblessTrailingSubordinate(liveBroken.split(/(?<=\.)\s+/)[0]!)).toBe(true)
    expect(
      hasVerblessTrailingSubordinate(
        "Do you accept Lublin's two forts at about 2.20:1 when Kielce, taken by the same Kraków columns plus Katowice's Landwehr.",
      ),
    ).toBe(true)

    const withSecondOdds =
      "Do you accept Lublin's two forts at about 2.20:1 when Kielce offers about 6.1:1, taken by the same Kraków columns plus Katowice's Landwehr?"
    const kept = keepOneOddsFigure(withSecondOdds)
    expect(kept.match(/\d+(?:\.\d+)?\s*:\s*1/g)?.length ?? 0).toBe(1)
    expect(kept).toMatch(/2\.20:1/)
    expect(kept).not.toMatch(/\bwhen Kielce\b/i)
    expect(kept.trim().endsWith("?")).toBe(true)
    expect(hasVerblessTrailingSubordinate(kept)).toBe(false)
    expect(hasDanglingCoachClause(kept)).toBe(false)
    expect(scrubCoachOddsDecimals(kept)).toMatch(/2\.2:1/)

    const alreadyStripped =
      "Do you accept Lublin's two forts at about 2.20:1 when Kielce, taken by the same Kraków columns plus Katowice's Landwehr."
    const scrubbed = scrubVerblessSubordinates(alreadyStripped)
    expect(scrubbed).toMatch(/2\.20:1\?$|2\.2:1\?$/)
    expect(scrubbed).not.toMatch(/\bwhen Kielce\b/i)
    expect(hasMissingQuestionMark(alreadyStripped)).toBe(true)
    expect(hasMissingQuestionMark(scrubbed)).toBe(false)

    const capped = capCoachReply(liveBroken)
    expect(capped.match(/\d+(?:\.\d+)?\s*:\s*1/g)?.length ?? 0).toBeLessThanOrEqual(1)
    expect(capped).not.toMatch(/\bwhen Kielce, taken\b/i)
    expect(capped).not.toMatch(/\bfort\s+\d+\b/i)
    expect(capped).not.toMatch(/\bThe map shows\b/i)
    expect(capped).toMatch(/2\.2:1/)
    expect(capped).toMatch(/\?/)
    expect(hasVerblessTrailingSubordinate(capped)).toBe(false)
    expect(hasMissingQuestionMark(capped)).toBe(false)
  })

  it("normalizes fort labels and odds decimals for staff speech", () => {
    expect(fortLevelPhrase(0)).toBe("no forts")
    expect(fortLevelPhrase(1)).toBe("a fort")
    expect(fortLevelPhrase(2)).toBe("two forts")
    expect(scrubCoachFortLabels("Lublin sits behind fort 2.")).toBe("Lublin sits behind two forts.")
    expect(scrubCoachFortLabels("Przemyśl has fort 1.")).toBe("Przemyśl has a fort.")
    expect(scrubCoachOddsDecimals("about 2.20:1 if the Russians don't reinforce")).toBe(
      "about 2.2:1 if the Russians don't reinforce",
    )
    expect(scrubCoachOddsDecimals("stands at 2.37:1")).toBe("stands at 2.4:1")
    expect(scrubCoachOddsDecimals("about 6.0:1")).toBe("about 6:1")
    expect(capCoachReply("What holds Lublin? The garrison sits behind fort 2 at about 2.20:1.")).toMatch(
      /two forts/,
    )
    expect(capCoachReply("What holds Lublin? The garrison sits behind fort 2 at about 2.20:1.")).toMatch(
      /2\.2:1/,
    )
    expect(capCoachReply("What holds Lublin? The garrison sits behind fort 2 at about 2.20:1.")).not.toMatch(
      /fort\s+\d+|2\.20:1/,
    )
  })

  it("scrubs residual dice / combined-odds / staff-figures jargon", () => {
    expect(scrubCoachJargon("What did you expect the dice to give you?")).toMatch(
      /what outcome did you expect/i,
    )
    expect(scrubCoachJargon("Check the combined-odds board.")).toMatch(/Orders paper/i)
    expect(
      scrubCoachJargon("The figure you cite does not appear in my staff figures."),
    ).toMatch(/map dispatch/i)
    expect(scrubCoachJargon("the objective the map sets")).toMatch(/OHL's objective/i)
    expect(scrubCoachJargon("The map shows Kielce held only by X Corps.")).toMatch(/^Kielce held/i)
    expect(capCoachReply("What did you expect the dice to give you? Kielce held.")).not.toMatch(
      /\bdice\b|staff figures|combined-odds board/i,
    )
  })

  it("diagnoses fortify + attack conflicts instead of a stock Lemberg opener", async () => {
    const state = createInitialState()
    const map = staffMap(state)
    const unitIds = map.provinces
      .find((province) => province.id === "krakow")!
      .units.filter((unit) => unit.faction === "central")
      .map((unit) => unit.id)
    const queued: PlayerOrder[] = [
      { type: "fortify", provinceId: "krakow" },
      { type: "attack", from: "krakow", target: "kielce", unitIds },
    ]
    expect(detectQueuedOrderConflicts(map, queued).length).toBeGreaterThan(0)
    const result = await coachCampaign({
      state,
      log: [],
      messages: [{ role: "user", content: "Does my queued plan look sound?" }],
      queuedOrders: queued,
    })
    expect(result.reply).toMatch(/fortif|digging in|march/i)
    expect(result.reply).not.toMatch(/Lemberg push/i)
  })

  it("pairs the conflicting fortify+attack provinces, not the first queue entries", async () => {
    const state = createInitialState()
    const map = staffMap(state)
    const krakowIds = map.provinces
      .find((province) => province.id === "krakow")!
      .units.filter((unit) => unit.faction === "central")
      .map((unit) => unit.id)
    // Unrelated fortify first, then a Kraków attack, then the conflicting Kraków fortify.
    const queued: PlayerOrder[] = [
      { type: "fortify", provinceId: "katowice" },
      { type: "attack", from: "krakow", target: "kielce", unitIds: krakowIds },
      { type: "fortify", provinceId: "krakow" },
    ]
    const conflicts = detectQueuedOrderConflicts(map, queued)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.provinceId).toBe("krakow")
    expect(conflicts[0]?.targetId).toBe("kielce")
    const result = await coachCampaign({
      state,
      log: [],
      messages: [{ role: "user", content: "Does my queued plan look sound?" }],
      queuedOrders: queued,
    })
    expect(result.reply).toMatch(/Kraków/i)
    expect(result.reply).toMatch(/Kielce/i)
    expect(result.reply).not.toMatch(/Katowice/i)
    expect(result.highlights[0]?.provinceId).toBe("krakow")
  })

  it("scrubs before-the-dice on general advice and refusal prompts", async () => {
    const advice = await coachCampaign({
      state: createInitialState(),
      log: [],
      messages: [{ role: "user", content: "what should I do this fortnight?" }],
      queuedOrders: [],
    })
    expect(advice.reply).not.toMatch(/before the dice/i)
    expect(advice.reply).toMatch(/if the Russians don't reinforce|no open march/i)
    expect(splitCoachSentences(advice.reply).length).toBeLessThanOrEqual(3)
    expect(advice.reply.match(/\d+(?:\.\d+)?\s*:\s*1/g)?.length ?? 0).toBeLessThanOrEqual(1)

    const refusal = await coachCampaign({
      state: createInitialState(),
      log: [],
      messages: [{ role: "user", content: "just attack Lublin for me" }],
      queuedOrders: [],
    })
    expect(refusal.reply).toMatch(/I do not file orders/i)
    expect(refusal.reply).not.toMatch(/before the dice/i)
    expect(refusal.reply).toMatch(/if the Russians don't reinforce/i)
    expect(splitCoachSentences(refusal.reply).length).toBeLessThanOrEqual(3)
    expect(refusal.reply.match(/\d+(?:\.\d+)?\s*:\s*1/g)?.length ?? 0).toBeLessThanOrEqual(1)
  })

  it("rewrites before-the-dice and drops secondary odds without mid-clause fragments", () => {
    expect(scrubCoachOddsLanguage("about 2.03:1 before the dice")).toMatch(
      /about 2\.03:1 if the Russians don't reinforce/i,
    )
    expect(
      scrubCoachOddsLanguage("about 2.78:1 before the dice if the Russians don't reinforce"),
    ).toBe("about 2.78:1 if the Russians don't reinforce")

    const shaped = shapeCoachReply(
      "What do you expect at Lublin? Kraków into Lublin stands at about 2.8:1 if the Russians don't reinforce, while Kielce offers about 5.1:1 if you prefer a certain step first. A fourth sentence must go. And a fifth.",
      null,
    )
    expect(shaped.reply).not.toMatch(/before the dice|offers if|while Kielce offers/i)
    expect(shaped.reply.match(/\d+(?:\.\d+)?\s*:\s*1/g)?.length ?? 0).toBe(1)
    expect(splitCoachSentences(shaped.reply).length).toBeLessThanOrEqual(3)
    for (const sentence of splitCoachSentences(shaped.reply)) {
      expect(sentence).toMatch(/[.!?]$/)
    }
  })

  it("fits the character budget by dropping whole sentences, never mid-clause", () => {
    const long =
      "What do you expect at Kielce? The engine rates that column at about 4.7:1 if the Russians don't reinforce. " +
      "This long filler sentence keeps going with enough words to push the reply over the hard character budget so the fit step must drop it whole rather than slice a clause midstream for the player."
    const fitted = fitCoachReplyLength(long, 160)
    expect(fitted.length).toBeLessThanOrEqual(160)
    expect(fitted).not.toMatch(/midstream for the pla/i)
    expect(splitCoachSentences(fitted).every((sentence) => /[.!?…]$/.test(sentence))).toBe(true)
  })

  it("never claims an illegal Kraków→Warsaw ask was filed", async () => {
    const filed = scrubCoachFiledClaims(
      "Filed as noted. Kraków does not border Warsaw, so that arrow cannot stand.",
    )
    expect(filed).not.toMatch(/Filed as noted/i)
    expect(filed).toMatch(/I do not file orders/i)

    // Mentioning the player's queue must not be scrubbed away.
    const aboutQueue =
      "What do you expect this queued attack to achieve? The engine rates that column at about 4.7:1 if the Russians don't reinforce."
    expect(scrubCoachFiledClaims(aboutQueue)).toBe(aboutQueue)
    expect(scrubCoachFiledClaims("Your queued orders into Kielce look sound.")).toMatch(/queued orders/i)
    // Plain past-tense claims that the coach itself filed must still be scrubbed.
    expect(scrubCoachFiledClaims("I filed your order for Kielce.")).toMatch(/I do not file orders/i)
    expect(scrubCoachFiledClaims("I noted your orders for Lemberg.")).toMatch(/I do not file orders/i)
    expect(scrubCoachFiledClaims("I queued an order for Kielce.")).toMatch(/I do not file orders/i)

    const result = await coachCampaign({
      state: createInitialState(),
      log: [],
      messages: [{ role: "user", content: "Attack Warsaw from Kraków this fortnight." }],
      queuedOrders: [],
      selectedProvinceId: "krakow",
    })
    expect(result.reply).not.toMatch(/filed as noted|has been filed|order (?:was |is )?noted|i(?:'ve| have) queued/i)
    expect(result.reply).not.toMatch(/\bFiled\b/)
  })

  it("does not attach unrelated combat odds when the queue has no attack", () => {
    const state = createInitialState()
    expect(queuedAttackPreview(state, [{ type: "fortify", provinceId: "krakow" }])).toBeNull()
  })

  it("quotes odds for the committed unitIds, not default formations", () => {
    const state = createInitialState()
    const krakow = state.provinces.find((province) => province.id === "krakow")!
    const centrals = krakow.units.filter((unit) => unit.faction === "central")
    expect(centrals.length).toBeGreaterThan(1)
    const one = centrals[0]!
    const allIds = centrals.map((unit) => unit.id)
    const committed = queuedAttackPreview(state, [
      { type: "attack", from: "krakow", target: "kielce", unitIds: [one.id] },
    ])
    const full = queuedAttackPreview(state, [
      { type: "attack", from: "krakow", target: "kielce", unitIds: allIds },
    ])
    expect(committed?.targetId).toBe("kielce")
    expect(full?.targetId).toBe("kielce")
    expect(committed?.odds).toBeTruthy()
    expect(full?.odds).toBeTruthy()
    expect(committed?.odds).not.toBe(full?.odds)
  })
})

describe("campaign coach guards", () => {
  beforeEach(() => {
    resetTurnGuardStateForTests()
    resetCampaignStoreForTests()
    delete process.env.TURN_API_TOKEN
    delete process.env.TURN_ALLOWED_ORIGINS
    delete process.env.TURN_MAX_BODY_BYTES
    delete process.env.TURN_RATE_LIMIT_MAX
    delete process.env.LLM_API_KEY
    delete process.env.VERCEL_ENV
  })

  it("rejects an oversized body", async () => {
    process.env.TURN_MAX_BODY_BYTES = "200"
    const response = await postAdvisor({
      gameId: "a".repeat(32),
      expectedTurn: 0,
      messages: [{ role: "user", content: "x".repeat(400) }],
    })
    expect(response.status).toBe(413)
  })

  it("rejects a foreign origin when origins are configured", async () => {
    process.env.TURN_ALLOWED_ORIGINS = "https://allowed.example"
    const created = await createStoredCampaign("normal")
    const response = await postAdvisor(
      {
        gameId: created.gameId,
        expectedTurn: 0,
        messages: [{ role: "user", content: "hi" }],
      },
      { origin: "https://evil.example" },
    )
    expect(response.status).toBe(403)
  })

  it("requires the turn token when one is configured", async () => {
    process.env.TURN_API_TOKEN = "secret-token"
    const created = await createStoredCampaign("normal")
    const denied = await postAdvisor({
      gameId: created.gameId,
      expectedTurn: 0,
      messages: [{ role: "user", content: "hi" }],
    })
    expect(denied.status).toBe(401)
    const allowed = await postAdvisor(
      {
        gameId: created.gameId,
        expectedTurn: 0,
        messages: [{ role: "user", content: "hi" }],
      },
      { "x-ostfront-turn-token": "secret-token" },
    )
    expect(allowed.status).toBe(200)
  })

  it("requires the reinforcement caveat only until the player has seen it once", async () => {
    const state = createInitialState()
    const krakow = state.provinces.find((province) => province.id === "krakow")!
    const unitIds = krakow.units.filter((unit) => unit.faction === "central").map((unit) => unit.id)
    const queued: PlayerOrder[] = [{ type: "attack", from: "krakow", target: "kielce", unitIds }]
    const first = await coachCampaign({
      state,
      log: [],
      messages: [{ role: "user", content: "What do you make of my queued plan?" }],
      queuedOrders: queued,
    })
    expect(first.reply).toMatch(/if the Russians don't reinforce/i)
    const prior = [
      { role: "user" as const, content: "What do you make of my queued plan?" },
      { role: "advisor" as const, content: first.reply },
      { role: "user" as const, content: "Yes, deal with Warsaw first." },
    ]
    expect(conversationStatedReinforceCaveat(prior)).toBe(true)
    expect(shouldQuoteReinforceCaveat(prior, staffMap(state), "kielce")).toBe(
      reinforcementsPlausiblyMatter(staffMap(state), "kielce"),
    )
    const followUp = await coachCampaign({
      state,
      log: [],
      messages: prior,
      queuedOrders: queued,
    })
    if (!reinforcementsPlausiblyMatter(staffMap(state), "kielce")) {
      expect(followUp.reply).not.toMatch(/if the Russians don't reinforce/i)
    }
    expect(capCoachReply("What next? That column stands at about 2.2:1.")).toBe(
      "What next? That column stands at about 2.2:1.",
    )
  })

  it("keeps concentric odds when only one prong fails supply validation", () => {
    const state = createInitialState()
    const map = staffMap(state)
    const krakowIds = map.provinces
      .find((province) => province.id === "krakow")!
      .units.filter((unit) => unit.faction === "central")
      .map((unit) => unit.id)
    const katowiceIds = map.provinces
      .find((province) => province.id === "katowice")!
      .units.filter((unit) => unit.faction === "central")
      .map((unit) => unit.id)
    map.provinces.find((province) => province.id === "katowice")!.supply = 26
    const queued: PlayerOrder[] = [
      { type: "attack", from: "krakow", target: "kielce", unitIds: krakowIds },
      { type: "attack", from: "katowice", target: "kielce", unitIds: katowiceIds },
    ]
    const odds = queuedAttackOddsByTarget(map, queued)
    const row = odds.get("kielce")
    expect(row?.phrase).toMatch(/:\s*1/)
    expect(row?.phrase).not.toMatch(/^REJECTED/)
    expect(row?.rejectedProngs.length).toBe(1)
    expect(renderQueuedResolutionOdds(map, queued)).toMatch(/REJECTED_PRONG/)
  })

  it("resolves reachability destination from question wording", () => {
    const map = staffMap(createInitialState())
    const endpoints = resolveReachabilityEndpoints(
      map,
      "From Lublin, can I reach Warsaw this fortnight?",
      "lublin",
    )
    expect(endpoints.fromId).toBe("lublin")
    expect(endpoints.targetId).toBe("warszawa")
  })

  it("matches ASCII Lodz to Łódź via id, alias, and diacritic fold", () => {
    const map = staffMap(createInitialState())
    expect(collectMentionedProvinceIds(map, "Is Lodz reachable from Lublin?")).toEqual(
      expect.arrayContaining(["lodz", "lublin"]),
    )
    const endpoints = resolveReachabilityEndpoints(map, "Is Lodz reachable from Lublin?", null)
    expect(endpoints.fromId).toBe("lublin")
    expect(endpoints.targetId).toBe("lodz")
  })

  it("matches Łódź with native spelling and word boundaries", () => {
    const map = staffMap(createInitialState())
    const endpoints = resolveReachabilityEndpoints(map, "Is Łódź reachable from Lublin?", null)
    expect(endpoints.fromId).toBe("lublin")
    expect(endpoints.targetId).toBe("lodz")
  })

  it("matches a partial multi-word province label (Masuren)", () => {
    const map = staffMap(createInitialState())
    const mentioned = collectMentionedProvinceIds(map, "Is Masuren reachable from Warsaw?")
    expect(mentioned).toContain("ermland_masuren")
    expect(mentioned).toContain("warszawa")
    expect(mentioned).not.toContain("niederschlesien")
    const endpoints = resolveReachabilityEndpoints(map, "Is Masuren reachable from Warsaw?", null)
    expect(endpoints.fromId).toBe("warszawa")
    expect(endpoints.targetId).toBe("ermland_masuren")
  })

  it("allows bare Silesia token when no fuller province name is given", () => {
    const map = staffMap(createInitialState())
    const mentioned = collectMentionedProvinceIds(map, "Can we reach Silesia from Krakow?")
    expect(mentioned).toContain("krakow")
    expect(
      mentioned.some((id) => id === "niederschlesien" || id === "oberschlesien" || id === "czeske_slezsko"),
    ).toBe(true)
  })

  it("ignores generic direction words in reachability parsing", () => {
    const map = staffMap(createInitialState())
    const eastern = resolveReachabilityEndpoints(
      map,
      "Can Lublin reach the eastern front from Warsaw?",
      "lublin",
    )
    expect(eastern.targetId).not.toBe("eastern_slovakia")
    const west = resolveReachabilityEndpoints(map, "Can Lublin reach Warsaw from the west?", "lublin")
    expect(west.fromId).toBe("lublin")
    expect(west.fromId).not.toBe("gdynia")
  })

  it("does not conflate Upper and Lower Silesia on shared tokens", () => {
    const map = staffMap(createInitialState())
    const question = "Is Upper Silesia reachable from Lublin?"
    const mentioned = collectMentionedProvinceIds(map, question)
    expect(mentioned).toContain("oberschlesien")
    expect(mentioned).toContain("lublin")
    expect(mentioned).not.toContain("niederschlesien")
    const endpoints = resolveReachabilityEndpoints(map, question, null)
    expect(endpoints.fromId).toBe("lublin")
    expect(endpoints.targetId).toBe("oberschlesien")
  })

  it("rejects queued attacks below supply 30 instead of quoting odds", async () => {
    const state = createInitialState()
    const lublin = state.provinces.find((province) => province.id === "lublin")!
    const krakow = state.provinces.find((province) => province.id === "krakow")!
    lublin.controller = "central"
    lublin.units = krakow.units.filter((unit) => unit.faction === "central")
    krakow.units = krakow.units.filter((unit) => unit.faction !== "central")
    const map = staffMap(state)
    map.provinces.find((province) => province.id === "lublin")!.supply = 26
    const unitIds = map.provinces
      .find((province) => province.id === "lublin")!
      .units.filter((unit) => unit.faction === "central")
      .map((unit) => unit.id)
    const target = lublin.neighbors.find(
      (id) => map.provinces.find((province) => province.id === id)?.controller === "russia",
    )!
    const check = coachAttackOrderCheck(map, { type: "attack", from: "lublin", target, unitIds })
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/supply is 26 \(need 30\)/)

    const result = await coachCampaign({
      state: map,
      log: [],
      messages: [{ role: "user", content: "What do you make of my queued plan?" }],
      queuedOrders: [{ type: "attack", from: "lublin", target, unitIds }],
      selectedProvinceId: "lublin",
    })
    expect(result.reply).toMatch(/supply/i)
    expect(result.reply).not.toMatch(/:\s*1/)
  })

  it("prefers the latest rejected chronicle row over an older battle", async () => {
    const log: TurnRecord[] = [
      {
        turn: 0,
        date: "2 May 1915",
        narration: "",
        diplomacy: [],
        resolutions: [
          {
            proposal: { type: "attack", from: "krakow", target: "kielce", units: ["g-kra-11"] },
            status: "applied",
            summary: "Attack from Kraków into Kielce succeeds.",
            battle: battleFactsFixture({
              targetId: "kielce",
              attacker: "central",
              defender: "russia",
              kind: "assault",
              prongs: 1,
              origins: ["krakow"],
              attackerLoss: 1,
              defenderLoss: 2,
              encircled: false,
              attackerWon: true,
            }),
          },
        ],
        events: [],
        controlChanges: [],
        logistics: [],
        notes: [],
        gmSource: "mock",
      },
      {
        turn: 1,
        date: "16 May 1915",
        narration: "",
        diplomacy: [],
        resolutions: [
          {
            proposal: { type: "attack", from: "lublin", target: "kielce", units: ["g-kra-11"] },
            status: "rejected",
            summary: "The attack from Lublin cannot march: supply is 26 (need 30).",
          },
        ],
        events: [],
        controlChanges: [],
        logistics: [],
        notes: [],
        gmSource: "mock",
      },
    ]
    expect(latestChronicleEvidence(log)?.kind).toBe("rejected")
    expect(renderChronicle(log)).toMatch(/REJECTED:.*supply is 26/)
    const result = await coachCampaign({
      state: createInitialState(),
      log,
      messages: [{ role: "user", content: "Review the last battle from the chronicle." }],
      queuedOrders: [],
    })
    expect(result.reply).toMatch(/fortnight 2/i)
    expect(result.reply).toMatch(/rejected|supply is 26/i)
    expect(result.reply).not.toMatch(/no battles are recorded/i)
  })
})
