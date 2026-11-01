"use client"

import { useLayoutEffect, useRef, useState } from "react"

/** Till roll width. Most counter printers take 80mm rolls; 58mm ones print about 48mm wide. */
export const RECEIPT_PAPER_MM = 80

const PX_PER_MM = 96 / 25.4

/**
 * Holds the till-roll copy of a receipt.
 *
 * Off screen it is laid out at its printed width, so its height can be measured and the
 * printed page sized to exactly that: one strip of paper, no A4 sheet and no blank tail
 * feeding out of the printer. Solid black on white, because thermal printers turn grey
 * into speckles.
 *
 * Printing hides the rest of the app (see `globals.css`), so this can live on a page that
 * also shows the screen copy.
 */
export function ReceiptPaper({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [heightMm, setHeightMm] = useState(200)

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
  }, [])

  return (
    <>
      <style>{`@page { size: ${RECEIPT_PAPER_MM}mm ${heightMm}mm; margin: 0 } @media print { html, body { background: #fff !important } }`}</style>
      <div
        ref={ref}
        aria-hidden
        style={{ width: `${RECEIPT_PAPER_MM}mm` }}
        className="receipt-paper pointer-events-none fixed top-0 -left-[10000px] bg-white px-[4mm] py-[3mm] font-sans text-[12px] leading-snug font-medium text-black print:pointer-events-auto print:static"
      >
        {children}
      </div>
    </>
  )
}
