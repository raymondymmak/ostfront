"use client"

import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react"
import type { QueuedOrder } from "@/lib/orders"
import type { MapProvince } from "@/components/war-map"
import { BACKDROP_REGIONS, RIVER_LINES } from "@/lib/data/geometry"
import { labelRank, shortProvinceName, strengthLabelOffset } from "@/lib/map/labels"

type SvgMapProps = {
  provinces: MapProvince[]
  selectedId: string | null
  overlay: "none" | "supply" | "unrest"
  orders: QueuedOrder[]
  flashIds: string[]
  orderMode: boolean
  onSelect: (id: string) => void
  onDraw: (from: string, to: string) => void
}

export function SvgMap({
  provinces,
  selectedId,
  overlay,
  orders,
  flashIds,
  orderMode,
  onSelect,
  onDraw,
}: SvgMapProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [originId, setOriginId] = useState<string | null>(null)
  const [preview, setPreview] = useState<[number, number] | null>(null)

  const view = useMemo(() => {
    let minLon = Infinity
    let maxLon = -Infinity
    let minLat = Infinity
    let maxLat = -Infinity
    const rings = [
      ...provinces.map((province) => province.polygon),
      ...BACKDROP_REGIONS.map((region) => region.polygon),
    ]
    for (const polygon of rings) {
      for (const [lon, lat] of polygon) {
        minLon = Math.min(minLon, lon)
        maxLon = Math.max(maxLon, lon)
        minLat = Math.min(minLat, lat)
        maxLat = Math.max(maxLat, lat)
      }
    }
    if (!Number.isFinite(minLon)) {
      minLon = 16
      maxLon = 28
      minLat = 48
      maxLat = 56
    }
    const pad = 0.35
    const width = maxLon - minLon + pad * 2
    const height = maxLat - minLat + pad * 2
    return {
      box: `${minLon - pad} ${-(maxLat + pad)} ${width} ${height}`,
      label: Math.max(width, height) * 0.018,
    }
  }, [provinces])

  const byId = useMemo(
    () => new Map(provinces.map((province) => [province.id, province])),
    [provinces],
  )
  const origin = originId ? byId.get(originId) : undefined

  function point(event: ReactMouseEvent<SVGSVGElement>) {
    const svg = svgRef.current
    if (!svg) return null
    const matrix = svg.getScreenCTM()
    if (!matrix) return null
    const local = svg.createSVGPoint()
    local.x = event.clientX
    local.y = event.clientY
    const mapped = local.matrixTransform(matrix.inverse())
    return [mapped.x, mapped.y] as [number, number]
  }

  function commit(target: string | null) {
    const origin = originId
    setOriginId(null)
    setPreview(null)
    if (!origin) return
    if (target && target !== origin) onDraw(origin, target)
    else if (target) onSelect(target)
  }

  return (
    <svg
      ref={svgRef}
      viewBox={view.box}
      className="absolute inset-0 h-full w-full overflow-hidden bg-[#4f7f9d]"
      data-testid="svg-map"
      onMouseMove={(event) => {
        if (!originId) return
        setPreview(point(event))
      }}
      onMouseUp={() => commit(null)}
      onMouseLeave={() => {
        if (!originId) return
        setOriginId(null)
        setPreview(null)
      }}
    >
      {BACKDROP_REGIONS.map((region) => {
        if (region.polygon.length < 4) return null
        const points = region.polygon.map(([lon, lat]) => `${lon},${-lat}`).join(" ")
        const cx =
          region.polygon.reduce((sum, coord) => sum + coord[0], 0) / region.polygon.length
        const cy =
          region.polygon.reduce((sum, coord) => sum + coord[1], 0) / region.polygon.length
        return (
          <g key={region.id} pointerEvents="none">
            <polygon
              points={points}
              fill="#8f9699"
              fillOpacity={0.94}
              stroke="#5c6468"
              strokeWidth={view.label * 0.06}
              strokeOpacity={0.85}
            />
            {region.name !== "Baltic Sea" && (
              <text
                x={cx}
                y={-cy}
                textAnchor="middle"
                fill="#4a5258"
                fillOpacity={0.72}
                fontSize={view.label * 0.85}
                fontFamily="Georgia, serif"
              >
                {region.name}
              </text>
            )}
          </g>
        )
      })}
      {RIVER_LINES.map((river) => (
        <polyline
          key={river.id}
          points={river.coordinates.map(([lon, lat]) => `${lon},${-lat}`).join(" ")}
          fill="none"
          stroke="#4a7a9a"
          strokeWidth={view.label * 0.09}
          strokeOpacity={0.75}
          pointerEvents="none"
        />
      ))}
      {provinces.map((province) => {
        if (province.polygon.length < 4) return null
        const points = province.polygon.map(([lon, lat]) => `${lon},${-lat}`).join(" ")
        const selected = province.id === selectedId
        const flashing = flashIds.includes(province.id)
        return (
          <polygon
            key={province.id}
            points={points}
            fill={provinceFill(province, overlay)}
            stroke={selected ? "#f3e2a8" : province.controller === "central" ? "#1c3348" : "#5c261c"}
            strokeWidth={selected ? view.label * 0.22 : view.label * 0.08}
            className={flashing ? "animate-pulse" : undefined}
            style={{ cursor: orderMode ? "crosshair" : "pointer" }}
            onMouseDown={(event) => {
              if (!orderMode) return
              event.preventDefault()
              event.stopPropagation()
              setOriginId(province.id)
            }}
            onMouseUp={(event) => {
              event.stopPropagation()
              if (orderMode && originId) commit(province.id)
              else onSelect(province.id)
            }}
          />
        )
      })}
      {orders.map((order) => {
        if (!order.to) return null
        const from = byId.get(order.from)
        const to = byId.get(order.to)
        if (!from || !to) return null
        return (
          <line
            key={order.id}
            x1={from.centroid[0]}
            y1={-from.centroid[1]}
            x2={to.centroid[0]}
            y2={-to.centroid[1]}
            stroke={order.kind === "attack" ? "#8e2a22" : "#1d4e79"}
            strokeWidth={view.label * 0.16}
            pointerEvents="none"
          />
        )
      })}
      {preview && origin && (
        <line
          x1={origin.centroid[0]}
          y1={-origin.centroid[1]}
          x2={preview[0]}
          y2={preview[1]}
          stroke="#6a4b16"
          strokeWidth={view.label * 0.12}
          strokeDasharray={`${view.label * 0.2} ${view.label * 0.14}`}
          pointerEvents="none"
        />
      )}
      {provinces
        .filter((province) => province.polygon.length >= 4)
        .map((province) => {
        const strength = province.units.reduce((sum, unit) => sum + unit.strength, 0)
        const x = province.centroid[0]
        const y = -province.centroid[1]
        const offset = labelOffset(province.id)
        const [sx, sy] = strengthLabelOffset(province.id)
        return (
          <g key={`${province.id}-label`} pointerEvents="none">
            <text
              x={x + offset[0]}
              y={y + offset[1]}
              textAnchor="middle"
              fill={province.id === selectedId ? "#6a4b16" : "#241c14"}
              fontSize={view.label}
              fontFamily="Georgia, serif"
              fontWeight={600}
              style={{ textShadow: "0 1px 0 rgba(255,248,230,0.75)" }}
            >
              {province.depot ? "◆ " : ""}
              {shortProvinceName(province.name)}
            </text>
            {strength > 0 && (
              <text
                x={x + offset[0] + sx * view.label * 0.35}
                y={y + offset[1] + view.label * (1.15 + sy * 0.15)}
                textAnchor="middle"
                fill={province.controller === "central" ? "#1c3348" : "#6a2a22"}
                fontSize={view.label * 0.85}
                fontFamily="Georgia, serif"
              >
                <title>
                  Total unit strength: {strength} (
                  {province.controller === "central" ? "Central Powers" : "Russia"})
                </title>
                {strength}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** Tiny deterministic nudge so dense labels separate without leaving the province. */
function labelOffset(id: string): [number, number] {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  const angle = (hash % 360) * (Math.PI / 180)
  const radius = 0.04 + (hash % 7) * 0.01
  return [Math.cos(angle) * radius, Math.sin(angle) * radius]
}

function provinceFill(province: MapProvince, overlay: SvgMapProps["overlay"]): string {
  if (overlay === "supply") return ramp(province.supply, "#7a2e2a", "#c6a15a", "#2d6a45", 45)
  if (overlay === "unrest") return ramp(province.unrest, "#3e5348", "#d4a24c", "#8e2430", 50)
  return province.controller === "central" ? "#4a6d90" : "#a85b49"
}

function ramp(value: number, low: string, mid: string, high: string, pivot: number): string {
  if (value <= pivot) return mix(low, mid, pivot === 0 ? 1 : value / pivot)
  return mix(mid, high, (value - pivot) / (100 - pivot))
}

function mix(from: string, to: string, t: number): string {
  const amount = Math.min(1, Math.max(0, t))
  const a = rgb(from)
  const b = rgb(to)
  const channel = (index: number) => Math.round(a[index] + (b[index] - a[index]) * amount)
  return `rgb(${channel(0)} ${channel(1)} ${channel(2)})`
}

function rgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}
