"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"

/**
 * Light and dark, as one icon button.
 *
 * Both icons are always rendered and CSS shows one, rather than branching on the theme in
 * JavaScript. The server cannot know which theme the browser will resolve to, so any
 * branch here is a guaranteed hydration mismatch; this way the markup is identical on both
 * sides and the right icon appears the moment the stylesheet applies.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Switch between light and dark mode"
    >
      <Moon className="size-4 dark:hidden" />
      <Sun className="hidden size-4 dark:block" />
    </Button>
  )
}
