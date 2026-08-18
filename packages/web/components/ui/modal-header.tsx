"use client"

import * as React from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Focus the chat prompt textarea. Used as onCloseAutoFocus for modals so the
 * user can keep typing after dismissing one.
 */
export function focusChatPrompt() {
  const el = document.querySelector<HTMLTextAreaElement>("[data-chat-prompt]")
  if (el) {
    setTimeout(() => el.focus(), 0)
  }
}

/**
 * Consistent modal header: title on the left, small close button in the
 * top-right, and a horizontal rule below the title that is inset from both
 * edges (doesn't span the full width).
 */
interface ModalHeaderProps {
  title: React.ReactNode
  /** Tailwind insets for the inset rule (defaults to mx-4). */
  ruleInset?: string
  className?: string
}

export function ModalHeader({
  title,
  ruleInset = "mx-4",
  className,
}: ModalHeaderProps) {
  return (
    <div className={className}>
      <div className="flex items-start justify-between gap-2 px-4 pt-3 pb-2">
        <Dialog.Title className="text-sm font-medium leading-6 flex items-center gap-2">
          {title}
        </Dialog.Title>
        <Dialog.Close
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors -mr-1"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </Dialog.Close>
      </div>
      <div className={cn("border-b border-border", ruleInset)} />
    </div>
  )
}
