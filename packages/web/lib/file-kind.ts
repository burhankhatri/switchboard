export type FileKind =
  | "skill"
  | "markdown"
  | "text"
  | "code"
  | "data"
  | "spreadsheet"
  | "pdf"
  | "document"
  | "image"
  | "archive"
  | "media"
  | "other"

const BY_EXTENSION: Record<string, FileKind> = {
  md: "markdown", mdx: "markdown",
  txt: "text", log: "text", rtf: "text",
  ts: "code", tsx: "code", js: "code", jsx: "code", mjs: "code", cjs: "code", py: "code",
  rb: "code", go: "code", rs: "code", java: "code", kt: "code", swift: "code", sh: "code",
  bash: "code", zsh: "code", sql: "code", html: "code", css: "code", scss: "code", php: "code",
  c: "code", cpp: "code", h: "code",
  json: "data", yaml: "data", yml: "data", toml: "data", xml: "data", ini: "data", env: "data",
  csv: "spreadsheet", tsv: "spreadsheet", xlsx: "spreadsheet", xls: "spreadsheet", numbers: "spreadsheet",
  pdf: "pdf",
  doc: "document", docx: "document", pages: "document", ppt: "document", pptx: "document", key: "document",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", heic: "image", ico: "image", svg: "image",
  zip: "archive", gz: "archive", tgz: "archive", tar: "archive", "7z": "archive", rar: "archive",
  mp3: "media", wav: "media", m4a: "media", mp4: "media", mov: "media", webm: "media",
}

/**
 * Extensions whose bytes are not text. Opening one in the text editor shows
 * noise, and saving it back would commit that noise over the real file.
 */
const BINARY = new Set([
  "pdf", "doc", "docx", "docm", "pages", "ppt", "pptx", "pptm", "key",
  "xlsx", "xlsm", "xlsb", "xltx", "xltm", "xls", "numbers", "ods", "odt", "odp",
  "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "tif", "tiff", "heic", "ico",
  "zip", "gz", "tgz", "tar", "7z", "rar",
  "mp3", "wav", "m4a", "ogg", "flac", "aac", "mp4", "mov", "webm", "mkv", "avi",
  "woff", "woff2", "ttf", "otf", "exe", "bin", "dmg",
])

export type PreviewKind =
  | "spreadsheet" | "csv" | "pdf" | "image" | "audio" | "video" | "docx" | "pptx"
  | "zip" | "font" | "markdown" | "html" | "svg" | "none"

/**
 * How the viewer can show a file. Only formats a browser can actually render are
 * listed — HEIC and TIFF are images, but Chrome cannot decode them, so they get
 * "none" and a Download button rather than a broken image.
 */
const PREVIEW: Record<string, PreviewKind> = {
  xlsx: "spreadsheet", xlsm: "spreadsheet", xlsb: "spreadsheet", xltx: "spreadsheet", xltm: "spreadsheet",
  xls: "spreadsheet", ods: "spreadsheet", numbers: "spreadsheet",
  csv: "csv", tsv: "csv",
  pdf: "pdf",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", avif: "image", bmp: "image", ico: "image",
  mp3: "audio", wav: "audio", m4a: "audio", ogg: "audio", flac: "audio", aac: "audio",
  mp4: "video", mov: "video", webm: "video",
  docx: "docx", docm: "docx",
  pptx: "pptx", pptm: "pptx",
  zip: "zip",
  ttf: "font", otf: "font", woff: "font", woff2: "font",
  md: "markdown", mdx: "markdown", markdown: "markdown",
  html: "html", htm: "html",
  svg: "svg",
}

function extension(path: string): string {
  const name = path.split("/").pop() ?? ""
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

/** What a file is, for choosing its icon the way Finder does. */
export function fileKind(path: string): FileKind {
  if (path.split("/").pop() === "SKILL.md") return "skill"
  return BY_EXTENSION[extension(path)] ?? "other"
}

export function isBinaryFile(path: string): boolean {
  return BINARY.has(extension(path))
}

export function previewKind(path: string): PreviewKind {
  return PREVIEW[extension(path)] ?? "none"
}
