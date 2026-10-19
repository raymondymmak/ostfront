/**
 * Extract polygon rings from a label grid (shared edges between cells).
 * Labels are small integers; 0 = background / no fill.
 */

export type Segment = { x0: number; y0: number; x1: number; y1: number; left: number; right: number }

function edgeKey(x0: number, y0: number, x1: number, y1: number): string {
  if (x0 < x1 || (x0 === x1 && y0 < y1)) return `${x0},${y0}|${x1},${y1}`
  return `${x1},${y1}|${x0},${y0}`
}

/** Build boundary segments between differing labels (cell corners at integer grid). */
export function segmentsFromLabelGrid(width: number, height: number, labels: Uint16Array): Segment[] {
  const segments: Segment[] = []
  const get = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : labels[y * width + x])

  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const a = get(x, y)
      const b = get(x + 1, y)
      const c = get(x + 1, y + 1)
      const d = get(x, y + 1)
      if (a === b && b === c && c === d) continue

      const corners = [a, b, c, d]
      const unique = [...new Set(corners.filter((v) => v !== 0))]
      if (unique.length < 2) continue

      // Marching squares cases — emit edges on cell boundary between differing labels
      const edges: [number, number, number, number, number, number][] = []
      const mx = x + 0.5
      const my = y + 0.5

      const caseIdx = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0)
      if (caseIdx === 0 || caseIdx === 15) continue

      const addH = (yLine: number, left: number, right: number) => {
        if (left === right || left === 0 || right === 0) return
        edges.push([x, yLine, x + 1, yLine, left, right])
      }
      const addV = (xLine: number, top: number, bottom: number) => {
        if (top === bottom || top === 0 || bottom === 0) return
        edges.push([xLine, y, xLine, y + 1, top, bottom])
      }

      if (a !== b && a !== 0 && b !== 0) addH(y, a, b)
      if (b !== c && b !== 0 && c !== 0) addV(x + 1, b, c)
      if (c !== d && c !== 0 && d !== 0) addH(y + 1, d, c)
      if (d !== a && d !== 0 && a !== 0) addV(x, a, d)

      // saddle cases — split using average
      if (edges.length === 0) {
        if (a !== c && a !== 0 && c !== 0) {
          addH(my, a, c)
        }
        if (b !== d && b !== 0 && d !== 0) {
          addV(mx, b, d)
        }
      }

      for (const [x0, y0, x1, y1, left, right] of edges) {
        segments.push({ x0, y0, x1, y1, left, right })
      }
    }
  }
  return segments
}

export function ringsForLabel(
  segments: Segment[],
  label: number,
): [number, number][][] {
  const adj = new Map<string, [number, number][]>()
  for (const s of segments) {
    const left = s.left === label ? s.right : s.left === label ? s.left : null
    if (left === null) continue
    const other = s.left === label ? s.right : s.left
    if (other === label) continue
    const k = edgeKey(s.x0, s.y0, s.x1, s.y1)
    if (!adj.has(k)) adj.set(k, [])
    adj.get(k)!.push([s.x0, s.y0], [s.x1, s.y1])
  }

  const pointKey = (x: number, y: number) => `${x},${y}`
  const neighbors = new Map<string, [number, number][]>()

  for (const s of segments) {
    if (s.left !== label && s.right !== label) continue
    const p0 = pointKey(s.x0, s.y0)
    const p1 = pointKey(s.x1, s.y1)
    if (!neighbors.has(p0)) neighbors.set(p0, [])
    if (!neighbors.has(p1)) neighbors.set(p1, [])
    neighbors.get(p0)!.push([s.x1, s.y1])
    neighbors.get(p1)!.push([s.x0, s.y0])
  }

  const visited = new Set<string>()
  const rings: [number, number][][] = []

  for (const start of neighbors.keys()) {
    if (visited.has(start)) continue
    const ring: [number, number][] = []
    let cur = start
    let prev: string | null = null
    for (let guard = 0; guard < 200_000; guard++) {
      if (visited.has(cur) && ring.length > 2) break
      visited.add(cur)
      const [sx, sy] = cur.split(",").map(Number)
      ring.push([sx, sy])
      const nbs = neighbors.get(cur) ?? []
      let next: string | null = null
      for (const [nx, ny] of nbs) {
        const nk = pointKey(nx, ny)
        if (nk === prev) continue
        next = nk
        break
      }
      if (!next || next === start) {
        if (ring.length >= 4) rings.push(ring)
        break
      }
      prev = cur
      cur = next
    }
  }
  return rings
}
