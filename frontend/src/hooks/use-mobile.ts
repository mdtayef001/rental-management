import * as React from "react"

const MOBILE_BREAKPOINT = 768

const query = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(query)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

/**
 * Whether this is a phone-width viewport, for the few places that must branch in
 * JavaScript rather than in CSS — chiefly the sidebar, which becomes a sheet.
 *
 * Read through `useSyncExternalStore` so React subscribes to the media query itself
 * instead of setting state from an effect after paint. The server has no viewport, so it
 * renders the desktop shape and the browser corrects it before the first paint.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}
