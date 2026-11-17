"use client"

import { useId, useMemo } from "react"
import { CATALOG_BY_ID } from "@/lib/data/catalog"
import { vignettePaths, vignetteProvinceIds, vignetteViewBox } from "@/lib/map/svg-geometry"
import type { NewsImage } from "@/lib/news/types"

type NewsMapVignetteProps = {
  image: Extract<NewsImage, { type: "map" }>
}

function curvedArrowPath(x1: number, y1: number, x2: number, y2: number, bend = 0.16): string {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const stopX = x2 - ux * len * 0.2
  const stopY = y2 - uy * len * 0.2
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

  const provinceIds = useMemo(
    () => vignetteProvinceIds(image.provinceId, image.arrowFrom),
    [image.arrowFrom, image.provinceId],
  )

  const view = useMemo(() => vignetteViewBox(provinceIds, 0.35), [provinceIds])
  const paths = useMemo(() => vignettePaths(provinceIds), [provinceIds])

  const accent = image.tone === "victory" ? "#c6a15a" : "#a85b49"
  const targetFill = image.tone === "victory" ? "#6a7d52" : "#8b4035"
  const span = view?.span ?? 1
  const strokeMain = span * 0.01
  const strokeSoft = span * 0.005
  const arrowStroke = span * 0.012

  const arrows = useMemo(() => {
    if (!target) return []
    const [tx, ty] = target.centroid
    const sources = (image.arrowFrom?.length ? image.arrowFrom : target.neighbors).slice(0, 3)
    return sources
      .map((fromId) => {
        const from = CATALOG_BY_ID[fromId]
        if (!from) return null
        const [fx, fy] = from.centroid
        return { fromId, d: curvedArrowPath(fx, -fy, tx, -ty) }
      })
      .filter(Boolean) as { fromId: string; d: string }[]
  }, [image.arrowFrom, target])

  if (!target?.polygon || !view) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">Map unavailable</div>
    )
  }

  const pathById = new Map(paths.map((entry) => [entry.id, entry.d]))

  return (
    <svg
      viewBox={view.box}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full bg-[#12100e]"
      role="img"
      aria-label="Theater vignette"
      data-testid="news-vignette-svg"
    >
      <defs>
        <radialGradient id={`${uid}-shade`} cx="50%" cy="45%" r="68%">
          <stop offset="40%" stopColor="#1a1612" stopOpacity="0" />
          <stop offset="100%" stopColor="#050403" stopOpacity="0.88" />
        </radialGradient>
        <filter id={`${uid}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="0" stdDeviation={strokeMain * 1.8} floodColor={accent} floodOpacity="0.55" />
        </filter>
        <marker
          id={`${uid}-head`}
          markerWidth="5"
          markerHeight="5"
          refX="4.5"
          refY="2.5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L5,2.5 L0,5 Z" fill={accent} />
        </marker>
      </defs>
      <rect x={view.minLon - 10} y={-view.maxLat - 10} width={(view.maxLon - view.minLon) + 20} height={(view.maxLat - view.minLat) + 20} fill="#12100e" />
      {provinceIds.map((id) => {
        const d = pathById.get(id)
        if (!d) return null
        const isTarget = id === image.provinceId
        return (
          <path
            key={id}
            data-province-id={id}
            d={d}
            fill={isTarget ? targetFill : "#5a4a3a"}
            fillOpacity={1}
            stroke={isTarget ? accent : "#3a3028"}
            strokeWidth={isTarget ? strokeMain : strokeSoft}
            fillRule="evenodd"
            filter={isTarget ? `url(#${uid}-glow)` : undefined}
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
        fontSize={span * 0.065}
        fontFamily="Georgia, serif"
        fontWeight={600}
        style={{ paintOrder: "stroke", stroke: "#0a0806", strokeWidth: span * 0.007 }}
      >
        {target.name}
      </text>
      <rect
        x={view.minLon - 10}
        y={-view.maxLat - 10}
        width={(view.maxLon - view.minLon) + 20}
        height={(view.maxLat - view.minLat) + 20}
        fill={`url(#${uid}-shade)`}
        pointerEvents="none"
      />
    </svg>
  )
}