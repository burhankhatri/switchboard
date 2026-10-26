import { z } from "zod"

/**
 * The widget catalogue and its validation — the one gate every widget write
 * passes through, whether a person, a chat agent or a scheduled run made it.
 *
 * Content is data, never markup. An agent writing widgets reads
 * attacker-influenceable text, so the most it can put on a colleague's screen
 * is text in a fixed layout: no HTML, no script, no URL the browser fetches on
 * its own. Links must be http(s) and only open on click.
 */

export const WIDGET_TYPES = ["stat", "table", "chart", "file", "job", "note"] as const
export type WidgetType = (typeof WIDGET_TYPES)[number]

export const MAX_WIDGETS_PER_WORKSPACE = 40
export const MAX_CONTENT_BYTES = 64 * 1024
export const MAX_TABLE_ROWS = 50
export const MAX_TABLE_COLUMNS = 12
export const MAX_CHART_SERIES = 6
export const MAX_CHART_POINTS = 500

const text = (max: number) => z.string().trim().max(max)

const link = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v)
      return u.protocol === "https:" || u.protocol === "http:"
    } catch {
      return false
    }
  }, "Links must be http or https URLs")

const extras = {
  note: text(300).optional(),
  link: link.optional(),
}

const cell = z.union([text(300), z.number().finite(), z.null()])

export const statContent = z
  .object({
    value: z.union([text(40).min(1), z.number().finite()]),
    unit: text(20).optional(),
    change: z
      .object({
        value: text(20).min(1),
        direction: z.enum(["up", "down", "flat"]),
      })
      .strict()
      .optional(),
    ...extras,
  })
  .strict()

export const tableContent = z
  .object({
    columns: z.array(text(60).min(1)).min(1).max(MAX_TABLE_COLUMNS),
    rows: z.array(z.array(cell)).max(MAX_TABLE_ROWS),
    ...extras,
  })
  .strict()
  .superRefine((t, ctx) => {
    t.rows.forEach((row, i) => {
      if (row.length !== t.columns.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", i],
          message: `Row ${i + 1} has ${row.length} cells; there are ${t.columns.length} columns`,
        })
      }
    })
  })

export const chartContent = z
  .object({
    kind: z.enum(["line", "bar"]),
    labels: z.array(text(40)).min(1),
    series: z
      .array(
        z
          .object({
            name: text(60).min(1),
            values: z.array(z.number().finite().nullable()),
          })
          .strict()
      )
      .min(1)
      .max(MAX_CHART_SERIES),
    yLabel: text(40).optional(),
    ...extras,
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.labels.length * c.series.length > MAX_CHART_POINTS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["labels"],
        message: `At most ${MAX_CHART_POINTS} points in total (labels × series)`,
      })
    }
    c.series.forEach((s, i) => {
      if (s.values.length !== c.labels.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["series", i, "values"],
          message: `Series "${s.name}" has ${s.values.length} values; there are ${c.labels.length} labels`,
        })
      }
    })
  })

export const fileContent = z.object({ path: text(1024).min(1) }).strict()

export const jobContent = z.object({ jobId: text(64).min(1) }).strict()

export const noteContent = z.object({ markdown: text(8000).min(1) }).strict()

const CONTENT: Record<WidgetType, z.ZodTypeAny> = {
  stat: statContent,
  table: tableContent,
  chart: chartContent,
  file: fileContent,
  job: jobContent,
  note: noteContent,
}

export type StatContent = z.infer<typeof statContent>
export type TableContent = z.infer<typeof tableContent>
export type ChartContent = z.infer<typeof chartContent>
export type FileContent = z.infer<typeof fileContent>
export type JobContent = z.infer<typeof jobContent>
export type NoteContent = z.infer<typeof noteContent>

export const widgetTitle = text(120).min(1, "A widget needs a title")

/** Lowercase words and dashes, so a job prompt can name it in plain text. */
export const widgetKey = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "Keys are lowercase letters, digits and dashes, e.g. weekly-leads")

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string }

function firstIssue(err: z.ZodError): string {
  const issue = err.issues[0]
  const where = issue.path.length ? `${issue.path.join(".")}: ` : ""
  return `${where}${issue.message}`
}

export function isWidgetType(value: unknown): value is WidgetType {
  return typeof value === "string" && (WIDGET_TYPES as readonly string[]).includes(value)
}

/**
 * Check a widget's content against its type. Size is measured on the parsed
 * value, so trimming and dropped unknown keys cannot be used to sneak a larger
 * payload past the limit — unknown keys are rejected outright anyway.
 */
export function validateWidgetContent(
  type: unknown,
  content: unknown
): ValidationResult<{ type: WidgetType; content: unknown }> {
  if (!isWidgetType(type)) {
    return { ok: false, error: `type must be one of: ${WIDGET_TYPES.join(", ")}` }
  }
  const parsed = CONTENT[type].safeParse(content)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  const bytes = new TextEncoder().encode(JSON.stringify(parsed.data)).length
  if (bytes > MAX_CONTENT_BYTES) {
    return { ok: false, error: `Widget content is ${bytes} bytes; the limit is ${MAX_CONTENT_BYTES}` }
  }
  return { ok: true, value: { type, content: parsed.data } }
}

export function validateTitle(title: unknown): ValidationResult<string> {
  const parsed = widgetTitle.safeParse(title)
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: firstIssue(parsed.error) }
}

export function validateKey(key: unknown): ValidationResult<string | null> {
  if (key === undefined || key === null || key === "") return { ok: true, value: null }
  const parsed = widgetKey.safeParse(key)
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: firstIssue(parsed.error) }
}

/**
 * A file widget may only point inside its own workspace folder — every
 * workspace shares one repo, so this is the same containment rule the file
 * routes apply.
 */
export function fileWidgetPathAllowed(path: string, workspacePath: string): boolean {
  if (path.includes("\\") || /[\x00-\x1f\x7f]/.test(path)) return false
  const parts = path.split("/")
  if (parts.some((p) => !p || p === "." || p === "..")) return false
  return path.startsWith(`${workspacePath}/`)
}
