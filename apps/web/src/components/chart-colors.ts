/** Non-empty by construction, so `CHART_COLORS[0]` is always a usable fallback.
 *  The chart palette is the five `--chart-*` tokens defined in index.css —
 *  DESIGN.md names those five as the palette, reached by cycling — so charts
 *  harmonize with the semantic tokens instead of forking the palette with raw
 *  hex values. */
export const CHART_COLORS: readonly [string, ...Array<string>] = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)'
]
