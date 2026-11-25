import { describe, expect, it } from "vitest"
import { createInitialState } from "@/lib/data/scenario"
import { finalizeHarnessReply, reshapeHarnessReplyForPlayer } from "@/lib/gm/advisor-harness"
import { staffMap } from "@/lib/gm/advisor"

describe("advisor harness style", () => {
  it("scrubs hedge phrasing but keeps direct replies", () => {
    const hedged = reshapeHarnessReplyForPlayer(
      "The available facts do not establish whether Warsaw is legal.",
    )
    expect(hedged.toLowerCase()).not.toContain("do not establish")

    const direct = reshapeHarnessReplyForPlayer("No — that axis is not on the dispatch.")
    expect(direct).toMatch(/^no/i)
  })

  it("finalizeHarnessReply strips reach-only", () => {
    const map = staffMap(createInitialState())
    const out = finalizeHarnessReply(
      map,
      "brief",
      "Warsaw is reach-only from Lublin this fortnight.",
      [],
    )
    expect(out.reply.toLowerCase()).not.toContain("reach-only")
  })
})