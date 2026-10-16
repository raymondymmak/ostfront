import type { Metadata } from "next"
import { Fraunces, Source_Sans_3 } from "next/font/google"
import "./globals.css"

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-source",
})

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-display",
})

export const metadata: Metadata = {
  title: "Ostfront 1915",
  description:
    "A map-first World War I operational game. The map is the rules; the game master only narrates.",
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
