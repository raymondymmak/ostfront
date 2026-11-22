"use client"

import { useEffect, useState } from "react"
import { DESKTOP_SHELL_MQ } from "@/lib/ui/table-windows"

/** True when the campaign uses the floating-window general's-table shell (Tailwind lg). */
export function useDesktopShell(): boolean {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(DESKTOP_SHELL_MQ).matches : false,
  )

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_SHELL_MQ)
    const sync = () => setDesktop(media.matches)
    sync()
    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  }, [])

  return desktop
}
