import { describe, expect, it } from "vitest"
import { TeachResolveRequestSchema } from "@/lib/schema"
import { teachSelectedProvinceIds } from "@/lib/teach/selected-provinces"

describe("teachSelectedProvinceIds", () => {
  it("omits a null selection so resolve payloads stay string arrays", () => {
    const ids = teachSelectedProvinceIds(null, [
      { from: "krakow", to: "lublin" },
      { from: "kielce", to: "lublin" },
    ])
    expect(ids).toEqual(["krakow", "kielce", "lublin"])
    expect(ids.every((id) => typeof id === "string")).toBe(true)

    const parsed = TeachResolveRequestSchema.safeParse({
      lessonId: "converging-lublin",
      variant: "guided",
      orders: [],
      reasoning: "",
      prediction: "Merged converging battle on Lublin before the die.",
      selectedProvinceIds: ids,
    })
    expect(parsed.success).toBe(true)
  })

  it("rejects a payload that still includes null (regression for toggle-deselect)", () => {
    const parsed = TeachResolveRequestSchema.safeParse({
      lessonId: "converging-lublin",
      variant: "guided",
      orders: [],
      reasoning: "",
      prediction: "Merged converging battle on Lublin before the die.",
      selectedProvinceIds: [null, "krakow"],
    })
    expect(parsed.success).toBe(false)
  })

  it("keeps the selected province when set", () => {
    expect(teachSelectedProvinceIds("lublin", [{ from: "krakow", to: "lublin" }])).toEqual([
      "lublin",
      "krakow",
    ])
  })
})
