import { describe, expect, it } from "vitest"
import { collectDroppedFiles, type DroppedEntry } from "./dropped-files"

/**
 * Plain objects shaped like the browser's FileSystemEntry — the slice of it a
 * drop hands over — so the walk can be tested without a browser.
 */
function fileEntry(fullPath: string, body = "x"): DroppedEntry {
  const name = fullPath.split("/").pop()!
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath,
    file: (ok) => ok(new File([body], name)),
  }
}

function dirEntry(fullPath: string, children: DroppedEntry[], pageSize = 100): DroppedEntry {
  return {
    isFile: false,
    isDirectory: true,
    name: fullPath.split("/").pop()!,
    fullPath,
    createReader: () => {
      let offset = 0
      return {
        readEntries: (ok) => {
          const page = children.slice(offset, offset + pageSize)
          offset += pageSize
          ok(page)
        },
      }
    },
  }
}

describe("collectDroppedFiles", () => {
  it("keeps a dropped folder's structure", async () => {
    const dropped = await collectDroppedFiles([
      dirEntry("/campaign", [fileEntry("/campaign/brief.md"), dirEntry("/campaign/data", [fileEntry("/campaign/data/leads.csv")])]),
      fileEntry("/notes.txt"),
    ])
    expect(dropped.map((d) => d.relativePath).sort()).toEqual([
      "campaign/brief.md",
      "campaign/data/leads.csv",
      "notes.txt",
    ])
    expect(dropped.every((d) => d.file instanceof File)).toBe(true)
  })

  it("reads a large folder to the end, not just the first page", async () => {
    // Chrome hands directory entries over in pages of 100, and a single
    // readEntries call quietly returns only the first of them.
    const many = Array.from({ length: 250 }, (_, i) => fileEntry(`/big/f${i}.txt`))
    const dropped = await collectDroppedFiles([dirEntry("/big", many)])
    expect(dropped).toHaveLength(250)
  })

  it("brings an empty folder back as nothing rather than failing", async () => {
    expect(await collectDroppedFiles([dirEntry("/empty", [])])).toEqual([])
  })
})
