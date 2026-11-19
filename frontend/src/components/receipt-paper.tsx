"use client"

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { SimpleSelect } from "@/components/common"
import { Label } from "@/components/ui/label"
import { msg, t } from "@/lib/i18n"

/**
 * The till-printer slip, and the two settings that make it come out right on this
 * counter's printer.
 *
 * A thermal printer never prints the whole width of its roll. An 80mm printer prints a
 * strip about 72mm wide down the middle, a 58mm one about 48mm. The slip is laid out at
 * exactly that printable width and the page is set to exactly that size, so the driver has
 * nothing to shrink to fit and nothing to shift sideways: the slip lands centred on the roll
 * at its real size. Laying it out at the full roll width instead, with margins of its own,
 * is what made it print off-centre and at the wrong size.
 */

export const SLIP_PRINTERS = [
  { id: "80", label: msg("80 mm roll"), printable: 72 },
  { id: "58", label: msg("58 mm roll"), printable: 48 },
] as const

/** Base type size in px; every size on the slip is set relative to it. */
export const SLIP_TEXT = [
  { id: "small", label: msg("Small"), px: 11 },
  { id: "normal", label: msg("Normal"), px: 12.5 },
  { id: "large", label: msg("Large"), px: 14 },
] as const

const PX_PER_MM = 96 / 25.4
const EVENT = "slip-settings-change"
const fallback: Record<string, string> = {}

/** A per-device setting: the printer belongs to this counter, not to the business. */
function useDeviceSetting(key: string, initial: string) {
  const value = useSyncExternalStore(
    (onChange) => {
      window.addEventListener(EVENT, onChange)
      window.addEventListener("storage", onChange)
      return () => {
        window.removeEventListener(EVENT, onChange)
        window.removeEventListener("storage", onChange)
      }
    },
    () => {
      try {
        return localStorage.getItem(key) ?? fallback[key] ?? initial
      } catch {
        return fallback[key] ?? initial
      }
    },
    // The server can't know this counter's printer; it draws the default and the browser
    // switches after hydration.
    () => initial,
  )
  const set = (next: string) => {
    try {
      localStorage.setItem(key, next)
    } catch {
      fallback[key] = next
    }
    window.dispatchEvent(new Event(EVENT))
  }
  return [value, set] as const
}

export function useSlipSettings() {
  const [printer, setPrinter] = useDeviceSetting("slip-printer", "80")
  const [text, setText] = useDeviceSetting("slip-text", "normal")
  return {
    printer: SLIP_PRINTERS.find((p) => p.id === printer) ?? SLIP_PRINTERS[0],
    text: SLIP_TEXT.find((s) => s.id === text) ?? SLIP_TEXT[1],
    setPrinter,
    setText,
  }
}

/** The two choices, for the receipt page: which roll, and how big the writing is. */
export function SlipSettings() {
  const { printer, text, setPrinter, setText } = useSlipSettings()
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="slip-printer" className="text-xs text-muted-foreground">
          {t("Slip printer")}
        </Label>
        <SimpleSelect
          id="slip-printer"
          value={printer.id}
          onChange={setPrinter}
          options={SLIP_PRINTERS.map((p) => ({ value: p.id, label: p.label }))}
          className="h-8 w-36"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="slip-text" className="text-xs text-muted-foreground">
          {t("Text size")}
        </Label>
        <SimpleSelect
          id="slip-text"
          value={text.id}
          onChange={setText}
          options={SLIP_TEXT.map((s) => ({ value: s.id, label: s.label }))}
          className="h-8 w-32"
        />
      </div>
    </div>
  )
}

/**
 * Holds the slip.
 *
 * Off screen it is laid out at its printed width, so its height can be measured and the
 * printed page sized to exactly that: one strip of paper, no blank tail feeding out of the
 * printer. Solid black on white, because thermal printers turn grey into speckles.
 *
 * It lives directly in `<body>` (a portal) so that, while it is the thing being printed,
 * everything else can be taken out of the layout entirely — merely hiding the rest of the
 * app would still leave its height on the page, and a roll printer would feed it as blank
 * paper.
 */
export function ReceiptPaper({ children, active = true }: { children: React.ReactNode; active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [heightMm, setHeightMm] = useState(200)
  const [mounted, setMounted] = useState(false)
  const { printer, text } = useSlipSettings()

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the portal target only exists in the browser
    setMounted(true)
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setHeightMm(Math.ceil(el.offsetHeight / PX_PER_MM) + 2)
    measure()
    // Re-measured as the data lands, so a rental with twelve lines still gets a page the
    // right length.
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [mounted])

  if (!mounted) return null

  return createPortal(
    <>
      {active && (
        <style>{`
@page { size: ${printer.printable}mm ${heightMm}mm; margin: 0; }
@media print {
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; min-height: 0 !important; height: auto !important; }
  body > *:not(.receipt-paper) { display: none !important; }
  body > .receipt-paper { position: static !important; left: 0 !important; }
}`}</style>
      )}
      <div
        ref={ref}
        aria-hidden
        style={{ width: `${printer.printable}mm`, fontSize: `${text.px}px` }}
        className={`receipt-paper pointer-events-none fixed top-0 -left-[10000px] bg-white px-[1mm] py-[2mm] font-sans leading-snug font-medium text-black ${
          active ? "" : "print:hidden"
        }`}
      >
        {children}
      </div>
    </>,
    document.body,
  )
}
