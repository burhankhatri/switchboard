const UNITS = ["KB", "MB", "GB"] as const

/**
 * A size the way Finder's Size column reads, in binary units so the upload
 * caps (3 × 1024 × 1024) come out as the round numbers they are.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  // One decimal while it still carries information; "20.3 KB" is noise.
  const shown = value < 10 ? Math.round(value * 10) / 10 : Math.round(value)
  return `${shown} ${UNITS[unit]}`
}
