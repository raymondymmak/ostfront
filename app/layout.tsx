import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import "./globals.css"

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0d1e3d",
}

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
  applicationName: "Ostfront",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Ostfront",
    statusBarStyle: "black-translucent",
  },
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`dark ${sourceSans.variable} ${fraunces.variable} h-dvh antialiased`}
    >
      <body className="h-dvh overscroll-none bg-background text-foreground">
        {children}
      </body>
    </html>
  )
}
