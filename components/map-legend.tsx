"use client"

import { useEffect, useState } from "react"

export function MapLegend() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)")
    const sync = () => setOpen(media.matches)
    sync()
    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  }, [])

  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 z-20 max-w-[15rem] rounded-md bg-[#f6f1e4]/95 text-[11px] text-[#241c14] shadow-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left font-semibold text-[#3d342b]"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        Map legend
        <span className="text-[10px] font-normal text-[#5c5144]">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="border-t border-[#3d342b]/20 px-2.5 py-2">
          <div className="flex items-center gap-2">
            <span className="inline-block size-2.5 bg-[#4a6d90]" /> Central Powers
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="inline-block size-2.5 bg-[#a85b49]" /> Russia
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="inline-block size-2.5 bg-[#8a7d72]" /> Surrounding states
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="inline-block size-2.5 rotate-45 bg-[#8a6a32]" /> Depot
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
          <p className="mt-1 text-[#5c5144]">Zoom in for more city names. Baltic lies north.</p>
        </div>
      )}
    </div>
  )
}
