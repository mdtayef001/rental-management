"use client"

import { flushSync } from "react-dom"
import { Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The sheet every printed document is drawn on: receipts, bills and reports.
 *
 * One look for everything the shop hands over or files. It is always black on white,
 * whatever theme the app is in, because it is a piece of paper: it should look on screen
 * exactly like what comes out of the printer. Printing hides the rest of the page (see
 * `globals.css`), sets the sheet to A4, and keeps each `.bill-block` in one piece.
 *
 * Everything on it is divided by ruled lines rather than by grey panels. A browser leaves
 * background colours off the paper unless told otherwise, so a layout held together by
 * tints falls apart in the printer; lines are ink, and always print. The one colour, a
 * deep teal, is dark enough to stay readable on a black-and-white printer too.
 */
export function Paper({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <article
      className={cn(
        "bill-paper rounded-xl border border-neutral-300 bg-white p-5 text-[13px] leading-snug text-black shadow-sm sm:p-8",
        className,
      )}
    >
      {children}
    </article>
  )
}

/** The page size for a sheet. Rendered once by whichever document is being printed. */
export function SheetPage() {
  return <style>{`@page { size: A4; margin: 12mm } @media print { html, body { background: #fff !important } }`}</style>
}

/**
 * The top of a sheet: who it is from on the left, what it is on the right.
 *
 * The logo, when the business has uploaded one, sits above its name. It is a plain `<img>`
 * on purpose: it prints, and it needs none of the resizing a product photo would.
 */
export function PaperHeader({
  business,
  logo,
  title,
  children,
}: {
  business: { name: string; address?: string; phone?: string; branch?: string }
  logo?: string | null
  title: string
  /** The lines under the title: the number, the period, the date. */
  children?: React.ReactNode
}) {
  return (
    <header className="flex flex-col gap-4 border-b-2 border-(--sheet-accent) pb-4 sm:flex-row sm:items-start sm:justify-between print:flex-row print:items-start print:justify-between">
      <div className="min-w-0">
        {logo && (
          // eslint-disable-next-line @next/next/no-img-element -- must print, and is already small
          <img src={logo} alt="" className="mb-2 max-h-16 max-w-52 object-contain object-left" />
        )}
        <p className="font-heading text-xl font-bold [overflow-wrap:anywhere]">{business.name}</p>
        {business.branch && <p className="text-neutral-800">{business.branch}</p>}
        {business.address && <p className="text-neutral-800">{business.address}</p>}
        {business.phone && <p className="text-neutral-800">{business.phone}</p>}
      </div>
      <div className="shrink-0 sm:text-right print:text-right">
        <p className="font-heading text-lg font-bold tracking-wide text-(--sheet-accent) uppercase">{title}</p>
        {children}
      </div>
    </header>
  )
}

/**
 * Boxes side by side under the header: who it is for, and the figure that matters.
 *
 * Ruled like a table. The frame draws the top and left edges and every box its own right
 * and bottom, so the lines meet whether the boxes sit in a row or stack on a phone.
 */
export function PaperBoxes({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        "mt-5 grid border-t border-l border-(--sheet-line) sm:grid-cols-[1.4fr_1fr] print:grid-cols-[1.4fr_1fr]",
        className,
      )}
    >
      {children}
    </section>
  )
}

export function PaperBox({ children, tint }: { children: React.ReactNode; tint?: boolean }) {
  return (
    <div className={cn("border-r border-b border-(--sheet-line) p-3", tint ? "bg-(--sheet-tint)" : "bg-white")}>
      {children}
    </div>
  )
}

export function Caption({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-[0.82em] font-bold tracking-wide text-(--sheet-accent) uppercase ${className}`}>{children}</p>
  )
}

/** A ruled box of sums: one `Sum` per line and, usually, a `SumTotal` to close it. */
export function Sums({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dl className={cn("border border-(--sheet-line)", className)}>{children}</dl>
}

/** One line of a sum at the foot of a sheet. */
export function Sum({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-(--sheet-rule) px-2.5 py-1.5 last:border-b-0">
      <dt>{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}

/** The last line of a sum: the figure the sheet exists to state. */
export function SumTotal({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-(--sheet-line) bg-(--sheet-tint) px-2.5 py-2 font-bold">
      <dt>{label}</dt>
      <dd className="text-[1.15em] tabular-nums">{value}</dd>
    </div>
  )
}

/** Room to sign by hand: the customer on the left, the shop on the right. */
export function Signatures({ left, leftName, businessName }: { left: string; leftName: string; businessName: string }) {
  return (
    <section className="bill-block mt-16 grid grid-cols-2 gap-10 text-[0.9em] sm:gap-24 print:gap-24">
      <div className="border-t border-black pt-1.5">
        <p className="text-neutral-800">{left}</p>
        <p className="font-semibold [overflow-wrap:anywhere]">{leftName}</p>
      </div>
      <div className="border-t border-black pt-1.5 text-right">
        <p className="text-neutral-800">Authorised signature</p>
        <p className="font-semibold [overflow-wrap:anywhere]">For {businessName}</p>
      </div>
    </section>
  )
}

/**
 * Prints the sheet on the page.
 *
 * `window.print()` with a print stylesheet rather than a generated file: the printer is
 * already set up in the browser, and the sheet stays one piece of DOM that is always in
 * step with the data on screen. `before` runs first and is flushed to the page before the
 * print dialog opens, for a screen that has to switch which copy is on paper.
 */
export function PrintButton({
  label = "Print",
  variant = "outline",
  size,
  before,
}: {
  label?: string
  variant?: "outline" | "default" | "ghost"
  size?: "sm"
  before?: () => void
}) {
  return (
    <Button
      variant={variant}
      size={size}
      onClick={() => {
        if (before) flushSync(before)
        window.print()
      }}
    >
      <Printer className="size-4" />
      {label}
    </Button>
  )
}

/**
 * Waits until every picture inside an element has loaded, then resolves.
 *
 * Used before printing a sheet that was only just put on the page, so the logo is on the
 * paper rather than an empty space where it was still downloading.
 */
export async function imagesReady(root: HTMLElement | null) {
  if (!root) return
  await Promise.all(
    Array.from(root.querySelectorAll("img")).map((img) =>
      img.complete ? Promise.resolve() : new Promise<void>((done) => (img.onload = img.onerror = () => done())),
    ),
  )
}
