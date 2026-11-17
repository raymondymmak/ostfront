"use client"

import { useMemo } from "react"
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
  const pad = 0.35
  return [minLon - pad, minLat - pad, maxLon + pad, maxLat + pad]
}

export function NewsMapVignette({ image }: NewsMapVignetteProps) {
  const target = CATALOG_BY_ID[image.provinceId]
  const neighborIds = useMemo(() => {
    const base = new Set(target?.neighbors ?? [])
    for (const id of image.arrowFrom ?? []) base.add(id)
    return [...base]
  }, [image.arrowFrom, target?.neighbors])

  const view = useMemo(() => {
    const box = bboxFor([image.provinceId, ...neighborIds])
    if (!box) return "0 0 10 10"
    const [minLon, minLat, maxLon, maxLat] = box
    const width = maxLon - minLon
    const height = maxLat - minLat
    return `${minLon} ${-(maxLat)} ${width} ${height}`
  }, [image.provinceId, neighborIds])

  const accent = image.tone === "victory" ? "#c6a15a" : "#a85b49"
  const targetFill = image.tone === "victory" ? "#5a7f4a" : "#8b3d35"

  const arrows = useMemo(() => {
    if (!target) return []
    const [tx, ty] = target.centroid
    return (image.arrowFrom ?? target.neighbors.slice(0, 3)).map((fromId) => {
      const from = CATALOG_BY_ID[fromId]
      if (!from) return null
      const [fx, fy] = from.centroid
      return { fromId, x1: fx, y1: -fy, x2: tx, y2: -ty }
    }).filter(Boolean) as { fromId: string; x1: number; y1: number; x2: number; y2: number }[]
  }, [image.arrowFrom, target])

  if (!target?.polygon) {
    return <div className="bg-muted text-muted-foreground flex h-40 items-center justify-center text-sm">Map unavailable</div>
  }

  return (
    <svg viewBox={view} className="h-full w-full" role="img" aria-label="Theater vignette">
      <defs>
        <radialGradient id="news-vignette-fade" cx="50%" cy="50%" r="70%">
          <stop offset="55%" stopColor="#1a140e" stopOpacity="0" />
          <stop offset="100%" stopColor="#0a0806" stopOpacity="0.92" />
        </radialGradient>
        <filter id="news-grain" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="noise" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.08" />
          </feComponentTransfer>
          <feBlend in="SourceGraphic" in2="noise" mode="multiply" />
        </filter>
        <marker id="news-arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill={accent} fillOpacity="0.9" />
        </marker>
      </defs>
      <rect x="-1000" y="-1000" width="2000" height="2000" fill="#2a231c" filter="url(#news-grain)" />
      {neighborIds.map((id) => {
        const province = CATALOG_BY_ID[id]
        if (!province?.polygon) return null
        const highlight = id === image.provinceId
        return (
          <path
            key={id}
            d={pathFor(province.polygon)}
            fill={highlight ? targetFill : "#3d342b"}
            fillOpacity={highlight ? 0.95 : 0.55}
            stroke={highlight ? accent : "#5c4f42"}
            strokeWidth={highlight ? 0.08 : 0.04}
            filter={highlight ? undefined : "url(#news-grain)"}
          />
        )
      })}
      {arrows.map((arrow) => (
        <line
          key={arrow.fromId}
          x1={arrow.x1}
          y1={arrow.y1}
          x2={arrow.x2}
          y2={arrow.y2}
          stroke={accent}
          strokeWidth={0.07}
          strokeOpacity={0.85}
          markerEnd="url(#news-arrowhead)"
        />
      ))}
      <rect x="-1000" y="-1000" width="2000" height="2000" fill="url(#news-vignette-fade)" pointerEvents="none" />
    </svg>
  )
}