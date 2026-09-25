import { describe, expect, it } from "vitest"
import { fileKind, isBinaryFile } from "./file-kind"

describe("fileKind", () => {
  it("recognises a skill by its file name, not just its extension", () => {
    expect(fileKind(".claude/skills/audit/SKILL.md")).toBe("skill")
    expect(fileKind("notes/README.md")).toBe("markdown")
  })

  it("sorts common workspace files into the kinds their icons show", () => {
    expect(fileKind("scripts/pull.py")).toBe("code")
    expect(fileKind("lib/leads.ts")).toBe("code")
    expect(fileKind("workspace.yaml")).toBe("data")
    expect(fileKind("config.json")).toBe("data")
    expect(fileKind("leads.csv")).toBe("spreadsheet")
    expect(fileKind("pipeline.xlsx")).toBe("spreadsheet")
    expect(fileKind("deck.pdf")).toBe("pdf")
    expect(fileKind("logo.PNG")).toBe("image")
    expect(fileKind("export.zip")).toBe("archive")
    expect(fileKind("notes.txt")).toBe("text")
    expect(fileKind("Makefile")).toBe("other")
  })
})

describe("isBinaryFile", () => {
  it("flags files a text editor would corrupt on save", () => {
    for (const name of ["deck.pdf", "logo.png", "photo.jpeg", "pipeline.xlsx", "brief.docx", "export.zip"]) {
      expect(isBinaryFile(name)).toBe(true)
    }
  })

  it("leaves text files editable, including CSV and SVG", () => {
    for (const name of ["SKILL.md", "leads.csv", "icon.svg", "pull.py", "workspace.yaml", "Makefile"]) {
      expect(isBinaryFile(name)).toBe(false)
    }
  })
})
