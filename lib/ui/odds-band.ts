import type { EngagementPreview } from "@/lib/engine/turn"
import type { OddsBand, OddsBandTone } from "@/lib/ui/types"

const CAVEAT =
  "Against the garrison as it stands; a simultaneous enemy march can change the fight."

export function oddsBand(preview: EngagementPreview | null): OddsBand {
  if (!preview) {
    return { tone: "even", ratio: 1, label: "Unknown", detail: [CAVEAT] }
  }
  if (preview.empty && preview.origins < 2) {
    return {
      tone: "open",
      ratio: Number.POSITIVE_INFINITY,
      label: "Undefended",
      detail: [`Undefended, before the dice.`, CAVEAT],
    }
  }

  const ratio = preview.empty || !Number.isFinite(preview.ratio) ? Number.POSITIVE_INFINITY : preview.ratio
  const tone: OddsBandTone =
    preview.empty && preview.origins >= 2
      ? "open"
      : ratio < 0.9
        ? "bad"
        : ratio <= 1.4
          ? "even"
          : "good"
  const label =
    tone === "open"
      ? "Undefended"
      : tone === "good"
        ? "Favourable"
        : tone === "bad"
          ? "Unlikely"
          : "Even"

  const ratioText =
    preview.empty || !Number.isFinite(preview.ratio) ? "undefended" : `${preview.ratio.toFixed(2)} : 1`
  const detail: string[] = []

  if (preview.origins >= 2) {
    const shape = preview.origins === 2 ? "two-pronged" : "concentric"
    const ring = preview.encircled ? ", and the defender is surrounded" : ""
    detail.push(
      `One battle, ${preview.origins} directions, ${shape}, about ${ratioText} before the dice${ring}.`,
    )
  } else {
    detail.push(`About ${ratioText} before the dice.`)
  }
  detail.push(CAVEAT)

  return { tone, ratio, label, detail }
}

/** Orders-panel wording — label plus ratio so advisor facts match the UI bar. */
export function formatUiOddsForAdvisor(preview: EngagementPreview): string {
  const band = oddsBand(preview)
  if (preview.empty && preview.origins < 2) return band.label
  if (preview.empty || !Number.isFinite(preview.ratio)) {
    return band.label
  }
  const ratio = preview.ratio.toFixed(2)
  return `${band.label}, ${ratio}`
}