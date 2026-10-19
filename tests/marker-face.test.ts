import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { applyMarkerFace, type MarkerFaceTarget } from "@/lib/map/marker-face"

function element(classes: string[]): MarkerFaceTarget & { classes: () => string[] } {
  const names = new Set(classes)
  return {
    classList: {
      add: (...added: string[]) => {
        for (const name of added) names.add(name)
      },
      remove: (...removed: string[]) => {
        for (const name of removed) names.delete(name)
      },
      contains: (name: string) => names.has(name),
      [Symbol.iterator]: () => names.values(),
    },
    style: { position: "", top: "", left: "", pointerEvents: "" },
    innerHTML: "",
    dataset: { province: "", lng: "", lat: "" },
    classes: () => [...names],
  }
}

describe("province marker faces", () => {
  it("keeps MapLibre's positioning class when the selection changes", () => {
    const marker = element(["maplibregl-marker", "maplibregl-marker-anchor-center", "map-tag"])
    applyMarkerFace(marker, {
      className: "map-tag is-selected",
      innerHTML: "<div class=\"map-tag-name\">Warsaw</div><div class=\"map-badge\">75</div>",
      provinceId: "warszawa",
      lng: 0.4,
      lat: -1.2,
    })
    expect(marker.classes()).toContain("maplibregl-marker")
    expect(marker.classes()).toContain("maplibregl-marker-anchor-center")
    expect(marker.classes()).toContain("map-tag")
    expect(marker.classes()).toContain("is-selected")
    expect(marker.style.position).toBe("absolute")
    expect(marker.style.top).toBe("0")
    expect(marker.style.left).toBe("0")
    expect(marker.dataset.province).toBe("warszawa")
    expect(marker.innerHTML).toContain("Warsaw")
  })

  it("drops a stale selection without letting the marker rejoin the document flow", () => {
    const marker = element(["maplibregl-marker", "map-tag", "is-selected", "is-depot"])
    applyMarkerFace(marker, {
      className: "map-tag",
      innerHTML: "<div class=\"map-tag-name\">Minsk</div>",
      provinceId: "minsk",
      lng: 1,
      lat: 0.2,
    })
    expect(marker.classes()).toEqual(["maplibregl-marker", "map-tag"])
    expect(marker.style.position).toBe("absolute")
  })

  it("does not assign marker className in the map component", () => {
    const source = readFileSync("components/war-map.tsx", "utf8")
    expect(source).toContain("applyMarkerFace")
    expect(source).not.toMatch(/\.className\s*=/)
  })
})
