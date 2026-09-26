import { describe, expect, it } from "vitest"
import { buildFileTree, childrenOf, SKILLS_FOLDER_LABEL } from "./file-tree"

const file = (name: string, size = 10) => ({ path: `workspaces/gtm/${name}`, name, size })
const names = (nodes: { name: string }[]) => nodes.map((n) => n.name)

describe("buildFileTree", () => {
  it("shows the workspace's skills as a top-level Skills folder", () => {
    // Skills live at .claude/skills — the one path the agent reads them from —
    // but a dimmed dotfolder two levels down is invisible to anyone who
    // browses like Finder.
    const root = buildFileTree([
      file(".claude/skills/campaign-builder/SKILL.md"),
      file(".claude/skills/lead-engine-api/SKILL.md"),
      file(".claude/skills/lead-engine-api/reference/endpoints.md"),
      file("scripts/pull.py"),
      file("LEARNINGS.md"),
    ])
    const top = childrenOf(root)
    expect(names(top)).toEqual([SKILLS_FOLDER_LABEL, "scripts", "LEARNINGS.md"])
    const skills = top[0]
    expect(skills.rel).toBe(".claude/skills")
    expect(skills.isSkillsFolder).toBe(true)
    expect(names(childrenOf(skills))).toEqual(["campaign-builder", "lead-engine-api"])
  })

  it("keeps the rest of .claude where it is", () => {
    const top = childrenOf(buildFileTree([file(".claude/settings.json"), file(".claude/skills/a/SKILL.md")]))
    expect(names(top)).toEqual([SKILLS_FOLDER_LABEL, ".claude"])
    expect(names(childrenOf(top[1]))).toEqual(["settings.json"])
  })

  it("has no Skills folder in a workspace without skills", () => {
    expect(names(childrenOf(buildFileTree([file("scripts/a.py")])))).toEqual(["scripts"])
  })

  it("lists folders first, in the order Finder uses, and hides git placeholders", () => {
    const top = childrenOf(
      buildFileTree([file("b.txt"), file("file10.txt"), file("file2.txt"), file("data/.gitkeep"), file(".gitkeep")])
    )
    expect(names(top)).toEqual(["data", "b.txt", "file2.txt", "file10.txt"])
    expect(childrenOf(top[0])).toEqual([])
  })
})
