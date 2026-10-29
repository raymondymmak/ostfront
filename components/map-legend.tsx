"use client"

import { useEffect, useState } from "react"
import { RAIL_STYLE } from "@/lib/map/rail-lines"

type Overlay = "none" | "supply" | "unrest"

export function MapLegend({
  showRails,
  onToggleRails,
  overlay,
}: {
  showRails: boolean
  onToggleRails: () => void
  overlay: Overlay
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)")
    const sync = () => setOpen(media.matches)
    sync()
    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  }, [])

  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 z-20 max-h-[calc(100%-1.5rem)] max-w-[min(18rem,calc(100%-1.5rem))] overflow-y-auto rounded-md bg-[#f6f1e4]/95 text-[11px] text-[#241c14] shadow-sm">
      <div className="flex items-center px-2 py-1.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center justify-between gap-2 px-0.5 py-0.5 text-left font-semibold text-[#3d342b]"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          Map legend
          <span className="text-[10px] font-normal text-[#5c5144]">{open ? "Hide" : "Show"}</span>
        </button>
      </div>
      {open && (
        <div className="border-t border-[#3d342b]/20 px-2.5 py-2">
          <div className="flex items-center gap-2">
            <span className="inline-block size-2.5 bg-[#4a6d90]" /> Central Powers
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="inline-block size-2.5 bg-[#a85b49]" /> Russia
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="inline-block size-2.5 bg-[#b7b5b1]" /> The rest of the world in 1914, in grey
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="inline-block size-2.5 rotate-45 bg-[#8a6a32]" /> Depot
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[#8a6a32]">★</span> Victory-point city
          </div>
          <div className="mt-1.5 border-t border-[#3d342b]/25 pt-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-[#3d342b]">Rails</p>
              <button
                type="button"
                data-testid="rail-toggle"
                aria-pressed={showRails}
                aria-label="Rails"
                title={showRails ? "Hide railways" : "Show railways"}
                onClick={onToggleRails}
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  showRails ? "bg-[#241c14] text-[#f6f1e4]" : "text-[#5c5144]"
                }`}
              >
                {showRails ? "On" : "Off"}
              </button>
            </div>
            <p className="mt-0.5 flex items-center gap-2">
              <RailSwatch color={RAIL_STYLE.central} /> Held by one side
            </p>
            <p className="mt-0.5 flex items-center gap-2">
              <RailSwatch color={RAIL_STYLE.cut} broken /> Cut between the two sides
            </p>
          </div>
          <div className="mt-1.5 border-t border-[#3d342b]/25 pt-1.5">
            <p className="font-semibold text-[#3d342b]">Strength counters</p>
            <p className="mt-0.5 flex items-center gap-2">
              <span className="inline-flex min-w-[1.1rem] justify-center rounded-full border border-[#1c3348]/45 bg-[#f6f1e4] px-1 text-[9px] font-bold text-[#1c3348]">
                82
              </span>
              Central Powers total in a province
            </p>
            <p className="mt-0.5 flex items-center gap-2">
              <span className="inline-flex min-w-[1.1rem] justify-center rounded-full border border-[#6a2a22]/45 bg-[#f6f1e4] px-1 text-[9px] font-bold text-[#6a2a22]">
                52
              </span>
              Russia total in a province
            </p>
          </div>
          <p className="mt-1 text-[#5c5144]">Baltic lies north. The states are the map.</p>
          <p className="mt-1 text-[10px] leading-snug text-[#5c5144]">
            Map geometry: MapChart.net (CC BY-SA 4.0), based on Hearts of Iron IV by Paradox Interactive.
          </p>
        </div>
      )}
      {overlay === "supply" && <SupplyScale />}
      {overlay === "unrest" && <UnrestScale />}
    </div>
  )
}

function SupplyScale() {
  return (
    <div className="border-t border-[#3d342b]/25 px-2.5 py-2" data-testid="overlay-scale">
      <p className="font-semibold text-[#3d342b]">Supply</p>
      <Ramp
        gradient="linear-gradient(to right, #7a2e2a 0%, #c6a15a 45%, #2d6a45 100%)"
        tickAt={30}
        marks={[
          { at: "left", label: "0", title: "Supply 0. Cut off from the depots" },
          { at: "30%", label: "30", title: "Supply 30. Below this, formations cannot advance" },
          { at: "right", label: "100", title: "Supply 100. Full supply" },
        ]}
      />
      <p className="mt-1 text-[10px] leading-snug text-[#5c5144]">
        Under 30 a province yields nothing and its formations cannot advance. Recruiting needs 60.
      </p>
    </div>
  )
}

function UnrestScale() {
  return (
    <div className="border-t border-[#3d342b]/25 px-2.5 py-2" data-testid="overlay-scale">
      <p className="font-semibold text-[#3d342b]">Unrest</p>
      <Ramp
        gradient="linear-gradient(to right, #3e5348 0%, #d4a24c 50%, #8e2430 100%)"
        tickAt={85}
        marks={[
          { at: "left", label: "0", title: "Unrest 0. Quiet" },
          { at: "85%", label: "85", title: "Unrest 85. Formations lose strength" },
          { at: "right", label: "100", title: "Unrest 100" },
        ]}
      />
      <p className="mt-1 text-[10px] leading-snug text-[#5c5144]">
        Quiet at 0. At 85, formations there lose strength.
      </p>
    </div>
  )
}

function Ramp({
  gradient,
  tickAt,
  marks,
}: {
  gradient: string
  tickAt: number
  marks: { at: "left" | "right" | `${number}%`; label: string; title: string }[]
}) {
  return (
    <div className="mt-1">
      <div className="relative h-2.5 rounded-sm border border-[#3d342b]/30" style={{ background: gradient }}>
        <span
          className="absolute top-0 h-full w-px bg-[#241c14]"
          style={{ left: `${tickAt}%` }}
          title={marks[1]?.title}
        />
      </div>
      <div className="relative mt-0.5 h-3.5 text-[10px] text-[#5c5144]">
        {marks.map((mark) => (
          <span
            key={mark.label}
            title={mark.title}
            className={`absolute top-0 ${mark.at === "left" ? "left-0" : mark.at === "right" ? "right-0" : "-translate-x-1/2"}`}
            style={mark.at.endsWith("%") ? { left: mark.at } : undefined}
          >
            {mark.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function RailSwatch({ color, broken = false }: { color: string; broken?: boolean }) {
  return (
    <svg width="28" height="10" viewBox="0 0 28 10" aria-hidden className="shrink-0">
      {broken ? (
        <line
          x1="1"
          y1="5"
          x2="27"
          y2="5"
          stroke={color}
          strokeWidth="1.6"
          strokeDasharray="3 2.5"
          strokeLinecap="butt"
        />
      ) : (
        <>
          <line x1="1" y1="5" x2="27" y2="5" stroke={RAIL_STYLE.tie} strokeWidth="5" strokeDasharray="1.2 3.2" />
          <line x1="1" y1="3.6" x2="27" y2="3.6" stroke={color} strokeWidth="1" />
          <line x1="1" y1="6.4" x2="27" y2="6.4" stroke={color} strokeWidth="1" />
        </>
      )}
    </svg>
  )
}
