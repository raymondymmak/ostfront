import { readFileSync } from "node:fs"

export type BmpImage = { width: number; height: number; /** BGR rows, bottom-up */ rows: Buffer; rowBytes: number }

export function loadBmp24(path: string): BmpImage {
  const buf = readFileSync(path)
  if (buf.toString("ascii", 0, 2) !== "BM") throw new Error(`Not a BMP: ${path}`)
  const offset = buf.readUInt32LE(10)
  const width = buf.readInt32LE(18)
  const height = Math.abs(buf.readInt32LE(22))
  const bpp = buf.readUInt16LE(28)
  if (bpp !== 24) throw new Error(`Expected 24bpp BMP, got ${bpp}`)
  const rowBytes = Math.floor((width * 3 + 3) / 4) * 4
  const rows = buf.subarray(offset, offset + rowBytes * height)
  return { width, height, rows, rowBytes }
}

export function pixelBgr(img: BmpImage, x: number, y: number): [number, number, number] {
  const row = img.height - 1 - y
  const base = row * img.rowBytes + x * 3
  const b = img.rows[base]
  const g = img.rows[base + 1]
  const r = img.rows[base + 2]
  return [b, g, r]
}

export function pixelRgb(img: BmpImage, x: number, y: number): [number, number, number] {
  const [b, g, r] = pixelBgr(img, x, y)
  return [r, g, b]
}
