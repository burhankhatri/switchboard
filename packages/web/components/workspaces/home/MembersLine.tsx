"use client"

import { Users } from "lucide-react"

export function MembersLine({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <section className="mt-8 flex items-center gap-2 text-[12px] text-ink-3">
      <Users className="h-3.5 w-3.5 shrink-0" />
      <span>
        {count === 1
          ? "Just you so far — add teammates by GitHub username."
          : `${count} people share this workspace.`}
      </span>
    </section>
  )
}
