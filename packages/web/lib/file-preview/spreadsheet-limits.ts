// Kept apart from the parser so the grid can show these without pulling SheetJS
// into the main bundle.

/** Wider than any real pricing sheet; beyond it the table stops being readable anyway. */
export const MAX_COLUMNS = 200
/** Bounds parse time and memory on sheets whose used range runs to row 1,048,576. */
export const MAX_ROWS = 50_000
