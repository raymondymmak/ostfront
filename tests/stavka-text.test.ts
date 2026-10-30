import { describe, expect, it } from "vitest"
import { DIPLOMACY, narrateStavka } from "@/lib/ai/stavka"
import { createInitialState } from "@/lib/data/scenario"
import type { Proposal } from "@/lib/types"

function attacks(target: string, count: number): Proposal[] {
  return Array.from({ length: count }, (_, index) => ({
    type: "attack" as const,
    from: `from-${target}-${index}`,
    target,
    units: [`u-${target}-${index}`],
  }))
}

function secondParagraph(narration: string): string {
  return narration.split("\n\n")[1] ?? ""
}

function openingSentence(narration: string): string {
  const paragraph = secondParagraph(narration)
  const end = paragraph.indexOf(".")
  return end === -1 ? paragraph : paragraph.slice(0, end + 1)
}

describe("Stavka chronicle attack sentences", () => {
  const state = createInitialState("normal")

  const cases: { name: string; proposals: Proposal[]; sentence: string }[] = [
    {
      name: "one target",
      proposals: attacks("kielce", 1),
      sentence: "Stavka strikes at Kielce.",
    },
    {
      name: "one two-pronged target",
      proposals: attacks("kielce", 2),
      sentence: "Stavka attacks Kielce from two sides.",
    },
    {
      name: "one three-prong target",
      proposals: attacks("kielce", 3),
      sentence: "Stavka closes on Kielce from three sides.",
    },
    {
      name: "a two-pronged target plus a single target",
      proposals: [...attacks("lublin", 2), ...attacks("kielce", 1)],
      sentence: "Stavka attacks Lublin from two sides and strikes at Kielce.",
    },
    {
      name: "two single targets",
      proposals: [...attacks("lublin", 1), ...attacks("kielce", 1)],
      sentence: "Stavka strikes at Kielce and Lublin.",
    },
  ]

  for (const item of cases) {
    it(item.name, () => {
      const narration = narrateStavka(state, item.proposals)
      expect(openingSentence(narration)).toBe(item.sentence)
      expect(secondParagraph(narration)).toContain(
        "Garrisons stay behind, and the dice still belong to the engine.",
      )
      const forbidden = ["attacks at a", "commits " + "attacks at", "two-pronged " + "attack at"]
      for (const phrase of forbidden) expect(narration).not.toContain(phrase)
    })
  }
})

describe("Stavka diplomacy point of view", () => {
  it("keeps six Russian lines and drops the German high-command sentence", () => {
    expect(DIPLOMACY).toHaveLength(6)
    for (const line of DIPLOMACY) {
      expect(line.startsWith("Falkenhayn has")).toBe(false)
      expect(line).not.toContain("Falkenhayn has")
      expect(line).not.toContain("will send no more")
    }
  })
})
