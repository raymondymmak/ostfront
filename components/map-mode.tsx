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
      className={`pointer-events-auto absolute top-2.5 z-20 flex flex-col overflow-hidden rounded-md border border-[#3d342b] bg-[#f6f1e4] text-[11px] font-semibold text-[#241c14] shadow-sm ${className}`}
      role="group"
      aria-label="Map mode"
      data-testid="map-mode"
    >
      {MODES.map(([id, label, hint]) => (
        <button
          key={id}
          type="button"
          title={hint}
          aria-pressed={overlay === id}
          onClick={() => onOverlay(id)}
          className={`px-2 py-1 text-left whitespace-nowrap ${
            overlay === id ? "bg-[#241c14] text-[#f6f1e4]" : "hover:bg-[#e7dcc4]"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
