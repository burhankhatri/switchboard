import { describe, expect, it } from "vitest"
import { strToU8, zipSync } from "fflate"
import { listZip, pptxOutline } from "./archive"

const slide = (...paragraphs: string[][]) =>
  `<?xml version="1.0"?><p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree>${paragraphs
    .map((runs) => `<p:sp><p:txBody><a:p>${runs.map((t) => `<a:r><a:rPr lang="en-US"/><a:t>${t}</a:t></a:r>`).join("")}</a:p></p:txBody></p:sp>`)
    .join("")}</p:spTree></p:cSld></p:sld>`

/** A minimal deck whose slide files are numbered against their display order. */
function deck(): Uint8Array {
  return zipSync({
    "ppt/presentation.xml": strToU8(
      `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId8"/><p:sldId id="257" r:id="rId7"/></p:sldIdLst></p:presentation>`
    ),
    "ppt/_rels/presentation.xml.rels": strToU8(
      `<Relationships><Relationship Id="rId7" Target="slides/slide1.xml"/><Relationship Id="rId8" Target="slides/slide2.xml"/></Relationships>`
    ),
    "ppt/slides/slide1.xml": strToU8(slide(["Pricing ", "&amp; terms"], [], ["Broker fee &lt; 2%"])),
    "ppt/slides/slide2.xml": strToU8(slide(["Chariot Energy"], ["Proposal for Q4"])),
  })
}

describe("pptxOutline", () => {
  it("lists each slide's paragraphs in presentation order, not file-name order", () => {
    expect(pptxOutline(deck())).toEqual([
      { number: 1, paragraphs: ["Chariot Energy", "Proposal for Q4"] },
      { number: 2, paragraphs: ["Pricing & terms", "Broker fee < 2%"] },
    ])
  })

  it("falls back to numeric file order when the deck has no slide list", () => {
    const bare = zipSync({
      "ppt/slides/slide10.xml": strToU8(slide(["Ten"])),
      "ppt/slides/slide2.xml": strToU8(slide(["Two"])),
    })
    expect(pptxOutline(bare).map((s) => s.paragraphs[0])).toEqual(["Two", "Ten"])
  })
})

describe("listZip", () => {
  it("lists files with their uncompressed sizes, without folders", () => {
    const zip = zipSync({ "readme.txt": strToU8("hello"), "data/": new Uint8Array(), "data/rates.csv": strToU8("a,b\n1,2\n") })
    expect(listZip(zip)).toEqual([
      { name: "readme.txt", size: 5 },
      { name: "data/rates.csv", size: 8 },
    ])
  })

  it("refuses bytes that are not a zip", () => {
    expect(() => listZip(strToU8("plain text"))).toThrow()
  })
})
