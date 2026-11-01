import Link from "next/link"
import { Button } from "@/components/ui/button"

/**
 * A button that navigates.
 *
 * Base UI composes through `render` rather than `asChild`, and spelling that out at every
 * call site is noise. This keeps the pages reading as `<ButtonLink href="/scan">Scan</ButtonLink>`
 * while still rendering a real anchor, so middle-click, copy-link and prefetch all work.
 */
export function ButtonLink({
  href,
  children,
  prefetch,
  ...props
}: React.ComponentProps<typeof Button> & { href: string; prefetch?: boolean }) {
  return (
    <Button {...props} render={<Link href={href} prefetch={prefetch} />}>
      {children}
    </Button>
  )
}
