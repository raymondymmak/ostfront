import type { Metadata } from "next"
import localFont from "next/font/local"
import "./globals.css"

const sourceSans = localFont({
  src: [
    { path: "../public/fonts/ui/source-sans-3-latin.woff2", weight: "400", style: "normal" },
    { path: "../public/fonts/ui/source-sans-3-latin-500.woff2", weight: "500", style: "normal" },
    { path: "../public/fonts/ui/source-sans-3-latin-600.woff2", weight: "600", style: "normal" },
    { path: "../public/fonts/ui/source-sans-3-latin-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-source",
  display: "swap",
})

const fraunces = localFont({
  src: [
    { path: "../public/fonts/ui/fraunces-latin.woff2", weight: "500", style: "normal" },
    { path: "../public/fonts/ui/fraunces-latin-italic.woff2", weight: "500", style: "italic" },
    { path: "../public/fonts/ui/fraunces-latin-600.woff2", weight: "600", style: "normal" },
    { path: "../public/fonts/ui/fraunces-latin-600-italic.woff2", weight: "600", style: "italic" },
    { path: "../public/fonts/ui/fraunces-latin-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Ostfront 1915",
  description:
    "Gorlice–Tarnów, 2 May 1915. A map-first World War I operational game. The map is the rules; the staff only narrates.",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`dark ${sourceSans.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground lg:h-full lg:overflow-hidden">
        {children}
      </body>
    </html>
  )
}
