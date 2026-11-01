"use client"

import { useState } from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "next-themes"
import { Toaster } from "@/components/ui/sonner"
import { getQueryClient } from "@/lib/data/query-client"

export function Providers({ children }: { children: React.ReactNode }) {
  // `useState` so the client is made once per browser session and never recreated by a
  // re-render, which would throw away every cached page mid-use.
  const [client] = useState(getQueryClient)
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        {children}
        <Toaster position="top-center" richColors closeButton />
      </ThemeProvider>
    </QueryClientProvider>
  )
}
