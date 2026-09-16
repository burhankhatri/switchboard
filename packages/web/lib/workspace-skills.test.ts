import { describe, it, expect } from "vitest"
import {
  listSkillSlugs,
  parseSkillFrontmatter,
  scaffoldSkillMarkdown,
  skillPath,
  skillSlug,
} from "./workspace-skills"

describe("skillSlug", () => {
  it("turns what a person types into a directory name", () => {
    expect(skillSlug("Campaign Audit")).toBe("campaign-audit")
    expect(skillSlug("  Lead → Campaign  ")).toBe("lead-campaign")
    expect(skillSlug("Deliverability (weekly)")).toBe("deliverability-weekly")
  })

  it("never yields a name that would escape the skills folder", () => {
    expect(skillSlug("../../etc/passwd")).toBe("etc-passwd")
    expect(skillSlug(".")).toBe("")
    expect(skillSlug("..")).toBe("")
    expect(skillSlug("///")).toBe("")
  })

  it("does not leave a trailing hyphen when the cap lands mid-word", () => {
    const slug = skillSlug(`${"a".repeat(63)} campaign`)
    expect(slug).toHaveLength(63)
    expect(slug.endsWith("-")).toBe(false)
  })
})

describe("skillPath", () => {
  it("places a skill where discovery will find it", () => {
    expect(skillPath("workspaces/gtm", "campaign-audit")).toBe(
      "workspaces/gtm/.claude/skills/campaign-audit/SKILL.md"
    )
  })
})

describe("parseSkillFrontmatter", () => {
  it("reads name and description", () => {
    const parsed = parseSkillFrontmatter(
      '---\nname: campaign-audit\ndescription: "Audit a live campaign"\n---\n\n# Body\n'
    )
    expect(parsed).toEqual({ name: "campaign-audit", description: "Audit a live campaign" })
  })

  it("returns null when there is no frontmatter block", () => {
    expect(parseSkillFrontmatter("# Just a heading\n")).toBeNull()
    expect(parseSkillFrontmatter("---\nname: unclosed\n")).toBeNull()
  })

  it("reports a missing description rather than inventing one", () => {
    // The panel shows this as "No description", which is a prompt to fix the
    // skill: without one the model has nothing to match a task against.
    expect(parseSkillFrontmatter("---\nname: nameless\n---\n")).toEqual({
      name: "nameless",
      description: "",
    })
  })
})

describe("listSkillSlugs", () => {
  it("finds a skill by its SKILL.md and counts what ships with it", () => {
    expect(
      listSkillSlugs([
        ".claude/skills/campaign-audit/SKILL.md",
        ".claude/skills/campaign-audit/references/thresholds.md",
        ".claude/skills/lead-push/SKILL.md",
        "scripts/push.mjs",
        "workspace.yaml",
      ])
    ).toEqual([
      { slug: "campaign-audit", extraFiles: 1 },
      { slug: "lead-push", extraFiles: 0 },
    ])
  })

  it("ignores a folder that has no SKILL.md yet", () => {
    // Otherwise a half-uploaded skill shows in the list as one the agent would
    // load, which it would not.
    expect(listSkillSlugs([".claude/skills/half-done/notes.md"])).toEqual([])
  })

  it("ignores the placeholder a new folder carries", () => {
    expect(
      listSkillSlugs([".claude/skills/empty/SKILL.md", ".claude/skills/empty/.gitkeep"])
    ).toEqual([{ slug: "empty", extraFiles: 0 }])
  })

  it("ignores a loose file sitting directly in the skills folder", () => {
    expect(listSkillSlugs([".claude/skills/README.md"])).toEqual([])
  })
})

describe("scaffoldSkillMarkdown", () => {
  it("quotes the description so a colon cannot break the frontmatter", () => {
    const md = scaffoldSkillMarkdown({
      slug: "campaign-audit",
      title: "Campaign Audit",
      description: "Weekly check: bounces, replies, sending volume",
    })
    expect(md).toContain(
      'description: "Weekly check: bounces, replies, sending volume"'
    )
    expect(parseSkillFrontmatter(md)).toEqual({
      name: "campaign-audit",
      description: "Weekly check: bounces, replies, sending volume",
    })
  })
})
