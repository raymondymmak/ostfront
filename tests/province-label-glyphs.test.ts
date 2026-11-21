import { existsSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { PROVINCE_LABEL_FONT, provinceLabelCollection } from "@/lib/map/province-label-layers"

describe("province label glyphs", () => {
  it("bundles ★ and ◆ glyph ranges under the Noto Serif fontstack", () => {
    expect(PROVINCE_LABEL_FONT).toEqual(["Noto Serif Regular"])
    expect(existsSync("public/fonts/Noto Serif Regular/9472-9727.pbf")).toBe(true)
    expect(existsSync("public/fonts/Noto Serif Regular/9728-9983.pbf")).toBe(true)
  })

  it("prefixes objective and depot marks in label GeoJSON", () => {
    const collection = provinceLabelCollection(
      [
        {
          id: "krakow",
          name: "Kraków",
          controller: "central",
          terrain: "urban",
          supply: 100,
          unrest: 0,
          fort: 0,
          neighbors: [],
          rail: [],
          units: [],
          depot: "central",
          vp: 2,
          polygon: { type: "Polygon", coordinates: [] },
          centroid: [0, 0],
        },
      ] as never,
      null,
    )
    expect(collection.features[0]?.properties?.name).toMatch(/★/)
    expect(collection.features[0]?.properties?.name).toMatch(/◆/)
  })
})
