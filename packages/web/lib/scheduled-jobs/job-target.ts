import { NEW_REPOSITORY } from "@/lib/types"

/** The fields that say where and how a job runs, as sent to the API. */
export interface JobTargetFields {
  repo?: string
  baseBranch?: string
  agent?: string
  model?: string | null
}

/**
 * Which of repo / branch / agent / model the client should send.
 *
 * A workspace owns all four, and the API prefers an explicit value over the
 * workspace's. So sending them is not redundant, it is an override — and the
 * form's own defaults are `main` and `opencode`, which is how a job created
 * inside a workspace ended up running the wrong harness against a branch
 * nobody chose. Inside a workspace the answer is to send nothing and let the
 * server denormalise.
 *
 * Outside one, an empty repo means repo-less, which the API recognises by a
 * sentinel rather than by absence.
 */
export function jobTargetFields(input: {
  inWorkspace: boolean
  repo: string
  baseBranch: string
  agent: string
  model: string
}): JobTargetFields {
  if (input.inWorkspace) return {}
  return {
    repo: input.repo || NEW_REPOSITORY,
    baseBranch: input.baseBranch || "main",
    agent: input.agent,
    model: input.model || null,
  }
}
