"use client"

import dynamic from "next/dynamic"

const GameApp = dynamic(
  () => import("@/components/game-app").then((mod) => mod.GameApp),
  {
    ssr: false,
    loading: () => (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-[#14110e] px-6 text-center text-[#ebe4d4]">
        <p className="font-serif text-4xl italic text-[#c6a15a]">Ostfront</p>
        <p className="mt-3 max-w-md text-sm text-[#b3a48f]">
          Opening the situation map for 4 June 1915. Przemyśl is back in Austrian hands. Lemberg is not.
        </p>
      </main>
    ),
  },
)

export default function Page() {
  return <GameApp />
}
