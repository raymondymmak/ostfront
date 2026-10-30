"use client"

import { useEffect, useRef, useState } from "react"
import * as maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { SvgMap } from "@/components/svg-map"
import { MapLegend } from "@/components/map-legend"
import { MapMode } from "@/components/map-mode"
import {
  BACKDROP_OWNER_COLOR,
  BACKDROP_REGIONS,
  COUNTRY_BORDERS,
  COUNTRY_LABELS,
  RIVER_LINES,
  SEA_GEOMETRY,
  THEATER_BBOX,
  VIEW_BBOX,
  WORLD_BBOX,
  eachCoord,
  geometryValid,
  type ProvinceGeometry,
} from "@/lib/data/geometry"
import { listedStrength } from "@/lib/engine/echelon"
import { shortProvinceName } from "@/lib/map/labels"
import { applyMarkerFace, type MarkerFace } from "@/lib/map/marker-face"
import { applyProvinceLabelOpacity } from "@/lib/map/province-label-zoom"
import {
  RAIL_FULL_ZOOM,
  RAIL_HIDDEN_ZOOM,
  RAIL_STYLE,
  railFeatureCollection,
  type RailEnd,
} from "@/lib/map/rail-lines"
import type { QueuedOrder } from "@/lib/orders"
import type { Province } from "@/lib/types"

export type MapProvince = Province & {
  polygon: ProvinceGeometry
  centroid: [number, number]
  /** Victory-point value for the active scenario. Absent when the province is not an objective. */
  vp?: number
}

type Overlay = "none" | "supply" | "unrest"

type MapInput = {
  provinces: MapProvince[]
  selectedId: string | null
  overlay: Overlay
  orders: QueuedOrder[]
  orderMode: boolean
  onSelect: (id: string) => void
  onDraw: (from: string, to: string, commitAll?: boolean) => void
}

/** Props the game screen passes. Map mode and the rail toggle live on the map. */
type WarMapProps = MapInput & {
  flashIds: string[]
  onOverlay: (overlay: Overlay) => void
}

type Snapshot = MapInput & {
  showRails: boolean
}

export function WarMap({
  provinces,
  selectedId,
  overlay,
  orders,
  flashIds,
  orderMode,
  onSelect,
  onDraw,
  onOverlay,
}: WarMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const blitRef = useRef<HTMLCanvasElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const blitFrameRef = useRef<number | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [hoverTip, setHoverTip] = useState<string | null>(null)
  const [showRails, setShowRails] = useState(true)
  const loadedRef = useRef(false)
  const fittedRef = useRef(false)
  const propsRef = useRef<Snapshot>({
    provinces,
    selectedId,
    overlay,
    orders,
    orderMode,
    showRails: true,
    onSelect,
    onDraw,
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container || mapRef.current) return

    if (!webglPaints()) {
      queueMicrotask(() => setFailed("WebGL did not paint a frame."))
      return
    }

    maplibregl.setWorkerUrl(`${window.location.origin}/maplibre-gl-worker.mjs`)

    let map: maplibregl.Map
    try {
      map = new maplibregl.Map({
        container,
        attributionControl: false,
        fadeDuration: 0,
        dragRotate: false,
        pitchWithRotate: false,
        maxBounds: [
          [WORLD_BBOX[0], WORLD_BBOX[1]],
          [WORLD_BBOX[2], WORLD_BBOX[3]],
        ],
        canvasContextAttributes: {
          preserveDrawingBuffer: true,
          failIfMajorPerformanceCaveat: false,
        },
        style: {
          version: 8,
          sources: {},
          layers: [
            {
              id: "background",
              type: "background",
              paint: { "background-color": "#4f7f9d" },
            },
          ],
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "The map could not start."
      queueMicrotask(() => setFailed(message))
      return
    }

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right")
    mapRef.current = map

    map.on("error", (event) => {
      const message = event.error?.message ?? ""
      if (/webgl|failed to initialize|context|worker failed/i.test(message)) {
        setFailed(message || "The map context failed.")
      }
    })

    map.on("load", () => {
      map.addSource("land", { type: "geojson", data: emptyCollection() })
      map.addSource("sea", { type: "geojson", data: seaCollection() })
      map.addSource("backdrop", { type: "geojson", data: backdropCollection() })
      map.addSource("country-borders", { type: "geojson", data: countryBorderCollection() })
      map.addSource("backdrop-label-points", { type: "geojson", data: countryLabelCollection() })
      map.addSource("state-labels", { type: "geojson", data: stateLabelCollection() })
      map.addSource("rivers", { type: "geojson", data: emptyCollection() })
      map.addSource("provinces", { type: "geojson", data: emptyCollection() })
      map.addSource("orders", { type: "geojson", data: emptyCollection() })
      map.addSource("order-ends", { type: "geojson", data: emptyCollection() })
      map.addSource("preview", { type: "geojson", data: emptyCollection() })
      map.addSource("rails", { type: "geojson", data: emptyCollection() })
      map.addLayer({
        id: "sea",
        type: "fill",
        source: "sea",
        paint: {
          "fill-color": "#4f7f9d",
          "fill-opacity": 1,
        },
      })
      map.addLayer({
        id: "land",
        type: "fill",
        source: "land",
        paint: {
          "fill-color": "#8f9699",
          "fill-opacity": 0.98,
        },
      })
      map.addLayer({
        id: "backdrop",
        type: "fill",
        source: "backdrop",
        paint: {
          "fill-color": [
            "match",
            ["get", "owner"],
            ...Object.entries(BACKDROP_OWNER_COLOR).flat(),
            "#b4b2ae",
          ] as unknown as maplibregl.ExpressionSpecification,
          "fill-opacity": 0.96,
        },
      })
      map.addLayer({
        id: "backdrop-border",
        type: "line",
        source: "backdrop",
        paint: {
          "line-color": "#6a7278",
          "line-width": 0.55,
          "line-opacity": 0.9,
        },
      })
      map.addLayer({
        id: "country-borders",
        type: "line",
        source: "country-borders",
        paint: {
          "line-color": "#2a3034",
          "line-width": 1.35,
          "line-opacity": 0.92,
        },
      })
      map.addLayer({
        id: "backdrop-labels",
        type: "symbol",
        source: "backdrop-label-points",
        layout: {
          "text-field": ["get", "name"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 5, 10, 7.5, 13],
          "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
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
          "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
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
        paint: {
          "line-color": "#4a7a9a",
          "line-width": 1.6,
          "line-opacity": 0.75,
        },
      })
      map.addLayer({
        id: "provinces",
        type: "fill",
        source: "provinces",
        paint: {
          "fill-color": controllerColor(),
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            0.96,
            0.9,
          ],
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
        id: "rail-hot",
        type: "line",
        source: "rails",
        filter: ["==", ["get", "hot"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": RAIL_STYLE.hot,
          "line-width": railWidth(7.2, 11),
          "line-opacity": railFade(),
        },
      })
      map.addLayer({
        id: "rail-ties",
        type: "line",
        source: "rails",
        filter: ["!=", ["get", "side"], "cut"],
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          "line-color": RAIL_STYLE.tie,
          "line-width": railWidth(5.2, 8),
          "line-dasharray": [0.18, 0.85],
          "line-opacity": railFade(),
        },
      })
      map.addLayer({
        id: "rail-track",
        type: "line",
        source: "rails",
        filter: ["!=", ["get", "side"], "cut"],
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          "line-color": [
            "match",
            ["get", "side"],
            "central",
            RAIL_STYLE.central,
            "russia",
            RAIL_STYLE.russia,
            RAIL_STYLE.cut,
          ],
          "line-width": railWidth(1.05, 1.7),
          "line-gap-width": railWidth(2.1, 3.4),
          "line-opacity": railFade(),
        },
      })
      map.addLayer({
        id: "rail-cut",
        type: "line",
        source: "rails",
        filter: ["==", ["get", "side"], "cut"],
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          "line-color": RAIL_STYLE.cut,
          "line-width": railWidth(1.7, 2.6),
          "line-dasharray": [1.1, 0.85],
          "line-opacity": railFade(0.45),
        },
      })
      map.addLayer({
        id: "selected",
        type: "line",
        source: "provinces",
        filter: ["==", ["get", "id"], ""],
        paint: { "line-color": "#f3e2a8", "line-width": 3.4 },
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
      let hovered: string | number | null = null
      map.on("mousemove", "provinces", (event: maplibregl.MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = propsRef.current.orderMode ? "crosshair" : "pointer"
        const feature = event.features?.[0]
        const id = feature?.id
        if (feature?.properties) {
          const strength = Number(feature.properties.strength ?? 0)
          const controller =
            feature.properties.controller === "central" ? "Central Powers" : "Russia"
          const lines = [
            String(feature.properties.name ?? ""),
            strength > 0
              ? `Total unit strength: ${strength} (${controller})`
              : "No formations present",
          ]
          setHoverTip(lines.join("\n"))
        }
        if (hovered !== null && hovered !== id) {
          map.setFeatureState({ source: "provinces", id: hovered }, { hover: false })
        }
        if (id !== undefined) {
          hovered = id
          map.setFeatureState({ source: "provinces", id }, { hover: true })
        }
      })
      map.on("mouseleave", "provinces", () => {
        map.getCanvas().style.cursor = ""
        setHoverTip(null)
        if (hovered !== null) {
          map.setFeatureState({ source: "provinces", id: hovered }, { hover: false })
          hovered = null
        }
      })

      const scheduleBlit = () => {
        if (blitFrameRef.current !== null) return
        blitFrameRef.current = requestAnimationFrame(() => {
          blitFrameRef.current = null
          blitMap(map, blitRef.current)
        })
      }
      map.on("render", scheduleBlit)

      let startId: string | null = null
      const preview = () => map.getSource("preview") as maplibregl.GeoJSONSource
      const clearPreview = () => preview()?.setData(emptyCollection())
      const idAt = (point: maplibregl.PointLike) => {
        const feature = map.queryRenderedFeatures(point, { layers: ["provinces"] })[0]
        const id = feature?.properties?.id
        return typeof id === "string" ? id : null
      }

      map.on("mousedown", "provinces", (event: maplibregl.MapLayerMouseEvent) => {
        if (!propsRef.current.orderMode) return
        const id = idAt(event.point)
        if (!id) return
        event.preventDefault()
        startId = id
      })
      map.on("mousemove", (event: maplibregl.MapMouseEvent) => {
        if (!startId) return
        const from = propsRef.current.provinces.find((province) => province.id === startId)
        if (!from) return
        preview()?.setData({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: [from.centroid, [event.lngLat.lng, event.lngLat.lat]],
              },
            },
          ],
        })
      })
      const finish = (point?: maplibregl.PointLike, commitAll = false) => {
        if (!startId) return
        const origin = startId
        startId = null
        clearPreview()
        if (!point) return
        const target = idAt(point)
        if (target && target !== origin) propsRef.current.onDraw(origin, target, commitAll)
        else if (target) propsRef.current.onSelect(target)
      }
      map.on("mouseup", (event: maplibregl.MapMouseEvent) =>
        finish(event.point, event.originalEvent.shiftKey),
      )
      const onWindowUp = (event: MouseEvent) => {
        if (!startId) return
        const canvas = map.getCanvas()
        if (event.target === canvas) return
        startId = null
        clearPreview()
      }
      window.addEventListener("mouseup", onWindowUp)
      map.once("remove", () => window.removeEventListener("mouseup", onWindowUp))

      map.on("click", "provinces", (event: maplibregl.MapLayerMouseEvent) => {
        if (propsRef.current.orderMode) return
        const id = event.features?.[0]?.properties?.id
        if (typeof id === "string") propsRef.current.onSelect(id)
      })

      if (typeof window !== "undefined") {
        ;(window as Window & { __ostfrontMap?: maplibregl.Map }).__ostfrontMap = map
      }

      loadedRef.current = true
      map.on("zoom", () => paintProvinceLabels(map, markersRef.current))
      syncMap(map, propsRef.current, markersRef.current, fittedRef)
      map.once("idle", () => blitMap(map, blitRef.current))
    })

    const observer = new ResizeObserver(() => {
      map.resize()
      if (loadedRef.current) {
        syncMap(map, propsRef.current, markersRef.current, fittedRef)
      }
    })
    observer.observe(container.parentElement ?? container)

    const markers = markersRef.current
    return () => {
      observer.disconnect()
      if (blitFrameRef.current !== null) cancelAnimationFrame(blitFrameRef.current)
      loadedRef.current = false
      fittedRef.current = false
      markers.forEach((marker) => marker.remove())
      markers.clear()
      if (typeof window !== "undefined") {
        delete (window as Window & { __ostfrontMap?: maplibregl.Map }).__ostfrontMap
      }
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!failed || !mapRef.current) return
    mapRef.current.remove()
    mapRef.current = null
    loadedRef.current = false
  }, [failed])

  useEffect(() => {
    propsRef.current = {
      provinces,
      selectedId,
      overlay,
      orders,
      orderMode,
      showRails,
      onSelect,
      onDraw,
    }
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    syncMap(map, propsRef.current, markersRef.current, fittedRef)
    map.once("idle", () => blitMap(map, blitRef.current))
    if (orderMode) map.dragPan.disable()
    else map.dragPan.enable()
  }, [provinces, orders, selectedId, overlay, orderMode, showRails, onSelect, onDraw])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current || !map.getLayer("flash")) return
    map.setFilter("flash", [
      "in",
      ["get", "id"],
      ["literal", flashIds.length ? flashIds : ["__none__"]],
    ])
    if (!flashIds.length) {
      map.setPaintProperty("flash", "fill-opacity", 0)
      return
    }
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = (now - start) / 1300
      if (t >= 1) {
        map.setPaintProperty("flash", "fill-opacity", 0)
        return
      }
      map.setPaintProperty("flash", "fill-opacity", Math.sin(t * Math.PI) * 0.62)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [flashIds])

  return (
    <div className="relative h-full min-h-[280px] w-full overflow-hidden bg-[#6e8ea3]" data-testid="war-map">
      {failed ? (
        <SvgMap
          provinces={provinces}
          selectedId={selectedId}
          overlay={overlay}
          orders={orders}
          flashIds={flashIds}
          orderMode={orderMode}
          showRails={showRails}
          onSelect={onSelect}
          onDraw={onDraw}
        />
      ) : (
        <div className="map-stage absolute inset-0">
          <canvas ref={blitRef} className="pointer-events-none absolute inset-0 z-0 h-full w-full" />
          <div className="absolute inset-0 z-10 h-full w-full overflow-hidden">
            <div ref={containerRef} className="h-full w-full" />
          </div>
        </div>
      )}
      {hoverTip && !failed && (
        <div
          className={`pointer-events-none absolute left-2 z-20 max-w-[min(14rem,calc(100%-8.5rem))] rounded-md bg-[#241c14]/92 px-2.5 py-2 text-xs whitespace-pre-line text-[#f3e2a8] shadow-sm ${orderMode ? "top-12" : "top-2"}`}
          role="tooltip"
        >
          {hoverTip}
        </div>
      )}
      <MapMode overlay={overlay} onOverlay={onOverlay} className={failed ? "right-2.5" : "right-12"} />
      <MapLegend
        showRails={showRails}
        onToggleRails={() => setShowRails((value) => !value)}
        overlay={overlay}
      />

      {orderMode && (
        <div className="pointer-events-none absolute top-2 left-2 z-20 max-w-[calc(100%-8.5rem)] rounded-md bg-[#241c14]/90 px-2.5 py-1.5 text-xs text-[#f3e2a8]">
          Drag from a province to a neighbor to order a move or an attack.
        </div>
      )}
    </div>
  )
}

function syncMap(
  map: maplibregl.Map,
  snapshot: Snapshot,
  markers: Map<string, maplibregl.Marker>,
  fitted: { current: boolean },
) {
  const rivers = map.getSource("rivers") as maplibregl.GeoJSONSource | undefined
  const provinces = map.getSource("provinces") as maplibregl.GeoJSONSource | undefined
  const orders = map.getSource("orders") as maplibregl.GeoJSONSource | undefined
  const ends = map.getSource("order-ends") as maplibregl.GeoJSONSource | undefined
  const rails = map.getSource("rails") as maplibregl.GeoJSONSource | undefined
  if (!rivers || !provinces || !orders || !ends || !rails) return

  rivers.setData({
    type: "FeatureCollection",
    features: RIVER_LINES.map((river) => ({
      type: "Feature",
      properties: { id: river.id, name: river.name },
      geometry: { type: "LineString", coordinates: river.coordinates },
    })),
  })

  const features: GeoJSON.Feature[] = []
  const bounds = new maplibregl.LngLatBounds()
  bounds.extend([THEATER_BBOX[0], THEATER_BBOX[1]])
  bounds.extend([THEATER_BBOX[2], THEATER_BBOX[3]])
  let hasGeometry = false
  for (const province of snapshot.provinces) {
    if (!geometryValid(province.polygon)) continue
    hasGeometry = true
    const strength = listedStrength(province.units)
    eachCoord(province.polygon, (coord) => bounds.extend(coord))
    features.push({
      type: "Feature",
      id: province.id,
      properties: {
        id: province.id,
        name: province.name,
        controller: province.controller,
        supply: province.supply,
        unrest: province.unrest,
        strength,
      },
      geometry: province.polygon,
    })
  }
  provinces.setData({ type: "FeatureCollection", features })

  const seen = new Set<string>()
  for (const province of snapshot.provinces) {
    if (!geometryValid(province.polygon)) continue
    seen.add(province.id)
    const face = markerFace(province, snapshot.selectedId)
    const existing = markers.get(province.id)
    if (existing) {
      applyMarkerFace(existing.getElement(), face)
      existing.setLngLat(province.centroid)
    } else {
      const element = document.createElement("div")
      applyMarkerFace(element, face)
      markers.set(
        province.id,
        new maplibregl.Marker({ element, anchor: "center" }).setLngLat(province.centroid).addTo(map),
      )
    }
  }
  for (const [id, marker] of markers) {
    if (seen.has(id)) continue
    marker.remove()
    markers.delete(id)
  }

  const byId = new Map(snapshot.provinces.map((province) => [province.id, province]))
  const lines: GeoJSON.Feature[] = []
  const tips: GeoJSON.Feature[] = []
  for (const order of snapshot.orders) {
    if (!order.to) continue
    const from = byId.get(order.from)
    const to = byId.get(order.to)
    if (!from || !to) continue
    lines.push({
      type: "Feature",
      properties: { kind: order.kind },
      geometry: { type: "LineString", coordinates: [from.centroid, to.centroid] },
    })
    tips.push({
      type: "Feature",
      properties: { kind: order.kind },
      geometry: { type: "Point", coordinates: to.centroid },
    })
  }
  orders.setData({ type: "FeatureCollection", features: lines })
  ends.setData({ type: "FeatureCollection", features: tips })

  const railEnds: RailEnd[] = snapshot.provinces.map((province) => ({
    id: province.id,
    neighbors: province.neighbors,
    rail: province.rail,
    controller: province.controller,
    anchor: province.centroid,
    polygon: province.polygon,
  }))
  rails.setData(railFeatureCollection(railEnds, snapshot.selectedId))
  const railVisibility = snapshot.showRails ? "visible" : "none"
  for (const id of ["rail-hot", "rail-ties", "rail-track", "rail-cut"]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", railVisibility)
  }

  if (map.getLayer("provinces")) {
    map.setPaintProperty(
      "provinces",
      "fill-color",
      snapshot.overlay === "none" ? controllerColor() : heatColor(snapshot.overlay),
    )
  }
  if (map.getLayer("selected")) {
    map.setFilter("selected", ["==", ["get", "id"], snapshot.selectedId ?? ""])
  }

  if (hasGeometry && !fitted.current) {
    map.resize()
    const urlView = readMapViewFromUrl()
    if (urlView.bounds) {
      map.fitBounds(urlView.bounds, { padding: urlView.padding ?? 24, animate: false, maxZoom: 8.5 })
    } else if (urlView.center) {
      map.jumpTo({
        center: urlView.center,
        zoom: urlView.zoom ?? 6.5,
      })
    } else {
      // Fit the playable frame, then apply the same maxBounds clamp main uses
      // so the opening center and zoom match. World bounds go back afterwards
      // so the player can still pan out to the rest of the map.
      map.fitBounds(bounds, { padding: 28, animate: false, maxZoom: 8.2 })
      map.setMaxBounds([
        [VIEW_BBOX[0], VIEW_BBOX[1]],
        [VIEW_BBOX[2], VIEW_BBOX[3]],
      ])
      const center = map.getCenter()
      const zoom = map.getZoom()
      map.setMaxBounds([
        [WORLD_BBOX[0], WORLD_BBOX[1]],
        [WORLD_BBOX[2], WORLD_BBOX[3]],
      ])
      map.jumpTo({ center, zoom })
    }
    fitted.current = true
    map.resize()
  }
  paintProvinceLabels(map, markers)
}

function readMapViewFromUrl(): {
  center?: [number, number]
  zoom?: number
  bounds?: [[number, number], [number, number]]
  padding?: number
} {
  if (typeof window === "undefined") return {}
  const q = new URLSearchParams(window.location.search)
  const boundsRaw = q.get("mapBounds")
  if (boundsRaw) {
    const parts = boundsRaw.split(",").map((v) => Number(v.trim()))
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return {
        bounds: [[parts[0], parts[1]], [parts[2], parts[3]]],
        padding: q.has("mapPadding") ? Number(q.get("mapPadding")) : undefined,
      }
    }
  }
  const lon = q.get("mapLon")
  const lat = q.get("mapLat")
  if (lon && lat) {
    const zoom = q.get("mapZoom")
    return {
      center: [Number(lon), Number(lat)],
      zoom: zoom ? Number(zoom) : undefined,
    }
  }
  return {}
}

function paintProvinceLabels(map: maplibregl.Map, markers: Map<string, maplibregl.Marker>) {
  const zoom = map.getZoom()
  for (const marker of markers.values()) applyProvinceLabelOpacity(marker, zoom)
}

function markerFace(province: MapProvince, selectedId: string | null): MarkerFace {
  const strength = listedStrength(province.units)
  const faction = province.controller === "central" ? "Central Powers" : "Russia"
  const badge = strength
    ? `<div class="map-badge ${province.controller}" title="Total unit strength: ${strength} (${faction})">${strength}</div>`
    : ""
  return {
    className: ["map-tag", province.id === selectedId ? "is-selected" : "", province.depot ? "is-depot" : ""]
      .filter(Boolean)
      .join(" "),
    innerHTML: `<div class="map-tag-name">${province.vp ? "★ " : ""}${escapeHtml(shortProvinceName(province.name))}</div>${badge}`,
    provinceId: province.id,
    lng: province.centroid[0],
    lat: province.centroid[1],
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function blitMap(map: maplibregl.Map, target: HTMLCanvasElement | null) {
  if (!target) return
  const source = map.getCanvas()
  const gl = source.getContext("webgl2") || source.getContext("webgl")
  if (!gl || source.width < 2 || source.height < 2) return
  const width = source.width
  const height = source.height
  const pixels = new Uint8Array(width * height * 4)
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  const center = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4
  if (pixels[center + 3] < 16) return
  if (target.width !== width) target.width = width
  if (target.height !== height) target.height = height
  const context = target.getContext("2d")
  if (!context) return
  const image = context.createImageData(width, height)
  for (let y = 0; y < height; y++) {
    const row = (height - 1 - y) * width * 4
    image.data.set(pixels.subarray(row, row + width * 4), y * width * 4)
  }
  context.putImageData(image, 0, 0)
}

function webglPaints(): boolean {
  try {
    const canvas = document.createElement("canvas")
    canvas.width = 16
    canvas.height = 16
    const gl =
      canvas.getContext("webgl2", { preserveDrawingBuffer: true }) ||
      canvas.getContext("webgl", { preserveDrawingBuffer: true })
    if (!gl) return false
    gl.clearColor(0.43, 0.56, 0.64, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const pixel = new Uint8Array(4)
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    return pixel[2] > 40 && pixel[3] > 200
  } catch {
    return false
  }
}

function seaCollection(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: SEA_GEOMETRY
      ? [{ type: "Feature", id: "sea", properties: {}, geometry: SEA_GEOMETRY }]
      : [],
  }
}

function backdropCollection(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: BACKDROP_REGIONS.filter((region) => geometryValid(region.geometry)).map((region) => ({
      type: "Feature",
      id: region.id,
      properties: { id: region.id, name: region.name, owner: region.owner },
      geometry: region.geometry,
    })),
  }
}

function countryBorderCollection(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: COUNTRY_BORDERS,
      },
    ],
  }
}

function countryLabelCollection(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: COUNTRY_LABELS.flatMap((label) => {
      const spots = label.labels?.length ? label.labels : [label.label]
      return spots.map((coordinates) => ({
        type: "Feature" as const,
        properties: { name: label.name, owner: label.owner },
        geometry: { type: "Point" as const, coordinates },
      }))
    }),
  }
}

function stateLabelCollection(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: BACKDROP_REGIONS.filter((region) => geometryValid(region.geometry)).map((region) => ({
      type: "Feature" as const,
      properties: { name: region.name, id: region.id },
      geometry: { type: "Point" as const, coordinates: region.label },
    })),
  }
}

function emptyCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] }
}

function railFade(scale = 1): maplibregl.ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    RAIL_HIDDEN_ZOOM,
    0,
    RAIL_FULL_ZOOM,
    scale,
  ]
}

function railWidth(atOpening: number, atClose: number): maplibregl.ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    RAIL_HIDDEN_ZOOM,
    0,
    RAIL_FULL_ZOOM,
    atOpening,
    8.4,
    atClose,
  ]
}

function controllerColor(): maplibregl.ExpressionSpecification {
  return ["match", ["get", "controller"], "central", "#4a6d90", "russia", "#a85b49", "#888888"]
}

function heatColor(field: "supply" | "unrest"): maplibregl.ExpressionSpecification {
  if (field === "supply") {
    return [
      "interpolate",
      ["linear"],
      ["get", "supply"],
      0,
      "#7a2e2a",
      45,
      "#c6a15a",
      100,
      "#2d6a45",
    ]
  }
  return [
    "interpolate",
    ["linear"],
    ["get", "unrest"],
    0,
    "#3e5348",
    50,
    "#d4a24c",
    100,
    "#8e2430",
  ]
}

