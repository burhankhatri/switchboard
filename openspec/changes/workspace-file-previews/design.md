## Context

`GET /api/workspaces/:id/files?path=` returns text through GitHub's Contents API, which omits the body of any blob over 1 MB, and returns a signed download URL for retained Storage assets. The viewer renders text in a textarea and everything else as an icon card. `lib/file-preview` already has image, PDF and Markdown renderers used by chat and the sandbox file panel.

## Goals / Non-Goals

Goals: preview every format a browser can render without a server-side converter; keep previews read-only; never expose uploaded bytes as an executable page on the app origin; never let a binary file reach the text editor's Save. Non-goals: editing spreadsheets or documents, rendering slide layout, formulas recalculation, HEIC/TIFF decoding, previewing tar/7z/rar contents.

## Decisions

- **Bytes come from one route.** `GET /api/workspaces/:id/files/raw?path=` applies the same membership and containment checks as the file read. Git files are fetched with `Accept: application/vnd.github.raw` on the workspace branch and streamed back, which removes the 1 MB limit. Retained assets answer with a 302 to a fresh signed Storage URL, so large bytes never pass through a Vercel function. Responses carry `Content-Type: application/octet-stream`, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox; default-src 'none'`, so opening the URL directly can never render uploaded HTML or SVG on the app origin.
- **Rendering is client-side and lazy.** Each preview is a dynamically imported component, so SheetJS (~1 MB), mammoth and fflate load only when their format is opened. The bytes are fetched once per path and version through React Query.
- **The browser decides the MIME type, from an allowlist.** Object URLs are created with a type from a fixed extension map (images, PDF, audio, video). HTML is never put in an object URL; it is rendered through `iframe srcdoc` with an empty `sandbox` attribute (no scripts, opaque origin). SVG is rendered through `<img>`, where scripts do not run. Word output is passed through DOMPurify.
- **Spreadsheets** are parsed with SheetJS into a plain model (sheet names; rows of display strings, using cached formula values). Rows are virtualised; columns are capped at 200 per sheet with a note. Parsing happens on the main thread first; it moves to a Worker if opening `Chariot.xlsm` (3 MB) blocks for more than about a second.
- **PowerPoint** is unzipped with fflate and each `ppt/slides/slideN.xml` is reduced to its paragraphs of `<a:t>` text, in slide order. **Zip** listings come from fflate's central-directory pass without decompressing.
- **Text with a rendered form** (md, csv, tsv, html, svg) opens in preview, with an Edit toggle that shows the existing editor. Other text opens in the editor as before.
- **Classification lives in `lib/file-kind`.** `previewKind(path)` maps an extension to a preview, and the binary set gains xlsm, xlsb, xltx, xltm, ods, odt, odp, docm, pptm, avif, bmp, tif, tiff, ogg, flac, mkv and similar. The viewer's Save is shown only for kinds that are text.
- **Failure is visible.** A corrupt, encrypted, unsupported or over-25 MiB file shows the existing icon card with the reason and a Download button.

## Risks / Trade-offs

- Parsing untrusted workbooks and documents in the browser → it runs in the member's own tab with no extra privilege; SheetJS is pinned to the current CDN release; HTML outputs are sanitised or sandboxed.
- Large previews cost egress (Storage) and GitHub API quota → bytes are fetched only when a file is opened and cached per version; the cap is 25 MiB.
- Bundle size → per-format dynamic imports keep the parsers out of the editor bundle.
