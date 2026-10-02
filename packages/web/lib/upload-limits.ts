export const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024
export const MAX_UPLOAD_TOTAL_BYTES = 100 * 1024 * 1024
export const MAX_CHAT_UPLOAD_FILES = 20
export const MAX_GIT_FILE_BYTES = 3 * 1024 * 1024

export type UploadScope = { kind: "chat" | "workspace"; id: string }

export function validateUploadFile(name: unknown, size: unknown): asserts name is string {
  if (typeof name !== "string" || !name || name.length > 255 || /[\x00-\x1f\x7f/\\]/.test(name) || name === "." || name === "..") {
    throw new Error("Invalid file name")
  }
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0 || size > MAX_UPLOAD_FILE_BYTES) {
    throw new Error("Files must be 25 MB or smaller")
  }
}

export function validateUploadIds(ids: unknown, maxFiles: number): asserts ids is string[] {
  if (!Array.isArray(ids) || ids.length > maxFiles || ids.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("Invalid upload references")
  }
}
