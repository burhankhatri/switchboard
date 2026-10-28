import { describe, it, expect } from "vitest"
import { DOC_ONLY_PATTERNS, docOnlyMergeDecision } from "./doc-only-merge"

/**
 * Each chat starts from main, but agent commits sit on agent/* until a person
 * merges. Specs and LEARNINGS written in one chat were invisible in the next:
 * on 2026-10-01 an agent found "the campaign spec isn't in the repo (sandbox is
 * fresh)" and reconstructed it from Instantly. Documentation-only commits are
 * safe to land on their own; everything else keeps the review step.
 */
describe("docOnlyMergeDecision", () => {
  const ws = "workspaces/gtm-lead-engine"
  const status = (lines: string) => lines.trim().split("\n")

  it("names the documentation paths", () => {
    expect(DOC_ONLY_PATTERNS).toEqual(["campaigns/**", "LEARNINGS.md", "HOME.md", ".claude/skills/**/reference/**"])
  })

  it("merges a campaign spec and a LEARNINGS entry", () => {
    const d = docOnlyMergeDecision(
      status(`A\t${ws}/campaigns/2026-10-dfw/campaign.json\nM\t${ws}/LEARNINGS.md\nM\t${ws}/HOME.md`),
      ws
    )
    expect(d).toEqual({ merge: true, files: 3 })
  })

  it("merges a skill's reference material but not the skill itself", () => {
    expect(docOnlyMergeDecision(status(`A\t${ws}/.claude/skills/campaign-review/reference/2026-10.md`), ws)).toEqual({ merge: true, files: 1 })
    const d = docOnlyMergeDecision(status(`M\t${ws}/.claude/skills/campaign-review/SKILL.md`), ws)
    expect(d.merge).toBe(false)
    expect(d).toMatchObject({ reason: expect.stringContaining("SKILL.md") })
  })

  it("refuses when a script, a test or workspace.yaml changed", () => {
    expect(docOnlyMergeDecision(status(`M\t${ws}/scripts/push_to_instantly.py\nM\t${ws}/LEARNINGS.md`), ws).merge).toBe(false)
    expect(docOnlyMergeDecision(status(`M\t${ws}/workspace.yaml`), ws).merge).toBe(false)
  })

  it("refuses a change outside the workspace folder", () => {
    expect(docOnlyMergeDecision(status(`M\tworkspaces/pricing-bot/LEARNINGS.md`), ws).merge).toBe(false)
    expect(docOnlyMergeDecision(status(`M\t.claude/skills/crm-write-safety/SKILL.md`), ws).merge).toBe(false)
  })

  it("allows a deletion inside the documentation paths and nowhere else", () => {
    expect(docOnlyMergeDecision(status(`D\t${ws}/campaigns/old/campaign.json`), ws).merge).toBe(true)
    expect(docOnlyMergeDecision(status(`D\t${ws}/scripts/old.py`), ws).merge).toBe(false)
  })

  it("follows a rename to its destination", () => {
    expect(docOnlyMergeDecision(status(`R100\t${ws}/campaigns/a/campaign.json\t${ws}/campaigns/b/campaign.json`), ws).merge).toBe(true)
    expect(docOnlyMergeDecision(status(`R100\t${ws}/campaigns/a/x.py\t${ws}/scripts/x.py`), ws).merge).toBe(false)
  })

  it("does nothing with an empty diff", () => {
    expect(docOnlyMergeDecision([], ws)).toEqual({ merge: false, reason: "nothing to merge" })
    expect(docOnlyMergeDecision([""], ws).merge).toBe(false)
  })
})
