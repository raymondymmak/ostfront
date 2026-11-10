"use client"

import dynamic from "next/dynamic"

const TeachingApp = dynamic(
  () => import("@/components/teaching-app").then((mod) => mod.TeachingApp),
  {
    ssr: false,
    loading: () => (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 text-center">
        <p className="font-display text-2xl">Teaching drill</p>
        <p className="mt-2 text-sm text-muted-foreground">Loading converging-attacks lesson…</p>
      </main>
    ),
  },
)

export default function TeachPage() {
  return <TeachingApp />
}
