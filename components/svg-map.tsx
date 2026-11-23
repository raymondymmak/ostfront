"use client"

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import type { QueuedOrder } from "@/lib/orders"
import type { MapProvince } from "@/components/war-map"
import {
  BACKDROP_REGIONS,
  COUNTRY_BORDERS,
  COUNTRY_LABELS,
  RIVER_LINES,
  VIEW_BBOX,
  backdropColor,
  eachCoord,
  geometryValid,
  type ProvinceGeometry,
} from "@/lib/data/geometry"
import { geometryPath } from "@/lib/map/svg-geometry"
import { listedStrength } from "@/lib/engine/echelon"
import { shortProvinceName, strengthLabelOffset } from "@/lib/map/labels"
import { RAIL_STYLE, railLines, type RailEnd } from "@/lib/map/rail-lines"
import { provinceHoverNote } from "@/lib/ui/map-hover"
import { provincePaintProperties, resolvedFill, roleFor } from "@/lib/map/province-paint"
import { TARGET_HIGHLIGHT_FADE_MS } from "@/lib/map/target-highlight"
import { TARGET_OUTLINE } from "@/lib/map/target-outline-style"

type SvgMapProps = {
  provinces: MapProvince[]
  selectedId: string | null
  overlay: "none" | "supply" | "unrest"
  orders: QueuedOrder[]
  flashIds: string[]
  orderMode: boolean
  showRails: boolean
  targetIds?: { move: string[]; attack: string[]; canOrder: boolean }
  targetHoverNote?: (provinceId: string, base: string) => string
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
  showRails,
  targetIds,
  targetHoverNote,
  onSelect,
  onDraw,
}: SvgMapProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [originId, setOriginId] = useState<string | null>(null)
  const originIdRef = useRef<string | null>(null)
  useEffect(() => {
    originIdRef.current = originId
  }, [originId])
  const [preview, setPreview] = useState<[number, number] | null>(null)
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null)
  const [hoverTip, setHoverTip] = useState<string | null>(null)

  const view = useMemo(() => {
    const [minLon, minLat, maxLon, maxLat] = VIEW_BBOX
    const pad = 0.15
    const width = maxLon - minLon + pad * 2
    const height = maxLat - minLat + pad * 2
    return {
      box: `${minLon - pad} ${-(maxLat + pad)} ${width} ${height}`,
      label: Math.max(width, height) * 0.018,
    }
  }, [])

  const byId = useMemo(
    () => new Map(provinces.map((province) => [province.id, province])),
    [provinces],
  )
  const visibleStates = useMemo(
    () => BACKDROP_REGIONS.filter((region) => geometryValid(region.geometry) && geometryOverlapsView(region.geometry)),
    [],
  )
  const visibleCountryBorders = useMemo(
    () => COUNTRY_BORDERS.coordinates.filter((line) => lineOverlapsView(line)),
    [],
  )
  const origin = originId ? byId.get(originId) : undefined
  const paintTargets = targetIds
    ? { move: targetIds.move, attack: targetIds.attack, canOrder: targetIds.canOrder }
    : undefined
  const previewValid =
    Boolean(originId && hoverTargetId && hoverTargetId !== originId && origin?.neighbors.includes(hoverTargetId))
  const arrowDrag: "valid" | "invalid" | null = originId ? (previewValid ? "valid" : "invalid") : null

  function point(event: ReactPointerEvent<Element>) {
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

  function clearDrag() {
    setOriginId(null)
    setPreview(null)
    setHoverTargetId(null)
  }

  function commit(target: string | null) {
    const from = originIdRef.current
    clearDrag()
    if (!from) return
    // Non-neighbors still call onDraw so the shell can cancel with a hint (no queue).
    if (target && target !== from) onDraw(from, target)
    else if (target) onSelect(target)
  }

  return (
    <>
      <svg
        ref={svgRef}
        viewBox={view.box}
        className="absolute inset-0 h-full w-full overflow-hidden bg-[#4f7f9d]"
        data-testid="svg-map"
        data-arrow-drag={arrowDrag ?? undefined}
        onPointerMove={(event) => {
          if (!originId) return
          setPreview(point(event))
        }}
        onPointerUp={() => commit(null)}
        onPointerLeave={() => {
          setHoverTip(null)
          if (!originId) return
          clearDrag()
        }}
      >
      {visibleStates.map((region) => (
        <path
          key={region.id}
          d={geometryPath(region.geometry)}
          fill={backdropColor(region.owner)}
          fillOpacity={0.96}
          fillRule="evenodd"
          stroke="#6a7278"
          strokeWidth={view.label * 0.035}
          strokeOpacity={0.9}
          pointerEvents="none"
        />
      ))}
      {visibleCountryBorders.map((line, index) => (
        <polyline
          key={`border-${index}`}
          points={line.map(([lon, lat]) => `${lon},${-lat}`).join(" ")}
          fill="none"
          stroke="#2a3034"
          strokeWidth={view.label * 0.07}
          strokeOpacity={0.92}
          pointerEvents="none"
        />
      ))}
      {COUNTRY_LABELS.map((label) => (
        <text
          key={label.owner}
          x={label.label[0]}
          y={-label.label[1]}
          textAnchor="middle"
          fill="#4a5258"
          fillOpacity={0.72}
          fontSize={view.label * 0.85}
          fontFamily="Georgia, serif"
          pointerEvents="none"
        >
          {label.name}
        </text>
      ))}
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
        if (!geometryValid(province.polygon)) return null
        const selected = province.id === selectedId
        const flashing = flashIds.includes(province.id)
        const role = roleFor(province.id, paintTargets, selectedId)
        const paint = provincePaintProperties(province, overlay, role)
        let stroke = selected ? "#f3e2a8" : province.controller === "central" ? "#1c3348" : "#5c261c"
        let strokeWidth = selected ? view.label * 0.22 : view.label * 0.08
        const fill = resolvedFill(paint, role)
        let fillOpacity: number | undefined
        if (role === "attack") {
          stroke = TARGET_OUTLINE.attack.color
          strokeWidth = view.label * (targetIds?.canOrder ? 0.26 : 0.2)
          fillOpacity = 0.94
        } else if (role === "move") {
          stroke = TARGET_OUTLINE.move.color
          strokeWidth = view.label * (targetIds?.canOrder ? 0.26 : 0.2)
          fillOpacity = 0.94
        } else if (role === "reach") {
          stroke = TARGET_OUTLINE.reach.color
          strokeWidth = view.label * 0.14
          fillOpacity = 0.72
        }
        const tip = provinceHoverNote(province, targetHoverNote)
        const pathD = geometryPath(province.polygon)
        return (
          <g key={province.id}>
            <path
              d={pathD}
              data-province-id={province.id}
              fill={fill}
              fillOpacity={fillOpacity}
              fillRule="evenodd"
              stroke={stroke}
              strokeWidth={strokeWidth}
              className={flashing ? "animate-pulse" : undefined}
              style={{
                cursor: orderMode
                  ? originId && province.id !== originId && !origin?.neighbors.includes(province.id)
                    ? "not-allowed"
                    : "crosshair"
                  : "pointer",
                transition: `fill ${TARGET_HIGHLIGHT_FADE_MS}ms ease, fill-opacity ${TARGET_HIGHLIGHT_FADE_MS}ms ease`,
              }}
              onPointerOver={() => {
                setHoverTip(tip)
                if (originIdRef.current) setHoverTargetId(province.id)
              }}
              onPointerOut={() => {
                setHoverTip(null)
                if (originIdRef.current) setHoverTargetId(null)
              }}
              onPointerDown={(event) => {
                if (!orderMode) return
                event.preventDefault()
                event.stopPropagation()
                originIdRef.current = province.id
                setOriginId(province.id)
                setHoverTargetId(null)
              }}
              onPointerUp={(event) => {
                event.stopPropagation()
                if (orderMode && originIdRef.current) commit(province.id)
                else onSelect(province.id)
              }}
            >
              <title>{tip}</title>
            </path>
          </g>
        )
      })}
      {showRails &&
        railLines(
          provinces.map(
            (province): RailEnd => ({
              id: province.id,
              neighbors: province.neighbors,
              rail: province.rail,
              controller: province.controller,
              anchor: province.centroid,
              polygon: province.polygon,
            }),
          ),
          selectedId,
        ).map((line) => {
          const points = line.coordinates.map(([lon, lat]) => `${lon},${-lat}`).join(" ")
          const color = line.side === "cut" ? RAIL_STYLE.cut : RAIL_STYLE.track
          const scale = line.hot ? line.hotWidthScale : 1
          const trackWidth = view.label * 0.082 * scale
          const casingWidth = view.label * 0.126 * scale
          const isCut = line.side === "cut"
          return (
            <g key={`${line.a}-${line.b}`} pointerEvents="none" opacity={0.85}>
              {!isCut && (
                <polyline
                  points={points}
                  fill="none"
                  stroke={RAIL_STYLE.casing}
                  strokeWidth={casingWidth}
                  strokeLinecap="round"
                />
              )}
              <polyline
                points={points}
                fill="none"
                stroke={color}
                strokeWidth={trackWidth}
                strokeLinecap="round"
                strokeDasharray={isCut ? `${view.label * 0.16} ${view.label * 0.18}` : undefined}
              />
            </g>
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
          data-testid="svg-arrow-preview"
          data-arrow-valid={previewValid ? "true" : "false"}
          x1={origin.centroid[0]}
          y1={-origin.centroid[1]}
          x2={preview[0]}
          y2={preview[1]}
          stroke={previewValid ? "#6a4b16" : "#8e2a22"}
          strokeWidth={view.label * (previewValid ? 0.12 : 0.14)}
          strokeDasharray={`${view.label * 0.2} ${view.label * 0.14}`}
          strokeOpacity={previewValid ? 0.95 : 0.88}
          pointerEvents="none"
        />
      )}
      {provinces
        .filter((province) => geometryValid(province.polygon))
        .map((province) => {
        const strength = listedStrength(province.units)
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
              fill={province.id === selectedId ? "#f6f1e4" : "#241c14"}
              fontSize={view.label}
              fontFamily="Georgia, serif"
              fontWeight={600}
              style={{
                textShadow:
                  province.id === selectedId
                    ? "0 0 2px #241c14, 0 0 4px #241c14"
                    : "0 1px 0 rgba(255,248,230,0.75)",
              }}
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
      {hoverTip ? (
        <div
          className={`pointer-events-none absolute left-2 z-20 max-w-[min(14rem,calc(100%-1rem))] rounded-sm border border-leather/40 bg-paper/95 px-2.5 py-2 text-xs whitespace-pre-line text-ink shadow-[0_6px_14px_rgba(36,28,20,0.18)] ${orderMode ? "top-12" : "top-2"}`}
          role="tooltip"
          data-testid="svg-map-hover-tip"
        >
          {hoverTip}
        </div>
      ) : null}
    </>
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

function geometryOverlapsView(geometry: ProvinceGeometry): boolean {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  eachCoord(geometry, ([x, y]) => {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  })
  return maxX >= VIEW_BBOX[0] && minX <= VIEW_BBOX[2] && maxY >= VIEW_BBOX[1] && minY <= VIEW_BBOX[3]
}

function lineOverlapsView(line: number[][]): boolean {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of line) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return maxX >= VIEW_BBOX[0] && minX <= VIEW_BBOX[2] && maxY >= VIEW_BBOX[1] && minY <= VIEW_BBOX[3]
}

