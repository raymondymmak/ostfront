import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function relativeLuminance(hex: string): number {
  const n = hex.replace("#", "")
  const r = parseInt(n.slice(0, 2), 16) / 255
  const g = parseInt(n.slice(2, 4), 16) / 255
  const b = parseInt(n.slice(4, 6), 16) / 255
  const f = (x: number) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrastRatio(a: string, b: string): number {
  const L1 = relativeLuminance(a)
  const L2 = relativeLuminance(b)
  const hi = Math.max(L1, L2)
  const lo = Math.min(L1, L2)
  return (hi + 0.05) / (lo + 0.05)
}

function token(css: string, name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!match) throw new Error(`Missing token ${name}`)
  return match[1]!
}

describe("parchment contrast tokens", () => {
  const css = readFileSync("app/globals.css", "utf8")
  const root = css.slice(css.indexOf(":root {"), css.indexOf(".dark {"))

  it("keeps Close-fortnight and news primary text at least 4.5:1", () => {
    const primary = token(root, "--primary")
    const primaryFg = token(root, "--primary-foreground")
    const paperDeep = token(root, "--paper-deep")
    expect(contrastRatio(primaryFg, primary)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(primary, paperDeep)).toBeGreaterThanOrEqual(4.5)
  })
})
