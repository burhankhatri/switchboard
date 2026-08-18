"use client"

import { useEffect, useRef, useState } from "react"
import { Check, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useToastStore, type Toast } from "@/lib/stores/toast-store"
import { ROUTES } from "@/lib/hooks/useUrlNavigation"
import { cn } from "@/lib/utils"

/**
 * Notification for work that finished while you were elsewhere.
 *
 * Built on the app's own surface and ink scale rather than raw neutral-* greys,
 * so it belongs to this product instead of looking like a stock toast.
 *
 * The auto-dismiss is drawn rather than silent: a toast that vanishes on an
 * invisible timer reads as a glitch, and there is no way to tell whether you
 * have three seconds left or none. The bar answers that, and pausing it on
 * hover means reaching for a toast never loses it mid-reach.
 */
function ToastItem({ toast }: { toast: Toast }) {
  const removeToast = useToastStore((s) => s.removeToast)
  const router = useRouter()
  const [paused, setPaused] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const remaining = useRef(toast.durationMs ?? 0)
  const startedAt = useRef(Date.now())

  useEffect(() => {
    if (!toast.durationMs || paused) return
    startedAt.current = Date.now()
    const id = setTimeout(() => {
      // Play the exit before unmounting, so it leaves the way it arrived.
      setLeaving(true)
      setTimeout(() => removeToast(toast.id), 160)
    }, remaining.current)
    return () => {
      clearTimeout(id)
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current))
    }
  }, [toast.id, toast.durationMs, paused, removeToast])

  const dismiss = () => {
    setLeaving(true)
    setTimeout(() => removeToast(toast.id), 160)
  }

  const openChat = () => {
    if (!toast.chatId) return
    // The store has always carried a chatId described as "navigate to when the
    // toast is clicked", and nothing ever clicked it.
    router.push(ROUTES.chat.build(toast.chatId))
    dismiss()
  }

  return (
    <div
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={cn(
        "pointer-events-auto relative w-80 overflow-hidden rounded-[12px]",
        "border border-line bg-surface shadow-raised backdrop-blur-xl",
        toast.chatId && "cursor-pointer"
      )}
      style={{
        animation: leaving
          ? "toast-out 160ms ease-in both"
          : "toast-in 260ms var(--ease-spring) both",
      }}
      onClick={toast.chatId ? openChat : undefined}
    >
      <div className="flex items-start gap-2.5 p-3">
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-accent-tint">
          <Check className="h-2.5 w-2.5 text-accent-ink" strokeWidth={3} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-ink">{toast.title}</div>
          {toast.body && (
            <div className="mt-0.5 break-words text-[12px] leading-snug text-ink-2">
              {toast.body}
            </div>
          )}
          {toast.chatId && (
            <div className="mt-1 text-[11px] text-ink-3">Click to open</div>
          )}
        </div>

        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={(e) => {
            e.stopPropagation()
            dismiss()
          }}
          className="shrink-0 rounded-full p-1 text-ink-3 transition-colors hover:bg-hover hover:text-ink cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* How long is left, and that hovering holds it. */}
      {!!toast.durationMs && (
        <span
          aria-hidden
          className="absolute bottom-0 left-0 h-[2px] bg-accent-ink/50"
          style={{
            animation: `toast-timer ${toast.durationMs}ms linear both`,
            animationPlayState: paused ? "paused" : "running",
          }}
        />
      )}
    </div>
  )
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed top-4 right-4 z-[60] flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  )
}
