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
import {
  MAP_GLYPHS_URL,
  provinceCounterCollection,
  provinceLabelCollection,
} from "@/lib/map/province-label-layers"
import { provincePaintProperties } from "@/lib/map/province-paint"
import {
  applyProvinceRoleStates,
  pulseTargetHighlight,
  targetsActive,
} from "@/lib/map/target-highlight"
import { installWarMapLayers } from "@/lib/map/war-map-layers"
import { railFeatureCollection, type RailEnd } from "@/lib/map/rail-lines"
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
  /** Coach / teaching highlights anchored to province ids (not screen pixels). */
  coachHighlightIds?: string[]
  targetIds?: { move: string[]; attack: string[]; canOrder: boolean }
  targetHoverNote?: (provinceId: string, base: string) => string
  onOverlay: (overlay: Overlay) => void
}

type Snapshot = MapInput & {
  showRails: boolean
  targetHoverNote?: (provinceId: string, base: string) => string
}

export function WarMap({
  provinces,
  selectedId,
  overlay,
  orders,
  flashIds,
  coachHighlightIds = [],
  targetIds,
  targetHoverNote,
  orderMode,
  onSelect,
  onDraw,
  onOverlay,
}: WarMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [hoverTip, setHoverTip] = useState<string | null>(null)
  const [showRails, setShowRails] = useState(true)
  const loadedRef = useRef(false)
  const fittedRef = useRef(false)
  const targetIdsRef = useRef(targetIds)
  const provinceDataKeyRef = useRef<string>("")
  const highlightKeyRef = useRef<string>("")
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
          failIfMajorPerformanceCaveat: false,
        },
        style: {
          version: 8,
          glyphs: MAP_GLYPHS_URL,
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
      map.addSource("provinces", { type: "geojson", data: emptyCollection(), promoteId: "id" })
      map.addSource("orders", { type: "geojson", data: emptyCollection() })
      map.addSource("order-ends", { type: "geojson", data: emptyCollection() })
      map.addSource("preview", { type: "geojson", data: emptyCollection() })
      map.addSource("rails", { type: "geojson", data: emptyCollection() })
      map.addSource("province-label-points", { type: "geojson", data: emptyCollection() })
      map.addSource("province-counters", { type: "geojson", data: emptyCollection() })
      installWarMapLayers(map, BACKDROP_OWNER_COLOR)
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
          const idStr = String(feature.properties?.id ?? "")
          const base = lines.join("\n")
          const note = propsRef.current.targetHoverNote?.(idStr, base) ?? base
          setHoverTip(note)
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
      syncMap(map, propsRef.current, fittedRef, targetIdsRef.current, provinceDataKeyRef, highlightKeyRef)
    })

    const observer = new ResizeObserver(() => {
      map.resize()
      if (loadedRef.current) {
        syncMap(
          map,
          propsRef.current,
          fittedRef,
          targetIdsRef.current,
          provinceDataKeyRef,
          highlightKeyRef,
        )
      }
    })
    observer.observe(container.parentElement ?? container)

    return () => {
      observer.disconnect()
      loadedRef.current = false
      fittedRef.current = false
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
    targetIdsRef.current = targetIds
  }, [targetIds])

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
      targetHoverNote,
    }
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    syncMap(map, propsRef.current, fittedRef, targetIds, provinceDataKeyRef, highlightKeyRef)
    if (orderMode) map.dragPan.disable()
    else map.dragPan.enable()
  }, [provinces, orders, selectedId, overlay, orderMode, showRails, onSelect, onDraw, targetHoverNote, targetIds])

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

  useEffect(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current || !map.getLayer("coach-highlight")) return
    map.setFilter("coach-highlight", [
      "in",
      ["get", "id"],
      ["literal", coachHighlightIds.length ? coachHighlightIds : ["__none__"]],
    ])
    map.setPaintProperty(
      "coach-highlight",
      "fill-opacity",
      coachHighlightIds.length ? 0.32 : 0,
    )
  }, [coachHighlightIds])

  return (
    <div
      className="relative h-full min-h-[280px] w-full overflow-hidden bg-[#6e8ea3]"
      data-testid="war-map"
      data-coach-highlights={coachHighlightIds.join(",") || undefined}
      data-map-targets={
        targetIds
          ? `move:${targetIds.move.join(",")};attack:${targetIds.attack.join(",")};order:${targetIds.canOrder}`
          : undefined
      }
    >
      {failed ? (
        <SvgMap
          provinces={provinces}
          selectedId={selectedId}
          overlay={overlay}
          orders={orders}
          flashIds={flashIds}
          orderMode={orderMode}
          showRails={showRails}
          targetIds={targetIds}
          targetHoverNote={targetHoverNote}
          onSelect={onSelect}
          onDraw={onDraw}
        />
      ) : (
        <div className="map-stage absolute inset-0">
          <div ref={containerRef} className="h-full w-full" />
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
  fitted: { current: boolean },
  targetIds: WarMapProps["targetIds"],
  provinceDataKey: { current: string },
  highlightKey: { current: string },
) {
  const rivers = map.getSource("rivers") as maplibregl.GeoJSONSource | undefined
  const provinces = map.getSource("provinces") as maplibregl.GeoJSONSource | undefined
  const orders = map.getSource("orders") as maplibregl.GeoJSONSource | undefined
  const ends = map.getSource("order-ends") as maplibregl.GeoJSONSource | undefined
  const rails = map.getSource("rails") as maplibregl.GeoJSONSource | undefined
  const labelPoints = map.getSource("province-label-points") as maplibregl.GeoJSONSource | undefined
  const counters = map.getSource("province-counters") as maplibregl.GeoJSONSource | undefined
  if (!rivers || !provinces || !orders || !ends || !rails || !labelPoints || !counters) return

  rivers.setData({
    type: "FeatureCollection",
    features: RIVER_LINES.map((river) => ({
      type: "Feature",
      properties: { id: river.id, name: river.name },
      geometry: { type: "LineString", coordinates: river.coordinates },
    })),
  })

  const paintInput = targetIds
    ? { move: targetIds.move, attack: targetIds.attack, canOrder: targetIds.canOrder }
    : undefined
  const nextDataKey = `${snapshot.overlay}:${snapshot.provinces.map((p) => `${p.id}:${p.controller}:${p.supply}:${p.unrest}:${listedStrength(p.units)}`).join("|")}`
  const dataChanged = nextDataKey !== provinceDataKey.current
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
    // Base fills/lifts only — highlight role is feature-state (fade without setData).
    const paint = provincePaintProperties(province, snapshot.overlay, "none")
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
        ...paint,
      },
      geometry: province.polygon,
    })
  }
  if (dataChanged) {
    provinces.setData({ type: "FeatureCollection", features })
    provinceDataKey.current = nextDataKey
  }

  labelPoints.setData(provinceLabelCollection(snapshot.provinces, snapshot.selectedId))
  counters.setData(provinceCounterCollection(snapshot.provinces))

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
  for (const id of ["rail-casing", "rail-track", "rail-cut"]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", railVisibility)
  }

  if (map.getLayer("selected")) {
    map.setFilter("selected", ["==", ["get", "id"], snapshot.selectedId ?? "__none__"])
  }

  // Re-apply after any setData (clears feature-state); pulse opacity when selection changes.
  applyProvinceRoleStates(map, snapshot.provinces, paintInput, snapshot.selectedId)
  const nextHighlightKey = `${snapshot.selectedId ?? ""}:${targetIds?.move.join(",") ?? ""}:${targetIds?.attack.join(",") ?? ""}:${targetIds?.canOrder ? 1 : 0}`
  if (nextHighlightKey !== highlightKey.current) {
    highlightKey.current = nextHighlightKey
    pulseTargetHighlight(map, targetsActive(targetIds))
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

function webglPaints(): boolean {
  try {
    const canvas = document.createElement("canvas")
    canvas.width = 16
    canvas.height = 16
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl")
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
