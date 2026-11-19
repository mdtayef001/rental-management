import type { Metadata, Viewport } from "next"
import { Archivo, IBM_Plex_Mono, Noto_Sans_Bengali } from "next/font/google"
import { Providers } from "@/components/providers"
import { getRequestLang, getT } from "@/lib/i18n/server"
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

// Bangla, for when the app is switched to বাংলা. Archivo is listed first everywhere, so this
// only ever draws the Bangla letters; Latin text, digits and codes stay in Archivo.
const bangla = Noto_Sans_Bengali({
  variable: "--font-bangla",
  subsets: ["bengali"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
})

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT()
  return {
    title: { default: t("Rental Manager"), template: `%s · ${t("Rental Manager")}` },
    description: t("Rent out stock, take it back by scanning, and keep the books straight."),
    appleWebApp: { capable: true, statusBarStyle: "default", title: "Rental Manager" },
    // iOS ignores the manifest's icons and uses this for "Add to Home Screen".
    icons: { apple: "/icons/apple-touch-icon.png" },
    robots: { index: false, follow: false },
  }
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Scanning happens one-handed on a phone, so don't lock zoom away from people who need it.
  maximumScale: 5,
  // The window's title bar when installed, and the phone's browser bar, follow the theme's
  // background so the chrome blends into the page.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1015" },
  ],
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const lang = await getRequestLang()
  return (
    <html
      lang={lang}
      className={`${archivo.variable} ${plexMono.variable} ${bangla.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <Providers lang={lang}>{children}</Providers>
      </body>
    </html>
  )
}
