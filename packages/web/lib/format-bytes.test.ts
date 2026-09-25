import { describe, expect, it } from "vitest"
import { formatBytes } from "./format-bytes"

describe("formatBytes", () => {
  it("counts small files in bytes", () => {
    expect(formatBytes(0)).toBe("0 bytes")
    expect(formatBytes(1)).toBe("1 byte")
    expect(formatBytes(900)).toBe("900 bytes")
  })

  it("keeps one decimal only while it still says something", () => {
    expect(formatBytes(1536)).toBe("1.5 KB")
    expect(formatBytes(2048)).toBe("2 KB")
    expect(formatBytes(20 * 1024 + 300)).toBe("20 KB")
  })

  it("names the upload ceilings the way the error messages quote them", () => {
    expect(formatBytes(3 * 1024 * 1024)).toBe("3 MB")
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB")
    expect(formatBytes(1.25 * 1024 * 1024)).toBe("1.3 MB")
  })
})
