"use client"

import { useState } from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "next-themes"
import { I18nProvider } from "@/components/i18n"
import { Toaster } from "@/components/ui/sonner"
import { getQueryClient } from "@/lib/data/query-client"
import type { Lang } from "@/lib/i18n"

export function Providers({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  // `useState` so the client is made once per browser session and never recreated by a
  // re-render, which would throw away every cached page mid-use.
  const [client] = useState(getQueryClient)
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        {/* Inside the theme: switching language remounts everything under the provider,
            and the theme's own inline script must not be drawn again on the client. */}
        <I18nProvider lang={lang}>
          {children}
          <Toaster position="top-center" richColors closeButton />
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
