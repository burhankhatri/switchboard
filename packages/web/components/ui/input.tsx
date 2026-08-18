import * as React from "react"
import { cn } from "@/lib/utils"

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "flex h-8 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm shadow-[inset_0_0_0_1px_transparent] transition-colors",
          "placeholder:text-muted-foreground/60",
          "focus:outline-none focus:border-primary/60 focus:shadow-[inset_0_0_0_1px_rgba(0,0,0,0)] focus:ring-2 focus:ring-ring/40",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          className
        )}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"
