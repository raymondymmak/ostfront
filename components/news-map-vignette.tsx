"use client"

import { useId, useMemo } from "react"
import { CATALOG_BY_ID } from "@/lib/data/catalog"
import { eachCoord, geometryPolygons, type ProvinceGeometry } from "@/lib/data/geometry"
import type { NewsImage } from "@/lib/news/types"

type NewsMapVignetteProps = {
  image: Extract<NewsImage, { type: "map" }>
}

function pathFor(geometry: ProvinceGeometry): string {
  const parts: string[] = []
  for (const rings of geometryPolygons(geometry)) {
    for (const ring of rings) {
      if (ring.length < 3) continue
      const cmds = ring.map(([lon, lat], index) => `${index === 0 ? "M" : "L"}${lon},${-lat}`)
      parts.push(`${cmds.join(" ")} Z`)
    }
  }
  return parts.join(" ")
}

function bboxFor(ids: string[]): [number, number, number, number] | null {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  let any = false
  for (const id of ids) {
    const geometry = CATALOG_BY_ID[id]?.polygon
    if (!geometry) continue
    eachCoord(geometry, ([lon, lat]) => {
      any = true
      minLon = Math.min(minLon, lon)
      minLat = Math.min(minLat, lat)
      maxLon = Math.max(maxLon, lon)
      maxLat = Math.max(maxLat, lat)
    })
  }
  if (!any) return null
  const pad = 0.55
  return [minLon - pad, minLat - pad, maxLon + pad, maxLat + pad]
}

function curvedArrowPath(x1: number, y1: number, x2: number, y2: number, bend = 0.18): string {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const stopX = x2 - ux * len * 0.22
  const stopY = y2 - uy * len * 0.22
  const mx = (x1 + stopX) / 2
  const my = (y1 + stopY) / 2
  const nx = -uy
  const ny = ux
  const cx = mx + nx * len * bend
  const cy = my + ny * len * bend
  return `M ${x1} ${y1} Q ${cx} ${cy} ${stopX} ${stopY}`
}

export function NewsMapVignette({ image }: NewsMapVignetteProps) {
  const uid = useId().replace(/:/g, "")
  const target = CATALOG_BY_ID[image.provinceId]

  const provinceIds = useMemo(() => {
    const ids = new Set<string>([image.provinceId])
    for (const neighbor of target?.neighbors ?? []) ids.add(neighbor)
    for (const neighbor of target?.neighbors ?? []) {
      for (const hop of CATALOG_BY_ID[neighbor]?.neighbors ?? []) {
        if (hop !== image.provinceId) ids.add(hop)
      }
    }
    for (const from of image.arrowFrom ?? []) ids.add(from)
    return [...ids]
  }, [image.arrowFrom, image.provinceId, target?.neighbors])

  const view = useMemo(() => {
    const box = bboxFor(provinceIds)
    if (!box) return { box: "0 0 10 10", span: 10 }
    const [minLon, minLat, maxLon, maxLat] = box
    const width = maxLon - minLon
    const height = maxLat - minLat
    const span = Math.max(width, height)
    return { box: `${minLon} ${-(maxLat)} ${width} ${height}`, span }
  }, [provinceIds])

  const accent = image.tone === "victory" ? "#d4b06a" : "#c07058"
  const targetFill = image.tone === "victory" ? "#6a8f55" : "#9b4538"
  const strokeMain = view.span * 0.012
  const strokeSoft = view.span * 0.006
  const arrowStroke = view.span * 0.014

  const arrows = useMemo(() => {
    if (!target) return []
    const [tx, ty] = target.centroid
    const sources = (image.arrowFrom?.length ? image.arrowFrom : target.neighbors).slice(0, 3)
    return sources
      .map((fromId) => {
        const from = CATALOG_BY_ID[fromId]
        if (!from) return null
        const [fx, fy] = from.centroid
        return {
          fromId,
          d: curvedArrowPath(fx, -fy, tx, -ty),
          tipX: tx,
          tipY: -ty,
        }
      })
      .filter(Boolean) as { fromId: string; d: string; tipX: number; tipY: number }[]
  }, [image.arrowFrom, target])

  if (!target?.polygon) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">Map unavailable</div>
    )
  }

  return (
    <svg
      viewBox={view.box}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      role="img"
      aria-label="Theater vignette"
    >
      <defs>
        <radialGradient id={`${uid}-vignette`} cx="50%" cy="48%" r="72%">
          <stop offset="35%" stopColor="#3a3128" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#0a0806" stopOpacity="0.95" />
        </radialGradient>
        <filter id={`${uid}-grain`} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="3" seed="4" result="noise" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.06" intercept="0" />
          </feComponentTransfer>
          <feBlend in="SourceGraphic" in2="noise" mode="multiply" />
        </filter>
        <filter id={`${uid}-glow`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation={strokeMain * 1.8} result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <marker
          id={`${uid}-head`}
          markerWidth="6"
          markerHeight="6"
          refX="5.5"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L6,3 L0,6 Z" fill={accent} fillOpacity="0.92" />
        </marker>
      </defs>
      <rect x="-1000" y="-1000" width="2000" height="2000" fill="#1e1914" />
      <rect x="-1000" y="-1000" width="2000" height="2000" fill="#3d342b" fillOpacity="0.35" filter={`url(#${uid}-grain)`} />
      {provinceIds.map((id) => {
        const province = CATALOG_BY_ID[id]
        if (!province?.polygon) return null
        const isTarget = id === image.provinceId
        const isArrowSource = image.arrowFrom?.includes(id) ?? target.neighbors.includes(id)
        return (
          <path
            key={id}
            d={pathFor(province.polygon)}
            fill={isTarget ? targetFill : isArrowSource ? "#4a4036" : "#332b24"}
            fillOpacity={isTarget ? 0.92 : isArrowSource ? 0.7 : 0.45}
            stroke={isTarget ? accent : "#6e5f4f"}
            strokeWidth={isTarget ? strokeMain : strokeSoft}
            strokeOpacity={isTarget ? 1 : 0.55}
            fillRule="evenodd"
            filter={isTarget ? `url(#${uid}-glow)` : `url(#${uid}-grain)`}
          />
        )
      })}
      {arrows.map((arrow) => (
        <path
          key={arrow.fromId}
          d={arrow.d}
          fill="none"
          stroke={accent}
          strokeWidth={arrowStroke}
          strokeOpacity={0.9}
          strokeLinecap="round"
          markerEnd={`url(#${uid}-head)`}
        />
      ))}
      <text
        x={target.centroid[0]}
        y={-target.centroid[1]}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#f3e2a8"
        fillOpacity={0.95}
        fontSize={view.span * 0.07}
        fontFamily="Georgia, serif"
        fontWeight={600}
        style={{ paintOrder: "stroke", stroke: "#1a140e", strokeWidth: view.span * 0.008 }}
      >
        {target.name}
      </text>
      <rect x="-1000" y="-1000" width="2000" height="2000" fill={`url(#${uid}-vignette)`} pointerEvents="none" />
    </svg>
  )
}