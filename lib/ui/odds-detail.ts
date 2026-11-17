import type { EngagementPreview } from "@/lib/engine/turn"
import { oddsBand } from "@/lib/ui/odds-band"

/** Compact odds copy for inline lists (e.g. neighbor rows). */
export function oddsDetailLine(preview: EngagementPreview): string {
  const band = oddsBand(preview)
  if (band.tone === "open" && preview.origins < 2) return "undefended"
  if (preview.origins > 1) {
    const shape = preview.origins === 2 ? "two-pronged" : "concentric"
    const ratio =
      preview.empty || !Number.isFinite(preview.ratio) ? "undefended" : `${preview.ratio.toFixed(2)} : 1`
    return preview.encircled
      ? `one battle, ${shape}, surrounded, ${ratio}`
      : `one battle, ${shape}, ${ratio}`
  }
  return preview.empty ? "undefended" : `odds ${preview.ratio.toFixed(2)} : 1`
}