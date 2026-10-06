import { describe, expect, it } from "vitest"
import { fileKind, isBinaryFile, previewKind } from "./file-kind"

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

describe("isBinaryFile for formats the editor used to open as text", () => {
  it("flags macro-enabled, binary and OpenDocument Office files", () => {
    for (const name of ["Chariot.xlsm", "rates.xlsb", "template.xltm", "budget.ods", "memo.odt", "slides.odp", "memo.docm", "deck.pptm"]) {
      expect(isBinaryFile(name)).toBe(true)
    }
  })

  it("flags image, audio and video formats beyond the common ones", () => {
    for (const name of ["hero.avif", "scan.bmp", "scan.tiff", "call.ogg", "call.flac", "demo.mkv"]) {
      expect(isBinaryFile(name)).toBe(true)
    }
  })
})

describe("previewKind", () => {
  it("previews every workbook format as a spreadsheet", () => {
    for (const name of ["Chariot.xlsm", "Pricing Spread sheet.xlsx", "old.xls", "rates.xlsb", "budget.ods", "plan.numbers"]) {
      expect(previewKind(name)).toBe("spreadsheet")
    }
  })

  it("previews delimited text as a table", () => {
    expect(previewKind("batch_run_summary.csv")).toBe("csv")
    expect(previewKind("export.TSV")).toBe("csv")
  })

  it("previews documents, media and archives by what the browser can render", () => {
    expect(previewKind("deck.pdf")).toBe("pdf")
    expect(previewKind("logo.PNG")).toBe("image")
    expect(previewKind("hero.avif")).toBe("image")
    expect(previewKind("call.mp3")).toBe("audio")
    expect(previewKind("demo.mov")).toBe("video")
    expect(previewKind("brief.docx")).toBe("docx")
    expect(previewKind("pitch.pptx")).toBe("pptx")
    expect(previewKind("export.zip")).toBe("zip")
    expect(previewKind("brand.woff2")).toBe("font")
  })

  it("renders text that has a rendered form", () => {
    expect(previewKind("notes/README.md")).toBe("markdown")
    expect(previewKind("report.html")).toBe("html")
    expect(previewKind("icon.svg")).toBe("svg")
  })

  it("has no preview for plain code or formats browsers cannot decode", () => {
    for (const name of ["crm_pricing_bot.py", "Generate Proposal.bat", "Makefile", "photo.heic", "scan.tif", "backup.tar", "old.doc"]) {
      expect(previewKind(name)).toBe("none")
    }
  })
})
