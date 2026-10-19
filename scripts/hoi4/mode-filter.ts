/** 3×3 majority filter; 0 = nodata and never wins. */
export function modeFilter3x3(width: number, height: number, data: Uint16Array): Uint16Array {
  const out = new Uint16Array(data.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const counts = new Map<number, number>()
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const v = data[ny * width + nx]
          if (!v) continue
          counts.set(v, (counts.get(v) ?? 0) + 1)
        }
      }
      let best = data[y * width + x]
      let bestN = 0
      for (const [v, n] of counts) {
        if (n > bestN) {
          bestN = n
          best = v
        }
      }
      out[y * width + x] = best
    }
  }
  return out
}
