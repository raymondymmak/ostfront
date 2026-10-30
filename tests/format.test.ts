import { describe, expect, it } from "vitest"
import { CATALOG } from "@/lib/data/catalog"
import { normalizeName } from "@/lib/format"

describe("normalizeName", () => {
  it("folds Polish letters, including ł, onto the ASCII aliases", () => {
    expect(normalizeName("Płock")).toBe("plock")
    expect(normalizeName("Białystok")).toBe("bialystok")
    expect(normalizeName("Suwałki")).toBe("suwalki")
    expect(normalizeName("Łódź")).toBe("lodz")
    expect(normalizeName("Mława")).toBe("mlawa")
    expect(normalizeName("Chełm")).toBe("chelm")
    expect(normalizeName("Lwów")).toBe("lwow")
    expect(normalizeName("ąęćńóśźż")).toBe("aecnoszz")
    expect(normalizeName("ĄĘĆŃÓŚŹŻŁ")).toBe("aecnoszzl")
    expect(normalizeName("Königsberg")).toBe("konigsberg")
    expect(normalizeName("Aukštaitija")).toBe("aukstaitija")
  })

  it("keeps every catalog name and alias in plain letters", () => {
    for (const province of CATALOG) {
      const labels = [province.name, ...province.aliases]
      for (const label of labels) {
        const folded = normalizeName(label)
        expect(folded, label).toMatch(/^[a-z0-9]+(?: [a-z0-9]+)*$/)
      }
      const ascii = province.aliases.find((alias) => alias === normalizeName(province.name))
      if (ascii) expect(normalizeName(province.name)).toBe(normalizeName(ascii))
    }
  })
})
