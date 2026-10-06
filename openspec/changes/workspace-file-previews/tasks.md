## 1. Classification

- [x] 1.1 `previewKind(path)` in `lib/file-kind` and the widened binary set (xlsm and other Office/OpenDocument formats).

## 2. Raw bytes

- [x] 2.1 `readWorkspaceFileRaw` streaming a Git file from the workspace branch.
- [x] 2.2 `GET /api/workspaces/:id/files/raw` with membership, containment, safe headers, and a signed redirect for Storage assets.

## 3. Parsers

- [x] 3.1 Spreadsheet model from SheetJS (xlsx, xlsm, xls, ods, csv, tsv), with column cap.
- [x] 3.2 PowerPoint slide outline and zip listing with fflate.

## 4. Viewer

- [x] 4.1 Lazy preview components (spreadsheet, PDF, image, audio, video, docx, pptx, zip, font, HTML, SVG, Markdown) and the bytes hook.
- [x] 4.2 `WorkspaceFileViewer` picks a preview by kind, Preview/Edit toggle for text with a rendered form, Download for every file, visible failures.

## 5. Verification

- [x] 5.1 Typecheck, full test suite, docs and PROGRESS.
- [ ] 5.2 Real browser run against the Pricing Bot workspace files (skipped before the first deploy at the user's request).
