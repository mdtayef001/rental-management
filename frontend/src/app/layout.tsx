import type { Metadata, Viewport } from "next"
import { Archivo, IBM_Plex_Mono } from "next/font/google"
import { Providers } from "@/components/providers"
import "./globals.css"

// Archivo for everything in the interface: a grotesque with a tall x-height and slightly
// condensed caps, which holds up at 11px in a dense table and at 32px on a stat tile. This
// app is mostly numbers, so it is loaded with tabular figures switched on globally.
const archivo = Archivo({
  variable: "--font-sans",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
})

// Mono is reserved for machine codes — rental numbers, SKUs, barcodes. Those are strings
// people compare character by character against a printed label, so fixed advance widths
// are information, not decoration. It is never used for ordinary labels.
const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
})

export const metadata: Metadata = {
  title: { default: "Rental Manager", template: "%s · Rental Manager" },
  description: "Rent out stock, take it back by scanning, and keep the books straight.",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Rental Manager" },
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Scanning happens one-handed on a phone, so don't lock zoom away from people who need it.
  maximumScale: 5,
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${plexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
