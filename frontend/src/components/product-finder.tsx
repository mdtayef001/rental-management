"use client"

import { useState } from "react"
import { Camera, CameraOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/common"
import { CameraScanner, CodeInput } from "@/components/scanner"
import { useProductSearch } from "@/lib/data/queries"
import { count } from "@/lib/format"
import type { ProductLookup } from "@/lib/types"

/**
 * One box for finding a product, however the person at the counter has it.
 *
 * A scanner (or the camera) sends a whole code and Enter, which goes to `onCode` and is
 * looked up exactly. Someone who only knows the name types part of it and picks from the
 * list underneath, which goes to `onPick`. Both live in the same field so nobody has to
 * choose a mode first.
 */
export function ProductFinder({
  onCode,
  onPick,
  busy,
  autoFocus,
  rentableOnly = true,
  compact = false,
  placeholder = compact ? "Name, SKU or scan" : "Scan a QR / barcode, or type a name or SKU",
}: {
  onCode: (code: string) => void
  onPick: (product: ProductLookup) => void
  busy?: boolean
  autoFocus?: boolean
  rentableOnly?: boolean
  /** In a narrow column: the camera button drops its label so the field keeps its width. */
  compact?: boolean
  placeholder?: string
}) {
  const [text, setText] = useState("")
  const [camera, setCamera] = useState(false)
  const typed = text.trim()
  // From the first letter: at a counter, two keys and a tap beats typing a whole name.
  const searching = typed.length > 0
  const matches = useProductSearch(typed, { rentableOnly, enabled: searching })
  const results = searching ? (matches.data ?? []).slice(0, 6) : []

  return (
    <div className="space-y-3">
      <CodeInput
        value={text}
        onChange={setText}
        onSubmit={(code) => {
          // Enter with exactly one name match means "that one" — the usual case when
          // someone types "sewing" and there is one sewing machine.
          const only = results.length === 1 ? results[0] : null
          const exact = results.find((p) => [p.sku, p.barcode].includes(code))
          if (exact || !only) onCode(code)
          else onPick(only)
        }}
        busy={busy}
        placeholder={placeholder}
        autoFocus={autoFocus}
      >
        <Button
          type="button"
          variant="outline"
          onClick={() => setCamera((on) => !on)}
          aria-pressed={camera}
          aria-label={camera ? "Close camera" : "Scan with the camera"}
          className="h-11 shrink-0"
        >
          {camera ? <CameraOff className="size-4" /> : <Camera className="size-4" />}
          {!compact && <span className="hidden sm:inline">{camera ? "Close camera" : "Camera"}</span>}
        </Button>
      </CodeInput>

      {searching &&
        (results.length > 0 ? (
          <ul className="divide-y overflow-hidden rounded-lg border bg-card" aria-label="Matching products">
            {results.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  onClick={() => {
                    setText("")
                    onPick(product)
                  }}
                  className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{product.name}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">{product.sku}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {count(product.onHand)} on the shelf
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : matches.isFetching ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Searching…
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing is called “{typed}”. Press Enter to look it up as a code.
          </p>
        ))}

      {camera && (
        <div className="max-w-sm">
          <CameraScanner
            onDetected={(code) => {
              if (!busy) onCode(code)
            }}
          />
        </div>
      )}
    </div>
  )
}
