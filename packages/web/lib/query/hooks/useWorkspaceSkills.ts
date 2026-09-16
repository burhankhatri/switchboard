"use client"

import { useQuery } from "@tanstack/react-query"
import type { SkillSummary } from "@/lib/workspace-skills"

export interface WorkspaceSkillsResponse {
  skills: SkillSummary[]
}

export const workspaceSkillsKey = (workspaceId: string | undefined) =>
  ["workspace-skills", workspaceId] as const

/**
 * What this workspace teaches its agent.
 *
 * Its own slot rather than a selector over the file list: adding a skill
 * invalidates this, and the descriptions come from reads the file listing does
 * not do.
 */
export function useWorkspaceSkills(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceSkillsKey(workspaceId),
    queryFn: async (): Promise<WorkspaceSkillsResponse> => {
      const res = await fetch(`/api/workspaces/${workspaceId}/skills`)
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText)
      }
      return res.json()
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
    retry: false,
  })
}
