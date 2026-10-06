import { FileIcon } from "../files/FileIcon"

/** What a file shows when it has no preview, or its preview failed — never a blank pane. */
export function PreviewFallback({ path, reason }: { path: string; reason: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <FileIcon path={path} className="h-14 w-14" />
      <p className="text-sm font-medium text-foreground">{path.split("/").pop()}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{reason}</p>
    </div>
  )
}
