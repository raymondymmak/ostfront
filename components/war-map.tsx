"use client"

import { useEffect, useRef, useState } from "react"
import * as maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { SvgMap } from "@/components/svg-map"
import type { QueuedOrder } from "@/lib/orders"
import type { Province } from "@/lib/types"

export type MapProvince = Province & {
  polygon: [number, number][]
  centroid: [number, number]
}

type Overlay = "none" | "supply" | "unrest"

type Snapshot = {
  provinces: MapProvince[]
  selectedId: string | null
  overlay: Overlay
  orders: QueuedOrder[]
  orderMode: boolean
  onSelect: (id: string) => void
  onDraw: (from: string, to: string) => void
}

type WarMapProps = Snapshot & {
  flashIds: string[]
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
}: WarMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const blitRef = useRef<HTMLCanvasElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const [failed, setFailed] = useState<string | null>(null)
  const loadedRef = useRef(false)
  const fittedRef = useRef(false)
  const propsRef = useRef<Snapshot>({
    provinces,
    selectedId,
    overlay,
    orders,
    orderMode,
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
              paint: { "background-color": "#6e8ea3" },
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
      map.addSource("provinces", { type: "geojson", data: emptyCollection() })
      map.addSource("orders", { type: "geojson", data: emptyCollection() })
      map.addSource("order-ends", { type: "geojson", data: emptyCollection() })
      map.addSource("preview", { type: "geojson", data: emptyCollection() })

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
        const id = event.features?.[0]?.id
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
      const finish = (point?: maplibregl.PointLike) => {
        if (!startId) return
        const origin = startId
        startId = null
        clearPreview()
        if (!point) return
        const target = idAt(point)
        if (target && target !== origin) propsRef.current.onDraw(origin, target)
        else if (target) propsRef.current.onSelect(target)
      }
      map.on("mouseup", (event: maplibregl.MapMouseEvent) => finish(event.point))
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

      loadedRef.current = true
      syncMap(map, propsRef.current, markersRef.current, fittedRef)
      map.once("idle", () => blitMap(map, blitRef.current))
    })

    const observer = new ResizeObserver(() => map.resize())
    observer.observe(container)

    const markers = markersRef.current
    return () => {
      observer.disconnect()
      loadedRef.current = false
      fittedRef.current = false
      markers.forEach((marker) => marker.remove())
      markers.clear()
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
      onSelect,
      onDraw,
    }
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    syncMap(map, propsRef.current, markersRef.current, fittedRef)
    map.once("idle", () => blitMap(map, blitRef.current))
    if (orderMode) map.dragPan.disable()
    else map.dragPan.enable()
  }, [provinces, orders, selectedId, overlay, orderMode, onSelect, onDraw])

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
    <div className="relative h-full min-h-[280px] w-full bg-[#6e8ea3]" data-testid="war-map">
      {failed ? (
        <SvgMap
          provinces={provinces}
          selectedId={selectedId}
          overlay={overlay}
          orders={orders}
          flashIds={flashIds}
          orderMode={orderMode}
          onSelect={onSelect}
          onDraw={onDraw}
        />
      ) : (
        <>
          <canvas ref={blitRef} className="pointer-events-none absolute inset-0 h-full w-full" />
          <div ref={containerRef} className="absolute inset-0" />
        </>
      )}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-[#f6f1e4]/92 px-2.5 py-2 text-[11px] text-[#241c14] shadow-sm">
        <div className="flex items-center gap-2">
          <span className="inline-block size-2.5 bg-[#4a6d90]" /> Central Powers
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="inline-block size-2.5 bg-[#a85b49]" /> Russia
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="inline-block size-2 rotate-45 bg-[#8a6a32]" /> Depot
        </div>
        <p className="mt-1 text-[#5c5144]">Numbers are strength. Baltic lies north.</p>
      </div>
      {orderMode && (
        <div className="pointer-events-none absolute top-3 left-3 rounded-md bg-[#241c14]/90 px-2.5 py-1.5 text-xs text-[#f3e2a8]">
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
  const provinces = map.getSource("provinces") as maplibregl.GeoJSONSource | undefined
  const orders = map.getSource("orders") as maplibregl.GeoJSONSource | undefined
  const ends = map.getSource("order-ends") as maplibregl.GeoJSONSource | undefined
  if (!provinces || !orders || !ends) return

  const features: GeoJSON.Feature[] = []
  const bounds = new maplibregl.LngLatBounds()
  let hasGeometry = false
  for (const province of snapshot.provinces) {
    if (province.polygon.length < 4) continue
    hasGeometry = true
    for (const coord of province.polygon) bounds.extend(coord)
    features.push({
      type: "Feature",
      id: province.id,
      properties: {
        id: province.id,
        controller: province.controller,
        supply: province.supply,
        unrest: province.unrest,
      },
      geometry: { type: "Polygon", coordinates: [province.polygon] },
    })
  }
  provinces.setData({ type: "FeatureCollection", features })

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

  const seen = new Set<string>()
  for (const province of snapshot.provinces) {
    if (province.polygon.length < 4) continue
    seen.add(province.id)
    const element = markerElement(province, snapshot.selectedId)
    const existing = markers.get(province.id)
    if (existing) {
      existing.getElement().className = element.className
      existing.getElement().innerHTML = element.innerHTML
      existing.setLngLat(province.centroid)
    } else {
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

  if (hasGeometry && !fitted.current) {
    map.fitBounds(bounds, { padding: 32, animate: false, maxZoom: 7.2 })
    fitted.current = true
  }
}

function markerElement(province: MapProvince, selectedId: string | null): HTMLDivElement {
  const element = document.createElement("div")
  element.className = [
    "map-tag",
    province.id === selectedId ? "is-selected" : "",
    province.depot ? "is-depot" : "",
  ]
    .filter(Boolean)
    .join(" ")
  element.style.pointerEvents = "none"
  const strength = province.units.reduce((sum, unit) => sum + unit.strength, 0)
  const badge = strength
    ? `<div class="map-badge ${province.controller}">${strength}</div>`
    : ""
  element.innerHTML = `<div class="map-tag-name">${escapeHtml(province.name)}</div>${badge}`
  return element
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

function emptyCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] }
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}
