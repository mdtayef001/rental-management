import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Providers } from "@/components/providers"
import "./globals.css"

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

export const metadata: Metadata = {
  title: { default: "Rental Manager", template: "%s · Rental Manager" },
  description: "Rent out stock, take it back by scanning, and keep the books straight.",
  // Staff open this on a phone at the counter; it should behave like an app.
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
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
