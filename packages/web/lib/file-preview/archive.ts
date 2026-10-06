import { strFromU8, unzipSync } from "fflate"

export interface ZipEntry {
  name: string
  /** Uncompressed bytes. */
  size: number
}

/**
 * List a zip's files from its central directory. The filter rejects every
 * entry, so nothing is decompressed — a 25 MiB archive lists instantly.
 */
export function listZip(bytes: Uint8Array): ZipEntry[] {
  const entries: ZipEntry[] = []
  unzipSync(bytes, {
    filter: (file) => {
      if (!file.name.endsWith("/")) entries.push({ name: file.name, size: file.originalSize })
      return false
    },
  })
  return entries
}

export interface SlideOutline {
  number: number
  paragraphs: string[]
}

const SLIDE = /^ppt\/slides\/slide(\d+)\.xml$/

/**
 * The text of each slide, as an outline. Layout is not reproduced; the words
 * are what a member needs to tell one deck from another.
 *
 * Slide file numbers are not display order — reordering slides in PowerPoint
 * leaves the files alone and rewrites presentation.xml's slide list — so order
 * comes from that list, with file numbers only as a fallback.
 */
export function pptxOutline(bytes: Uint8Array): SlideOutline[] {
  const files = unzipSync(bytes, {
    filter: (file) => SLIDE.test(file.name) || file.name === "ppt/presentation.xml" || file.name === "ppt/_rels/presentation.xml.rels",
  })
  const slides = Object.keys(files).filter((name) => SLIDE.test(name))
  const order = presentationOrder(files)
  slides.sort((a, b) => rank(a, order) - rank(b, order))
  return slides.map((name, i) => ({ number: i + 1, paragraphs: paragraphsOf(strFromU8(files[name])) }))
}

function presentationOrder(files: Record<string, Uint8Array>): string[] {
  const presentation = files["ppt/presentation.xml"]
  const rels = files["ppt/_rels/presentation.xml.rels"]
  if (!presentation || !rels) return []
  const targets = new Map<string, string>()
  for (const [, tag] of strFromU8(rels).matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(tag)?.[1]
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1]
    if (id && target) targets.set(id, `ppt/${target.replace(/^\/?(ppt\/)?/, "")}`)
  }
  return [...strFromU8(presentation).matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)]
    .map(([, id]) => targets.get(id))
    .filter((target): target is string => !!target)
}

function rank(name: string, order: string[]): number {
  const listed = order.indexOf(name)
  return listed >= 0 ? listed : order.length + Number(SLIDE.exec(name)?.[1] ?? 0)
}

function paragraphsOf(xml: string): string[] {
  return [...xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)]
    .map(([, body]) => [...body.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(([, text]) => decodeXml(text)).join(""))
    .filter((text) => text.trim())
}

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }
    if (entity[0] !== "#") return named[entity.toLowerCase()]
    return String.fromCodePoint(entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10))
  })
}
