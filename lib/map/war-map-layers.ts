import {
  BACKDROP_LABEL_FONT,
  PROVINCE_LABEL_FONT,
  createCounterPillImage,
  provinceLabelOpacityExpression,
} from "@/lib/map/province-label-layers"
import {
  RAIL_FULL_ZOOM,
  RAIL_HIDDEN_ZOOM,
  RAIL_STYLE,
} from "@/lib/map/rail-lines"
import {
  LESSON_FOCUS_FILL_LAYER,
  LESSON_HIGHLIGHT_BRASS,
  LESSON_HIGHLIGHT_BRASS_DEEP,
  LESSON_SOURCE_DASH,
  LESSON_SOURCE_FILL_OPACITY,
  LESSON_SOURCE_LINE_WIDTH,
  LESSON_SOURCE_OUTLINE_LAYER,
  LESSON_TARGET_LINE_WIDTH,
  LESSON_TARGET_OUTLINE_LAYER,
} from "@/lib/map/lesson-highlight"
import { TARGET_HIGHLIGHT_FADE_MS, TARGET_HIGHLIGHT_LAYER } from "@/lib/map/target-highlight"
import { TARGET_OUTLINE } from "@/lib/map/target-outline-style"
import type * as maplibregl from "maplibre-gl"

/** Base province fill — always the mode colour; lifts live on `target-fill`. */
export function provinceFillColor(): maplibregl.ExpressionSpecification {
  return ["get", "fill"]
}

export function provinceFillOpacity(): maplibregl.ExpressionSpecification {
  return ["case", ["boolean", ["feature-state", "hover"], false], 0.96, 0.9]
}

/** Neighbour lift colours; opacity is pulsed via `pulseTargetHighlight` (paint transition). */
export function targetFillColor(): maplibregl.ExpressionSpecification {
  return [
    "match",
    ["feature-state", "role"],
    "reach",
    ["get", "liftSoft"],
    "move",
    ["get", "lift"],
    "attack",
    ["get", "lift"],
    "rgba(0,0,0,0)",
  ]
}

function railFade(scale = 1): maplibregl.ExpressionSpecification {
  return ["interpolate", ["linear"], ["zoom"], RAIL_HIDDEN_ZOOM, 0, RAIL_FULL_ZOOM, scale]
}

/** Zoom interpolate must stay top-level; MapLibre rejects nesting it under `*`. */
function railWidth(open: number, close: number): maplibregl.ExpressionSpecification {
  return ["interpolate", ["linear"], ["zoom"], RAIL_HIDDEN_ZOOM, 0, RAIL_FULL_ZOOM, open, 8.4, close]
}

/** Held-side rails: bake hot scale into interpolate stops (zoom stays top-level). */
function railWidthHot(open: number, close: number): maplibregl.ExpressionSpecification {
  const scale: maplibregl.ExpressionSpecification = ["coalesce", ["get", "hotWidthScale"], 1]
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    RAIL_HIDDEN_ZOOM,
    0,
    RAIL_FULL_ZOOM,
    ["*", scale, open],
    8.4,
    ["*", scale, close],
  ]
}

/** MapLibre layers for the campaign theater (after base sources are registered). */
export function installWarMapLayers(map: maplibregl.Map, backdropOwnerColors: Record<string, string>) {
  const ownerEntries = Object.entries(backdropOwnerColors).flat()
  map.addLayer({
    id: "sea",
    type: "fill",
    source: "sea",
    paint: { "fill-color": "#4f7f9d", "fill-opacity": 1 },
  })
  map.addLayer({
    id: "land",
    type: "fill",
    source: "land",
    paint: { "fill-color": "#8f9699", "fill-opacity": 0.98 },
  })
  map.addLayer({
    id: "backdrop",
    type: "fill",
    source: "backdrop",
    paint: {
      "fill-color": [
        "match",
        ["get", "owner"],
        ...ownerEntries,
        "#b4b2ae",
      ] as unknown as maplibregl.ExpressionSpecification,
      "fill-opacity": 0.96,
    },
  })
  map.addLayer({
    id: "backdrop-border",
    type: "line",
    source: "backdrop",
    paint: { "line-color": "#6a7278", "line-width": 0.55, "line-opacity": 0.9 },
  })
  map.addLayer({
    id: "backdrop-labels",
    type: "symbol",
    source: "backdrop-label-points",
    layout: {
      "text-field": ["get", "name"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 5, 10, 7.5, 13],
      "text-font": BACKDROP_LABEL_FONT,
      "text-letter-spacing": 0.06,
      "text-allow-overlap": false,
      "text-optional": true,
    },
    paint: {
      "text-color": "#3f464b",
      "text-halo-color": "#e2e6e8",
      "text-halo-width": 1.4,
      "text-opacity": 0.72,
    },
  })
  map.addLayer({
    id: "state-labels",
    type: "symbol",
    source: "state-labels",
    minzoom: 7.5,
    layout: {
      "text-field": ["get", "name"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 7.5, 9, 10, 13],
      "text-font": BACKDROP_LABEL_FONT,
      "text-padding": 2,
      "text-allow-overlap": false,
      "text-optional": true,
    },
    paint: {
      "text-color": "#3a4146",
      "text-halo-color": "#e4e7e8",
      "text-halo-width": 1.1,
      "text-opacity": 0.88,
    },
  })
  map.addLayer({
    id: "rivers",
    type: "line",
    source: "rivers",
    paint: { "line-color": "#4a7a9a", "line-width": 1.6, "line-opacity": 0.75 },
  })
  map.addLayer({
    id: "provinces",
    type: "fill",
    source: "provinces",
    paint: {
      "fill-color": provinceFillColor(),
      "fill-opacity": provinceFillOpacity(),
    },
  })
  map.addLayer({
    id: TARGET_HIGHLIGHT_LAYER,
    type: "fill",
    source: "provinces",
    paint: {
      "fill-color": targetFillColor(),
      "fill-opacity": 0,
      "fill-opacity-transition": { duration: TARGET_HIGHLIGHT_FADE_MS, delay: 0 },
    },
  })
  map.addLayer({
    id: "flash",
    type: "fill",
    source: "provinces",
    filter: ["==", ["get", "id"], ""],
    paint: { "fill-color": "#f3e2a8", "fill-opacity": 0 },
  })
  map.addLayer({
    id: "coach-highlight",
    type: "fill",
    source: "provinces",
    filter: ["==", ["get", "id"], ""],
    paint: { "fill-color": "#c6a15a", "fill-opacity": 0.32 },
  })
  // Source wash under borders (stronger than the target wash) so dashed outlines read on blue fills.
  map.addLayer({
    id: LESSON_FOCUS_FILL_LAYER,
    type: "fill",
    source: "provinces",
    filter: ["==", ["get", "id"], ""],
    paint: {
      "fill-color": LESSON_HIGHLIGHT_BRASS,
      "fill-opacity": LESSON_SOURCE_FILL_OPACITY,
    },
  })
  map.addLayer({
    id: "country-borders",
    type: "line",
    source: "country-borders",
    paint: { "line-color": "#2a3034", "line-width": 1.35, "line-opacity": 0.92 },
  })
  map.addLayer({
    id: "borders",
    type: "line",
    source: "provinces",
    paint: {
      "line-color": [
        "match",
        ["get", "controller"],
        "central",
        "#1c3348",
        "russia",
        "#5c261c",
        "#2a2118",
      ],
      "line-width": 1.3,
    },
  })
  map.addLayer({
    id: "target-outline",
    type: "line",
    source: "provinces",
    paint: {
      "line-color": [
        "match",
        ["feature-state", "role"],
        "attack",
        TARGET_OUTLINE.attack.color,
        "move",
        TARGET_OUTLINE.move.color,
        "reach",
        TARGET_OUTLINE.reach.color,
        "#000000",
      ],
      "line-width": [
        "match",
        ["feature-state", "role"],
        "attack",
        TARGET_OUTLINE.attack.width,
        "move",
        TARGET_OUTLINE.move.width,
        "reach",
        TARGET_OUTLINE.reach.width,
        0,
      ],
      "line-opacity": [
        "match",
        ["feature-state", "role"],
        "attack",
        TARGET_OUTLINE.attack.opacity,
        "move",
        TARGET_OUTLINE.move.opacity,
        "reach",
        TARGET_OUTLINE.reach.opacity,
        0,
      ],
    },
  })
  map.addLayer({
    id: "selected",
    type: "line",
    source: "provinces",
    filter: ["==", ["get", "id"], ""],
    paint: { "line-color": "#f3e2a8", "line-width": 3.4 },
  })
  // Rails above fills+borders (gate sits on the shared border), under labels/counters.
  // Mid weight ~2.0–3.0px track + casing; ~0.85 opacity; modest zoom growth; no sleeper ticks.
  map.addLayer({
    id: "rail-casing",
    type: "line",
    source: "rails",
    filter: ["!=", ["get", "side"], "cut"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": RAIL_STYLE.casing,
      "line-width": railWidthHot(3.1, 4.1),
      "line-opacity": railFade(0.85),
    },
  })
  map.addLayer({
    id: "rail-track",
    type: "line",
    source: "rails",
    filter: ["!=", ["get", "side"], "cut"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": RAIL_STYLE.track,
      "line-width": railWidthHot(2.0, 3.0),
      "line-opacity": railFade(0.85),
    },
  })
  // Cut edges: same weight as held track, dashed (casing would fill the gaps).
  map.addLayer({
    id: "rail-cut",
    type: "line",
    source: "rails",
    filter: ["==", ["get", "side"], "cut"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": RAIL_STYLE.cut,
      "line-width": railWidth(2.0, 3.0),
      "line-dasharray": [1.4, 1.6],
      "line-opacity": railFade(0.85),
    },
  })
  // Lesson focus outlines sit above rails so dashed sources stay readable on the map.
  map.addLayer({
    id: LESSON_SOURCE_OUTLINE_LAYER,
    type: "line",
    source: "provinces",
    filter: ["==", ["get", "id"], ""],
    paint: {
      "line-color": LESSON_HIGHLIGHT_BRASS_DEEP,
      "line-width": LESSON_SOURCE_LINE_WIDTH,
      "line-opacity": 1,
      "line-dasharray": LESSON_SOURCE_DASH,
    },
  })
  map.addLayer({
    id: LESSON_TARGET_OUTLINE_LAYER,
    type: "line",
    source: "provinces",
    filter: ["==", ["get", "id"], ""],
    paint: {
      "line-color": LESSON_HIGHLIGHT_BRASS,
      "line-width": LESSON_TARGET_LINE_WIDTH,
      "line-opacity": 0.95,
    },
  })
  map.addLayer({
    id: "province-labels",
    type: "symbol",
    source: "province-label-points",
    layout: {
      "text-field": ["get", "name"],
      "text-font": PROVINCE_LABEL_FONT,
      "text-size": ["interpolate", ["linear"], ["zoom"], 5.8, 9, 8.5, 12],
      "text-anchor": "center",
      "text-offset": [0, -0.35],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": [
        "case",
        ["boolean", ["get", "selected"], false],
        "#f6f1e4",
        "#241c14",
      ],
      "text-halo-color": [
        "case",
        ["boolean", ["get", "selected"], false],
        "#241c14",
        "#fff8e6",
      ],
      "text-halo-width": ["case", ["boolean", ["get", "selected"], false], 1.8, 1.1],
      "text-opacity": provinceLabelOpacityExpression(),
    },
  })
  map.addLayer({
    id: "province-counters",
    type: "symbol",
    source: "province-counters",
    layout: {
      "text-field": ["get", "strength"],
      "text-font": PROVINCE_LABEL_FONT,
      "text-size": 10,
      "icon-image": "counter-pill",
      "icon-text-fit": "both",
      "icon-text-fit-padding": [3, 6, 3, 6],
      "text-anchor": "center",
      "text-offset": [0, 1.05],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": [
        "match",
        ["get", "controller"],
        "central",
        "#1c3348",
        "#6a2a22",
      ],
      "text-opacity": provinceLabelOpacityExpression(),
      "icon-opacity": provinceLabelOpacityExpression(),
    },
  })
  map.addLayer({
    id: "orders",
    type: "line",
    source: "orders",
    paint: {
      "line-color": ["match", ["get", "kind"], "attack", "#8e2a22", "#1d4e79"],
      "line-width": 3,
    },
  })
  map.addLayer({
    id: "order-ends",
    type: "circle",
    source: "order-ends",
    paint: {
      "circle-radius": 5,
      "circle-color": ["match", ["get", "kind"], "attack", "#8e2a22", "#1d4e79"],
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#f6f1e4",
    },
  })
  map.addLayer({
    id: "preview",
    type: "line",
    source: "preview",
    paint: {
      "line-color": "#6a4b16",
      "line-width": 2.4,
      "line-dasharray": [1.2, 0.8],
    },
  })

  if (!map.hasImage("counter-pill")) {
    map.addImage("counter-pill", createCounterPillImage(), { pixelRatio: 1 })
  }
}
