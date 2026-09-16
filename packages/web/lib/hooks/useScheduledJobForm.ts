"use client"

import { useState, useEffect, useMemo } from "react"
import { type ScheduledJob } from "@/lib/scheduled-jobs/types"
import { scheduleNameFromPrompt } from "@/lib/scheduled-jobs/prompt-name"
import { jobTargetFields } from "@/lib/scheduled-jobs/job-target"
import { agentModels, getAgentModels, type Agent, NEW_REPOSITORY } from "@/lib/types"
import { useSettingsQuery } from "@/lib/query/hooks/useSettingsQuery"
import { useWorkspace } from "@/lib/contexts/WorkspaceContext"
import {
  UNIT_MINUTES,
  inferIntervalMode,
  getTimezoneName,
  localHourToUtc,
  type IntervalUnit,
} from "@/components/scheduled-jobs/form-config"

interface UseScheduledJobFormArgs {
  open: boolean
  job?: ScheduledJob | null
  /**
   * Prompt to open a new job with, when the schedule is being made out of
   * something that already ran. Ignored when editing - an existing job's own
   * prompt is the thing being edited.
   */
  initialPrompt?: string | null
  onClose: () => void
  onSuccess: (job: ScheduledJob) => void
}

/**
 * All state, effects and side-effecting handlers for the Scheduled Job form.
 * Kept in one place so the component file is pure layout — change the wiring
 * here, change the markup there.
 */
export function useScheduledJobForm({ open, job, initialPrompt, onClose, onSuccess }: UseScheduledJobFormArgs) {
  const isEditing = !!job
  const { activeWorkspace } = useWorkspace()

  // A new job runs where the person is: the workspace they are looking at.
  // Editing keeps whatever the job was bound to, so opening an old job from
  // inside a different workspace cannot silently move it.
  const workspaceId = isEditing ? job?.workspaceId ?? null : activeWorkspace?.id ?? null

  /**
   * A workspace already decides the repo, the branch, the harness, the model
   * and the tools - that is what a workspace is. Asking again is not a second
   * opinion, it is a way to get a job that clones the wrong thing and runs
   * with none of the skills it was written against.
   */
  const inWorkspace = !!workspaceId

  // Form state
  const [name, setName] = useState(
    job?.name ?? (initialPrompt ? scheduleNameFromPrompt(initialPrompt) : "")
  )
  const [prompt, setPrompt] = useState(job?.prompt ?? initialPrompt ?? "")
  // Empty string means "no repo" in form state; on submit we send NEW_REPOSITORY.
  const [repo, setRepo] = useState(
    job?.repo && job.repo !== NEW_REPOSITORY ? job.repo : ""
  )
  const [baseBranch, setBaseBranch] = useState(job?.baseBranch ?? "main")
  const isRepoLess = !repo
  const [agent, setAgent] = useState<Agent>((job?.agent as Agent) ?? "opencode")
  const [model, setModel] = useState(job?.model ?? "")
  // Every job is a schedule. The API still takes a triggerType, and the
  // webhook receiver at /wh/<token> still exists for anything already wired
  // up, but nothing in this form can create one.
  const triggerType = "interval" as const
  const initialIntervalMode = inferIntervalMode(job?.intervalMinutes ?? 1440)
  const [intervalMinutes, setIntervalMinutes] = useState(initialIntervalMode.intervalMinutes)
  const [isCustomInterval, setIsCustomInterval] = useState(initialIntervalMode.isCustom)
  const [customIntervalValue, setCustomIntervalValue] = useState(initialIntervalMode.customValue)
  const [customIntervalUnit, setCustomIntervalUnit] = useState<IntervalUnit>(initialIntervalMode.customUnit)
  const [runAtHourLocal, setRunAtHourLocal] = useState(9) // Local time, default to 9 AM
  const [runAtDay, setRunAtDay] = useState(1) // Default to Monday
  const [autoPR, setAutoPR] = useState(job?.autoPR ?? true)
  const [continueFromLastRun, setContinueFromLastRun] = useState(job?.continueFromLastRun ?? false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // In create mode, the form may "materialize" the job into the DB the first
  // time the user clicks the MCP picker, so MCP server connections have a real
  // job id to hang off of. If the user then cancels, we DELETE the row so we
  // don't leave a half-configured job behind. On final submit this id is what
  // we PATCH (instead of POSTing again).
  // Materialized rows are created with enabled: false so the cron doesn't pick
  // them up before the user finishes; the final submit flips enabled back on.
  const [materializedJobId, setMaterializedJobId] = useState<string | null>(null)

  // Dropdown state
  const [showAgentDropdown, setShowAgentDropdown] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)


  // The user's custom endpoints, merged into the model list by name.
  const { data: settingsData } = useSettingsQuery()
  const customEndpoints = settingsData?.customEndpoints

  // Get available models for selected agent (built-ins + matching endpoints)
  const availableModels = getAgentModels(agent, customEndpoints)

  // Get timezone name for display
  const timezoneName = useMemo(() => getTimezoneName(), [])

  // What we actually send to the API (preset value, or custom value × unit).
  const effectiveIntervalMinutes = isCustomInterval
    ? Math.max(1, Math.floor(customIntervalValue || 0) * UNIT_MINUTES[customIntervalUnit])
    : intervalMinutes

  // Which Options-section toggles apply. The "continue" toggle is interval-only;
  // auto-PR needs a repo to push to. The section header renders only when at
  // least one applies — these same flags gate both the header and the toggles
  // so they can't drift apart.
  // Neither option belongs to a workspace job. "Include commits from the
  // previous run" reuses the prior branch, which is the opposite of what a
  // weekly audit wants, and its repo-less wording would be shown for a job
  // that does have a repo - the workspace's. Auto-PR would open a pull
  // request against the workspaces repo on a cron.
  const showContinueOption = !inWorkspace
  const showAutoPROption = !isRepoLess && !inWorkspace
  const hasOptions = showContinueOption || showAutoPROption

  // Reset form state when job prop changes or modal opens
  useEffect(() => {
    if (open) {
      const initialAgent = (job?.agent as Agent) ?? "opencode"
      const initialModels = agentModels[initialAgent] ?? []
      // Seeded, not forced: the field stays editable, so a bad guess costs a
      // retype rather than a wrong name in the list forever.
      setName(job?.name ?? (initialPrompt ? scheduleNameFromPrompt(initialPrompt) : ""))
      setPrompt(job?.prompt ?? initialPrompt ?? "")
      setRepo(job?.repo && job.repo !== NEW_REPOSITORY ? job.repo : "")
      setBaseBranch(job?.baseBranch ?? "main")
      setAgent(initialAgent)
      setModel(job?.model ?? initialModels[0]?.value ?? "")
      const mode = inferIntervalMode(job?.intervalMinutes ?? 1440)
      setIntervalMinutes(mode.intervalMinutes)
      setIsCustomInterval(mode.isCustom)
      setCustomIntervalValue(mode.customValue)
      setCustomIntervalUnit(mode.customUnit)
      setRunAtHourLocal(9)
      setRunAtDay(1)
      setAutoPR(job?.autoPR ?? true)
      setContinueFromLastRun(job?.continueFromLastRun ?? false)
      setError(null)
      setMaterializedJobId(null)
    }
  }, [open, job, initialPrompt])

  // Update model when agent changes (or endpoints load) — but keep a still-valid
  // selection, including a custom endpoint that belongs to the current agent.
  useEffect(() => {
    const models = getAgentModels(agent, customEndpoints)
    if (models.length > 0 && !models.find(m => m.value === model)) {
      setModel(models[0].value)
    }
  }, [agent, model, customEndpoints])

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-dropdown]')) {
        setShowAgentDropdown(false)
        setShowModelDropdown(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  /**
   * Build the request body for create/update from current form state.
   * Returns `null` and sets the visible error if required fields are missing.
   */
  function buildPayload(): Record<string, unknown> | null {
    if (!name.trim()) {
      setError("Name is required")
      return null
    }
    if (!prompt.trim()) {
      setError("Prompt is required")
      return null
    }
    if (effectiveIntervalMinutes < 10) {
      setError("Interval must be at least 10 minutes")
      return null
    }
    const runAtHourUtc = localHourToUtc(runAtHourLocal)
    return {
      name: name.trim(),
      prompt: prompt.trim(),
      workspaceId,
      ...jobTargetFields({ inWorkspace, repo, baseBranch, agent, model }),
      triggerType,
      intervalMinutes: effectiveIntervalMinutes,
      runAtHour: effectiveIntervalMinutes >= 1440 ? runAtHourUtc : undefined,
      runAtDay: effectiveIntervalMinutes === 10080 ? runAtDay : undefined,
      // Auto-PR has nothing to push to in repo-less mode, and nothing it
      // should push to in a workspace.
      autoPR: isRepoLess || inWorkspace ? false : autoPR,
      continueFromLastRun: inWorkspace ? false : continueFromLastRun,
    }
  }

  /**
   * Materialize callback for the MCP picker — fired on the first MCP click
   * during create mode. POSTs the job (with enabled: false so the cron won't
   * pick it up mid-config) and returns the new id to the picker. Uses
   * placeholders for name/prompt if the user hasn't typed them yet; the
   * final-submit validation in handleSubmit enforces real values before the
   * row goes live. The form stays open and continues acting like create mode
   * until the user hits "Create" (PATCH to flip enabled on) or "Cancel"
   * (DELETE the row).
   *
   */
  async function materializeJob(_draftId: string): Promise<string | null> {
    setError(null)
    try {
      const res = await fetch("/api/scheduled-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Placeholders only exist on disk while isDraft = true. They're never
          // shown in the UI list (the GET filters drafts out) and the cron
          // skips drafts. The final submit PATCH replaces them with real
          // values before flipping isDraft to false.
          name: name.trim() || "(draft)",
          prompt: prompt.trim() || "(draft)",
          workspaceId,
          ...jobTargetFields({ inWorkspace, repo, baseBranch, agent, model }),
          intervalMinutes: effectiveIntervalMinutes,
          autoPR,
          continueFromLastRun,
          enabled: false,
          isDraft: true,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Failed to save job")
        return null
      }
      const created = await res.json()
      setMaterializedJobId(created.id)
      // Capture the token minted by POST so the URL panel can render the
      // moment the user flips to "Via webhook".
      return created.id
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save job")
      return null
    }
  }

  // Handle form submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const payload = buildPayload()
    if (!payload) return

    setLoading(true)

    try {
      const targetId = materializedJobId ?? job?.id
      const isUpdate = !!targetId
      const url = isUpdate
        ? `/api/scheduled-jobs/${targetId}`
        : "/api/scheduled-jobs"
      const method = isUpdate ? "PATCH" : "POST"

      // For materialized rows we created with enabled: false + isDraft: true;
      // promote both on final Create. For real edits, we leave existing state
      // alone.
      const body =
        materializedJobId && !isEditing
          ? { ...payload, enabled: true, isDraft: false }
          : payload

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to save job")
      }

      const savedJob = await res.json()
      // Clear the materialized marker so the close handler doesn't try to
      // delete what we just successfully saved.
      setMaterializedJobId(null)
      onSuccess(savedJob)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save job")
    } finally {
      setLoading(false)
    }
  }

  /**
   * Close handler: if we materialized a job in create mode and the user is
   * walking away without saving, drop the row so we don't leak draft jobs.
   * Best-effort — even if cleanup fails we still close the modal.
   */
  const handleClose = async () => {
    if (materializedJobId && !isEditing) {
      const idToDelete = materializedJobId
      setMaterializedJobId(null)
      try {
        await fetch(`/api/scheduled-jobs/${idToDelete}`, { method: "DELETE" })
      } catch (err) {
        console.error("[ScheduledJobForm] cleanup delete failed:", err)
      }
    }
    onClose()
  }

  const handleAgentChange = (newAgent: Agent) => {
    setAgent(newAgent)
    setShowAgentDropdown(false)
  }

  const handleModelChange = (newModel: string) => {
    setModel(newModel)
    setShowModelDropdown(false)
  }

  return {
    // identity / mode
    isEditing,
    jobId: job?.id,
    workspaceId,
    inWorkspace,
    // Named so the form can say where the job will run. A schedule that fires
    // into a workspace it never mentions is the kind of thing people only
    // discover from a surprising run.
    workspaceName: workspaceId === activeWorkspace?.id ? activeWorkspace?.name ?? null : null,
    // values
    name,
    prompt,
    repo,
    baseBranch,
    isRepoLess,
    agent,
    model,
    triggerType,
    intervalMinutes,
    isCustomInterval,
    customIntervalValue,
    customIntervalUnit,
    runAtHourLocal,
    runAtDay,
    autoPR,
    continueFromLastRun,
    loading,
    error,
    materializedJobId,
    showAgentDropdown,
    showModelDropdown,
    // derived
    availableModels,
    customEndpoints,
    timezoneName,
    effectiveIntervalMinutes,
    showContinueOption,
    showAutoPROption,
    hasOptions,
    // setters
    setName,
    setPrompt,
    setRepo,
    setBaseBranch,
    setModel,
    setIntervalMinutes,
    setIsCustomInterval,
    setCustomIntervalValue,
    setCustomIntervalUnit,
    setRunAtHourLocal,
    setRunAtDay,
    setAutoPR,
    setContinueFromLastRun,
    setShowAgentDropdown,
    setShowModelDropdown,
    // handlers
    materializeJob,
    handleSubmit,
    handleClose,
    handleAgentChange,
    handleModelChange,
  }
}
