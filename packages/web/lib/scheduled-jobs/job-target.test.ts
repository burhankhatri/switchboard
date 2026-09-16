import { describe, it, expect } from "vitest"
import { jobTargetFields } from "./job-target"
import { NEW_REPOSITORY } from "@/lib/types"

const form = {
  inWorkspace: false,
  repo: "",
  // The form's own defaults, which is the whole point of the workspace case.
  baseBranch: "main",
  agent: "opencode",
  model: "",
}

describe("jobTargetFields", () => {
  it("sends nothing at all inside a workspace", () => {
    // The API takes an explicit value over the workspace's. Sending these
    // defaults made a workspace job run opencode against "main" instead of
    // the harness and branch the workspace declares.
    expect(jobTargetFields({ ...form, inWorkspace: true })).toEqual({})
  })

  it("sends nothing inside a workspace even when the form holds values", () => {
    expect(
      jobTargetFields({
        inWorkspace: true,
        repo: "someone/else",
        baseBranch: "develop",
        agent: "codex",
        model: "gpt-5",
      })
    ).toEqual({})
  })

  it("marks a repo-less job with the sentinel rather than an absent repo", () => {
    expect(jobTargetFields(form)).toEqual({
      repo: NEW_REPOSITORY,
      baseBranch: "main",
      agent: "opencode",
      model: null,
    })
  })

  it("passes a chosen repo, branch, agent and model through", () => {
    expect(
      jobTargetFields({
        inWorkspace: false,
        repo: "live/energy",
        baseBranch: "develop",
        agent: "claude-code",
        model: "claude-opus-5",
      })
    ).toEqual({
      repo: "live/energy",
      baseBranch: "develop",
      agent: "claude-code",
      model: "claude-opus-5",
    })
  })

  it("falls back to main when no branch has been picked", () => {
    expect(jobTargetFields({ ...form, repo: "live/energy", baseBranch: "" }).baseBranch).toBe("main")
  })
})
