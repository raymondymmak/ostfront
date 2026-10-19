import type { loadBmp24 } from "./load-bmp"
import { pixelRgb } from "./load-bmp"
import { rgbKey } from "./definition"

/** Undirected adjacency between HOI4 province ids (shared map edge). */
export function buildHoi4Adjacency(
  img: ReturnType<typeof loadBmp24>,
  rgbToId: Map<number, number>,
  byId: Map<number, { isSea: boolean; isLake: boolean }>,
): Map<number, Set<number>> {
  const adj = new Map<number, Set<number>>()
  const { width, height } = img

  const pidAt = (x: number, y: number): number | undefined => {
    const rgb = pixelRgb(img, x, y)
    const pid = rgbToId.get(rgbKey(rgb))
    if (!pid) return undefined
    const meta = byId.get(pid)
    if (!meta || meta.isSea || meta.isLake) return undefined
    return pid
  }

  const link = (a: number, b: number) => {
    if (a === b) return
    if (!adj.has(a)) adj.set(a, new Set())
    if (!adj.has(b)) adj.set(b, new Set())
    adj.get(a)!.add(b)
    adj.get(b)!.add(a)
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = pidAt(x, y)
      if (!a) continue
      const r = pidAt(x + 1, y)
      if (r) link(a, r)
      const d = pidAt(x, y + 1)
      if (d) link(a, d)
    }
  }
  return adj
}
