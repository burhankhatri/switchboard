## Why

The workspace file viewer is a text editor and little else. Spreadsheets, PDFs, images and Office documents show "can't be previewed", retained Storage assets show only a Download button, and `.xlsm` is not recognised as binary at all: it opens in the text editor, where a small one shows noise that Save would commit over the real workbook. Members keep pricing workbooks in workspaces and need to read them without downloading.

## What Changes

- Add a members-only raw-bytes endpoint for workspace files that streams Git files from the repo (no 1 MB Contents API limit) and redirects retained assets to a short-lived signed Storage URL. It never serves bytes as a renderable page on the app origin.
- Render previews in the browser, loading each format's parser only when that format is opened: spreadsheets (xlsx, xlsm, xlsb, xls, ods, numbers, csv, tsv), PDF, images, audio, video, Word (docx), PowerPoint (pptx slide text), zip listings, fonts, and rendered Markdown, HTML and SVG.
- Text formats with a rendered form (Markdown, CSV/TSV, HTML, SVG) open as a preview with an Edit toggle; saving is unchanged.
- Offer Download for every file, Git or Storage.
- Classify macro-enabled and other Office/OpenDocument formats as binary so they are never opened in, or saved from, the text editor.

## Capabilities

### Modified Capabilities
- `workspace-files`: viewing a file previews it by format; raw bytes are served to members only; binary classification covers more formats.

## Impact

New route `GET /api/workspaces/:id/files/raw`; new client preview components under `lib/file-preview`; `WorkspaceFileViewer` chooses a preview by format; `lib/file-kind` gains a preview classification. New browser-only dependencies: SheetJS 0.20.3 (from the official SheetJS CDN, because the npm registry copy is 0.18.5 with known advisories), mammoth, DOMPurify and fflate. No schema or environment changes.
