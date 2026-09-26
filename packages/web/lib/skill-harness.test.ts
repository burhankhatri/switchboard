import { describe, expect, it } from "vitest"
import {
  discoveryChecks,
  expectedSkillFiles,
  parseOpencodeSkillList,
  parseReply,
  parseWorkspaceYaml,
  usageChecks,
  usagePrompt,
  type Probe,
} from "./skill-harness"

const ROOT = "/home/daytona/project"
const WS = `${ROOT}/workspaces/gtm-lead-engine`

describe("parseWorkspaceYaml", () => {
  it("reads what scaffoldWorkspace writes: agent, model and a block system prompt", () => {
    const yaml = [
      'name: "GTM-Lead-Engine"',
      "agent: opencode",
      "model: opencode-go/glm-5.2",
      "systemPrompt: |",
      "  You build cold email campaigns.",
      "",
      "  Start with the campaign-builder skill.",
    ].join("\n")
    expect(parseWorkspaceYaml(yaml)).toEqual({
      agent: "opencode",
      model: "opencode-go/glm-5.2",
      systemPrompt: "You build cold email campaigns.\n\nStart with the campaign-builder skill.",
    })
  })

  it("leaves out what the file does not say", () => {
    expect(parseWorkspaceYaml('name: "Plain"\nagent: claude-code\n')).toEqual({ agent: "claude-code" })
  })
})

describe("expectedSkillFiles", () => {
  it("takes the workspace's skills, nested ones too, and every ancestor's up to the repo root", () => {
    const found = [
      `${WS}/.claude/skills/campaign-builder/SKILL.md`,
      `${WS}/.claude/skills/outreach/cold-email/SKILL.md`,
      `${ROOT}/.claude/skills/crm-write-safety/SKILL.md`,
      `${ROOT}/workspaces/.claude/skills/shared-tone/SKILL.md`,
    ]
    expect(expectedSkillFiles(found, ROOT, WS).sort()).toEqual([...found].sort())
  })

  it("leaves out a SKILL.md that is not under a .claude/skills folder on the way up", () => {
    const found = [
      `${WS}/docs/SKILL.md`,
      `${ROOT}/workspaces/marketing/.claude/skills/other/SKILL.md`,
      `${WS}/.claude/skills/kept/SKILL.md`,
    ]
    expect(expectedSkillFiles(found, ROOT, WS)).toEqual([`${WS}/.claude/skills/kept/SKILL.md`])
  })
})

describe("parseOpencodeSkillList", () => {
  it("reads names and locations from `opencode debug skill`", () => {
    const json = JSON.stringify([
      { name: "customize-opencode", location: "<built-in>", content: "x" },
      { name: "campaign-builder", location: `${WS}/.claude/skills/campaign-builder/SKILL.md`, content: "y" },
    ])
    expect(parseOpencodeSkillList(json)).toEqual([
      { name: "customize-opencode", location: "<built-in>" },
      { name: "campaign-builder", location: `${WS}/.claude/skills/campaign-builder/SKILL.md` },
    ])
  })

  it("refuses a listing that was cut off, rather than reporting skills missing", () => {
    // Piped, OpenCode's output stops at 64KB: the first harness read that as
    // eight skills failing to load.
    const whole = JSON.stringify([{ name: "a", location: "/a/SKILL.md", content: "z".repeat(100) }])
    expect(() => parseOpencodeSkillList(whole.slice(0, 40))).toThrow(/incomplete/)
  })
})

describe("discoveryChecks", () => {
  const ws = (s: string) => `${WS}/.claude/skills/${s}/SKILL.md`
  const shared = `${ROOT}/.claude/skills/crm-write-safety/SKILL.md`

  it("passes when the agent lists every expected skill and the panel shows the workspace's", () => {
    const checks = discoveryChecks({
      expected: [ws("a"), shared],
      listed: [
        { name: "a", location: ws("a") },
        { name: "crm-write-safety", location: shared },
      ],
      panelFiles: [ws("a")],
      workspaceDir: WS, repoRoot: ROOT,
    })
    expect(checks.every((c) => c.pass)).toBe(true)
  })

  it("fails for a skill the agent does not list", () => {
    const checks = discoveryChecks({ expected: [ws("a"), ws("b")], listed: [{ name: "a", location: ws("a") }], panelFiles: [ws("a"), ws("b")], workspaceDir: WS, repoRoot: ROOT })
    expect(checks.filter((c) => !c.pass).map((c) => c.name)).toEqual([
      "the agent lists workspaces/gtm-lead-engine/.claude/skills/b/SKILL.md",
    ])
  })

  it("fails when the agent loads a workspace skill the Skills panel does not show", () => {
    const nested = `${WS}/.claude/skills/outreach/cold-email/SKILL.md`
    const checks = discoveryChecks({
      expected: [nested],
      listed: [{ name: "cold-email", location: nested }],
      panelFiles: [],
      workspaceDir: WS, repoRoot: ROOT,
    })
    expect(checks.filter((c) => !c.pass).map((c) => c.name)).toEqual([
      "the Skills panel shows cold-email, which the agent loads",
    ])
  })
})

describe("usage", () => {
  const probes: Probe[] = [
    { skill: "campaign-builder", dir: "campaign-builder", canary: "c-1111" },
    { skill: "crm-write-safety", dir: "crm-write-safety", canary: "c-2222" },
  ]
  const reply = "CANARIES:\nc-1111\nc-2222\nSKILLS:\ncampaign-builder\ncrm-write-safety\nlead-engine-api\n"

  it("asks for each probe by name, and for the list of skills", () => {
    const prompt = usagePrompt(probes)
    expect(prompt).toContain("campaign-builder")
    expect(prompt).toContain("crm-write-safety")
    expect(prompt).toContain("SKILLS:")
  })

  it("splits the reply into canaries and skill names", () => {
    expect(parseReply(reply)).toEqual({
      canaries: ["c-1111", "c-2222"],
      skills: ["campaign-builder", "crm-write-safety", "lead-engine-api"],
    })
  })

  const tools = [
    { name: "skill", input: { name: "campaign-builder" } },
    { name: "skill", input: { name: "crm-write-safety" } },
  ]

  it("passes when every probe came through the skill tool and every skill is seen", () => {
    const checks = usageChecks({ probes, reply, tools, status: "completed", expectedNames: ["campaign-builder", "crm-write-safety", "lead-engine-api"] })
    expect(checks.filter((c) => !c.pass)).toEqual([])
  })

  it("fails a probe whose canary did not come back", () => {
    const checks = usageChecks({ probes, reply: reply.replace("c-2222", "c-9999"), tools, status: "completed", expectedNames: [] })
    expect(checks.filter((c) => !c.pass).map((c) => c.name)).toEqual(["crm-write-safety: its canary reached the model"])
  })

  it("fails a probe read around the skill tool, even when its canary came back", () => {
    const around = [tools[0], { name: "read", input: { filePath: "/home/daytona/project/.claude/skills/crm-write-safety/SKILL.md" } }]
    const failed = usageChecks({ probes, reply, tools: around, status: "completed", expectedNames: [] })
      .filter((c) => !c.pass)
      .map((c) => c.name)
    expect(failed).toEqual([
      "crm-write-safety: loaded through the skill tool",
      "crm-write-safety: not read around the skill tool",
    ])
  })

  it("fails a skill the model cannot see, and a turn that did not complete", () => {
    const failed = usageChecks({ probes, reply, tools, status: "error", error: "provider stall", expectedNames: ["reply-handling"] })
      .filter((c) => !c.pass)
      .map((c) => c.name)
    expect(failed).toEqual(["the turn completed", "the model sees reply-handling"])
  })

  it("matches Claude Code's Skill tool as well as OpenCode's", () => {
    const claude = [
      { name: "Skill", input: { skill: "campaign-builder" } },
      { name: "Skill", input: { skill: "crm-write-safety" } },
    ]
    expect(usageChecks({ probes, reply, tools: claude, status: "completed", expectedNames: [] }).every((c) => c.pass)).toBe(true)
  })
})
