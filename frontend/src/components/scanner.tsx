"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Camera, CameraOff, Keyboard, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

type Html5QrcodeType = import("html5-qrcode").Html5Qrcode

/**
 * Camera scanner for QR codes and the usual retail barcodes.
 *
 * The library is a dynamic import, so its bundle only downloads when someone actually opens
 * a scanner — the rest of the app doesn't pay for it. The camera is released on unmount,
 * which matters on a phone where a held camera drains the battery and blocks other apps.
 */
export function CameraScanner({ onDetected, active = true }: { onDetected: (code: string) => void; active?: boolean }) {
  const regionId = "scanner-" + useId().replace(/:/g, "")
  const scannerRef = useRef<Html5QrcodeType | null>(null)
  const onDetectedRef = useRef(onDetected)
  const [status, setStatus] = useState<"starting" | "running" | "error">("starting")
  const [error, setError] = useState("")

  // Kept in a ref so a new callback doesn't tear down and restart the camera.
  useEffect(() => {
    onDetectedRef.current = onDetected
  }, [onDetected])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let lastCode = ""
    let lastAt = 0

    void (async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats: F } = await import("html5-qrcode")
        if (cancelled) return
        const scanner = new Html5Qrcode(regionId, {
          verbose: false,
          formatsToSupport: [
            F.QR_CODE,
            F.EAN_13,
            F.EAN_8,
            F.UPC_A,
            F.UPC_E,
            F.CODE_128,
            F.CODE_39,
            F.CODE_93,
            F.ITF,
            F.DATA_MATRIX,
          ],
        })
        scannerRef.current = scanner
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: (w, h) => ({ width: Math.floor(w * 0.8), height: Math.floor(Math.min(h * 0.6, w * 0.5)) }) },
          (text) => {
            // The same code stays in view for several frames; ignore repeats for a moment so
            // one scan doesn't add an item five times.
            const now = Date.now()
            if (text === lastCode && now - lastAt < 2500) return
            lastCode = text
            lastAt = now
            navigator.vibrate?.(60)
            onDetectedRef.current(text.trim())
          },
          undefined,
        )
        if (cancelled) await scanner.stop().catch(() => {})
        else setStatus("running")
      } catch (err) {
        if (cancelled) return
        setStatus("error")
        const message = err instanceof Error ? err.message : String(err)
        // Each failure gets the advice that actually helps, and every one of them ends with
        // "type the code instead", because the shop can't stop serving customers.
        setError(
          /permission|notallowed/i.test(message)
            ? "Camera permission was denied. Allow camera access in your browser settings, or type the code instead."
            : /notfound|no camera|requested device/i.test(message)
              ? "No camera was found on this device. Type the code, or use a USB scanner."
              : "The camera couldn't start. Check no other app is using it, or type the code instead.",
        )
      }
    })()

    return () => {
      cancelled = true
      const scanner = scannerRef.current
      scannerRef.current = null
      if (scanner?.isScanning) {
        scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => {})
      }
    }
  }, [active, regionId])

  return (
    <div className="relative overflow-hidden rounded-xl border bg-black">
      <div id={regionId} className="aspect-[4/3] w-full [&_video]:h-full! [&_video]:w-full! [&_video]:object-cover" />
      {status === "starting" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white/80">
          <Loader2 className="size-6 animate-spin" />
          Starting camera…
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted p-6 text-center text-sm text-muted-foreground">
          <CameraOff className="size-8" />
          {error}
        </div>
      )}
      {status === "running" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 text-center text-xs text-white">
          Point the camera at a barcode or QR code
        </div>
      )}
    </div>
  )
}

/**
 * Text box for typing a code, or for a USB / Bluetooth scanner.
 *
 * Hardware scanners work by "typing" the code and pressing Enter, so this input is all they
 * need — which is why it's always on screen next to the camera rather than hidden behind a
 * fallback. `autoFocus` puts the cursor here so a shop with a gun scanner never touches the
 * screen.
 */
export function CodeInput({
  onSubmit,
  placeholder = "Scan or type a barcode / SKU, then press Enter",
  autoFocus,
  busy,
}: {
  onSubmit: (code: string) => void
  placeholder?: string
  autoFocus?: boolean
  /** A lookup is in flight. The field stays usable — see below. */
  busy?: boolean
}) {
  const [value, setValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const code = value.trim()
        if (!code) return
        onSubmit(code)
        // Cleared straight away, so the next scan doesn't append to the last one.
        setValue("")
        // And focus is put back deliberately: a hardware scanner fires the next code
        // immediately, and anything that steals focus between scans drops items silently.
        inputRef.current?.focus()
      }}
    >
      <div className="relative flex-1">
        <Keyboard className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        {/* Never disabled while a lookup runs. Disabling an input blurs it, and a USB
            scanner typing the next code into nothing is a silently lost item. The field
            stays live; only the button waits. */}
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="h-11 pl-9 font-mono"
          autoFocus={autoFocus}
          inputMode="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label="Barcode or SKU"
        />
      </div>
      <Button type="submit" className="h-11" disabled={busy || !value.trim()}>
        Look up
      </Button>
    </form>
  )
}

/** A camera button that opens a scanner and hands back the first code it reads. */
export function ScanButton({
  onScan,
  label = "Scan",
  variant = "outline",
}: {
  onScan: (code: string) => void
  label?: string
  variant?: "outline" | "default" | "secondary"
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" variant={variant} onClick={() => setOpen(true)}>
        <Camera />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Scan a code</DialogTitle>
            <DialogDescription>Hold the barcode or QR code inside the frame.</DialogDescription>
          </DialogHeader>
          {/* Mounted only while open, so the camera is released when it closes. */}
          {open && (
            <CameraScanner
              onDetected={(code) => {
                setOpen(false)
                onScan(code)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
