import { describe, expect, it } from "vitest"
import { toggleSelection } from "@/lib/ui/selection"

describe("toggleSelection", () => {
  it("selects a new province", () => {
    expect(toggleSelection(null, "krakow")).toBe("krakow")
    expect(toggleSelection("warszawa", "krakow")).toBe("krakow")
  })

  it("clears when the same province is clicked again", () => {
    expect(toggleSelection("krakow", "krakow")).toBeNull()
  })
})