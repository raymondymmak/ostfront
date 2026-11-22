"use client"

type Overlay = "none" | "supply" | "unrest"

const MODES = [
  ["none", "Control", "Colour provinces by who holds them"],
  ["supply", "Supply", "Colour by supply. Under 30, formations cannot advance"],
  ["unrest", "Unrest", "Colour by unrest. At 85, formations lose strength"],
] as const

export function MapMode({
  overlay,
  onOverlay,
  className = "",
}: {
  overlay: Overlay
  onOverlay: (overlay: Overlay) => void
  className?: string
}) {
  return (
    <div
      className={`pointer-events-auto absolute top-2.5 z-20 flex flex-col overflow-hidden rounded-sm border border-leather/55 bg-paper text-[11px] font-semibold text-ink shadow-[0_6px_14px_rgba(36,28,20,0.18)] ${className}`}
      role="group"
      aria-label="Map mode"
      data-testid="map-mode"
    >
      {MODES.map(([id, label, hint]) => (
        <button
          key={id}
          type="button"
          data-testid={`map-mode-${id}`}
          title={hint}
          aria-pressed={overlay === id}
          onClick={() => onOverlay(id)}
          className={`px-2 py-1 text-left whitespace-nowrap ${
            overlay === id ? "bg-brass text-ink" : "hover:bg-paper-deep"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
