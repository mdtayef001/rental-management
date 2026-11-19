"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { QRCodeSVG } from "qrcode.react"
import { Minus, Plus, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SimpleSelect } from "@/components/common"
import { code128Bars, encodable } from "@/lib/code128"
import { t } from "@/lib/i18n"

/**
 * The sticker that goes on a machine.
 *
 * Printed on a thermal label printer (Xprinter, TSC, Zebra and the like), one label per
 * page, at the label's real size in millimetres — so the printer driver feeds exactly one
 * label each time and nothing is scaled. Pure black on white: thermal heads print grey as
 * speckles, and speckles don't scan.
 *
 * Each label carries both codes, because both kinds of scanner turn up at a counter: the
 * QR for the phone camera, the Code 128 barcode for a USB laser scanner. Either one finds
 * the product on Rent out, Take back and Scan.
 */

export interface LabelSize {
  id: string
  width: number
  height: number
}

/** The rolls label printers in Bangladesh are usually sold with, commonest first. */
export const LABEL_SIZES: LabelSize[] = [
  { id: "50x30", width: 50, height: 30 },
  { id: "40x30", width: 40, height: 30 },
  { id: "60x40", width: 60, height: 40 },
  { id: "70x50", width: 70, height: 50 },
  { id: "100x50", width: 100, height: 50 },
]

const SIZE_KEY = "label-size"
/** Blank modules either side of the bars, as Code 128 asks for. */
const QUIET = 10
const SIZE_EVENT = "label-size-change"
/** Where the choice lives when the browser won't store it. */
let fallbackSize: string | null = null

function readSize() {
  try {
    return localStorage.getItem(SIZE_KEY) ?? fallbackSize ?? LABEL_SIZES[0].id
  } catch {
    return fallbackSize ?? LABEL_SIZES[0].id
  }
}

function subscribeSize(onChange: () => void) {
  window.addEventListener(SIZE_EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(SIZE_EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}
const MAX_COPIES = 500

interface LabelProduct {
  name: string
  sku: string
  barcode: string
}

/**
 * The print rules, shipped with the labels rather than in globals.css, so label printing
 * never depends on the global stylesheet being current.
 *
 * Everything else on the page is taken out of the layout, not just hidden, so a roll
 * printer feeds exactly one label per copy and no blank ones after. Each label is its own
 * page at the label's size. On screen the labels never show: they exist only while the
 * print dialog is open.
 */
function labelPrintCss(size: LabelSize) {
  return `
@media screen { .label-paper { display: none !important; } }
@page { size: ${size.width}mm ${size.height}mm; margin: 0; }
@media print {
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; min-height: 0 !important; height: auto !important; }
  body > *:not(.label-paper) { display: none !important; }
  body > .label-paper { display: block !important; position: static !important; }
  .label-paper, .label-paper * { visibility: visible !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .label-sheet { overflow: hidden; break-after: page; break-inside: avoid; }
  .label-sheet:last-child { break-after: auto; }
}`
}

/** What the bars say: the maker's barcode when it can be drawn, else the SKU. */
function barcodeText(product: LabelProduct) {
  return product.barcode && encodable(product.barcode) ? product.barcode : product.sku
}

/** One label at its printed size. */
export function ProductLabel({ product, size }: { product: LabelProduct; size: LabelSize }) {
  const pad = 1.5
  const inner = { width: size.width - pad * 2, height: size.height - pad * 2 }
  // The barcode takes the bottom 38% — bars under about 7mm tall are hard for a laser
  // scanner to hit — and the QR is as tall as what is left, and square.
  const barHeight = Math.max(8, Math.round(inner.height * 0.38))
  const textUnder = 2.6
  const qr = Math.min(inner.height - barHeight - textUnder - 1, inner.width * 0.45)
  const code = barcodeText(product)
  const bars = encodable(code) ? code128Bars(code) : null
  // Type scales with the label, within what a 203 dpi head still prints cleanly.
  const nameSize = Math.min(3.4, Math.max(2.4, size.height / 10))

  return (
    <div
      className="label-sheet flex flex-col bg-white text-black"
      style={{ width: `${size.width}mm`, height: `${size.height}mm`, padding: `${pad}mm` }}
    >
      <div className="flex min-h-0 flex-1 items-center" style={{ gap: "1.5mm" }}>
        <QRCodeSVG
          value={`sku:${product.sku}`}
          level="M"
          marginSize={0}
          bgColor="#ffffff"
          fgColor="#000000"
          style={{ width: `${qr}mm`, height: `${qr}mm`, flexShrink: 0 }}
        />
        <div className="min-w-0 flex-1 leading-tight">
          <div
            className="font-bold [overflow-wrap:anywhere]"
            style={{
              fontSize: `${nameSize}mm`,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {product.name}
          </div>
          <div className="font-mono font-bold" style={{ fontSize: `${nameSize * 0.8}mm`, marginTop: "0.6mm" }}>
            {product.sku}
          </div>
        </div>
      </div>
      {bars && (
        <div style={{ marginTop: "1mm" }}>
          {/* The viewBox runs 10 modules past the bars on each side: the white "quiet zone"
              a scanner needs to find where the code starts and stops. */}
          <svg
            viewBox={`${-QUIET} 0 ${bars.width + QUIET * 2} 10`}
            preserveAspectRatio="none"
            shapeRendering="crispEdges"
            style={{ display: "block", width: "100%", height: `${barHeight - textUnder}mm` }}
            role="img"
            aria-label={code}
          >
            {bars.bars.map(([x, w]) => (
              <rect key={x} x={x} y={0} width={w} height={10} fill="#000" />
            ))}
          </svg>
          <div className="text-center font-mono font-bold" style={{ fontSize: `${textUnder * 0.85}mm`, lineHeight: `${textUnder}mm` }}>
            {code}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The Label card on a product's page: pick the roll, say how many, print.
 *
 * Counted stock means 40 sewing machines share one product, and every one of them needs its
 * own sticker — so the copies box is the point, not an extra.
 */
export function LabelPrinter({ product }: { product: LabelProduct }) {
  // Read after hydration: the server can't know which roll this counter's printer has,
  // and reading it during the first render would draw a different label than the server did.
  const sizeId = useSyncExternalStore(subscribeSize, readSize, () => LABEL_SIZES[0].id)
  const [copies, setCopies] = useState(1)
  const [printing, setPrinting] = useState(false)
  const size = LABEL_SIZES.find((s) => s.id === sizeId) ?? LABEL_SIZES[0]

  function chooseSize(id: string) {
    // The printer belongs to this counter, so the roll in it is remembered on this device.
    try {
      localStorage.setItem(SIZE_KEY, id)
    } catch {
      // Private window or storage blocked: it just won't be remembered.
      fallbackSize = id
    }
    window.dispatchEvent(new Event(SIZE_EVENT))
  }

  useEffect(() => {
    if (!printing) return
    const done = () => setPrinting(false)
    window.addEventListener("afterprint", done)
    // One frame, so the labels and the page size are in the document before the dialog opens.
    const frame = requestAnimationFrame(() => window.print())
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("afterprint", done)
    }
  }, [printing])

  const preview = Math.min(1, 240 / ((size.width * 96) / 25.4))

  return (
    <div className="space-y-3">
      {/* The preview at the label's own proportions, scaled to fit the card. */}
      <div className="flex justify-center rounded-md bg-muted/50 p-3">
        <div
          className="overflow-hidden rounded-sm shadow-sm ring-1 ring-black/10"
          style={{ width: `${size.width * preview}mm`, height: `${size.height * preview}mm` }}
        >
          <div style={{ transform: `scale(${preview})`, transformOrigin: "top left" }}>
            <ProductLabel product={product} size={size} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="label-size">{t("Label size")}</Label>
          <SimpleSelect
            id="label-size"
            value={size.id}
            onChange={chooseSize}
            options={LABEL_SIZES.map((s) => ({ value: s.id, label: `${s.width} × ${s.height} mm` }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="label-copies">{t("How many")}</Label>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t("One fewer")}
              onClick={() => setCopies((n) => Math.max(1, n - 1))}
            >
              <Minus className="size-4" />
            </Button>
            <Input
              id="label-copies"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_COPIES}
              value={copies}
              onChange={(e) => setCopies(Math.min(MAX_COPIES, Math.max(1, Math.floor(Number(e.target.value) || 1))))}
              className="h-8 text-center tabular-nums"
            />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t("One more")}
              onClick={() => setCopies((n) => Math.min(MAX_COPIES, n + 1))}
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <Button variant="outline" className="w-full" onClick={() => setPrinting(true)} disabled={printing}>
        <Printer className="size-4" />
        {copies === 1 ? t("Print label") : t("Print {count} labels", { count: copies })}
      </Button>
      <p className="text-xs text-muted-foreground">
        {t("In the print dialog, pick the label printer and set margins to None. The size is already set.")}
      </p>

      {printing &&
        createPortal(
          <div className="label-paper">
            <style>{labelPrintCss(size)}</style>
            {Array.from({ length: copies }, (_, i) => (
              <ProductLabel key={i} product={product} size={size} />
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
