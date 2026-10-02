import { describe, it, expect } from "vitest"
import { MAX_UPLOAD_FILE_BYTES, validateUploadFile, validateUploadIds } from "./upload-limits"

describe("upload boundaries", () => {
  it("accepts the exact 25 MiB limit and empty files", () => {
    expect(() => validateUploadFile("dataset.csv", MAX_UPLOAD_FILE_BYTES)).not.toThrow()
    expect(() => validateUploadFile("empty.txt", 0)).not.toThrow()
  })
  it.each([MAX_UPLOAD_FILE_BYTES + 1, -1, NaN, Infinity, 1.2, "100"])("rejects an invalid size: %s", size => {
    expect(() => validateUploadFile("data.csv", size)).toThrow()
  })
  it.each(["../secret", "folder\\secret", "a\n.csv", "", ".."])("rejects unsafe filenames: %s", name => {
    expect(() => validateUploadFile(name, 5)).toThrow()
  })
  it("rejects duplicate IDs, URL references and too many files", () => {
    expect(() => validateUploadIds(["one", "one"], 20)).toThrow()
    expect(() => validateUploadIds(["https://evil.test/object"], 20)).toThrow()
    expect(() => validateUploadIds(["one", "two"], 1)).toThrow()
  })
})
