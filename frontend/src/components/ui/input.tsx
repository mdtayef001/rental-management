import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"

/** How many decimal places a number field keeps: none when it steps in whole units, else two. */
function places(step: React.ComponentProps<"input">["step"]) {
  return Number(step) >= 1 && Number.isInteger(Number(step)) ? 0 : 2
}

function Input({ className, type, value, onChange, ...props }: React.ComponentProps<"input">) {
  // Every number in the app is money or a count, so a number field never holds more than
  // two decimal places: what is typed is cut there, and a figure worked out elsewhere
  // (a "Full" button filling in 33.333333) is rounded on its way in.
  const numeric = type === "number"
  const keep = places(props.step)
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      value={numeric && typeof value === "number" ? Number(value.toFixed(keep)) : value}
      onChange={
        numeric && onChange
          ? (e) => {
              const [whole, decimals = ""] = e.currentTarget.value.split(".")
              if (decimals.length > keep) e.currentTarget.value = keep ? `${whole}.${decimals.slice(0, keep)}` : whole
              onChange(e)
            }
          : onChange
      }
      {...props}
    />
  )
}

export { Input }
