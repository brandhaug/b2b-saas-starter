import { type CSSProperties } from 'react'
import { type Margin } from 'recharts'

/**
 * The chart chrome every Recharts surface in the app shares: margins, tick
 * text, the tooltip card and the legend. Two copies of these constants had
 * drifted apart — different tooltip radii, backgrounds and tick colors on the
 * dashboard than in MDX content — so they live here once.
 *
 * Colors are semantic tokens, never literals, so a chart follows the theme.
 */

/** The only tick-text attributes these charts set. */
type AxisTickStyle = {
  readonly fontSize: string
  readonly fill: string
}

/** Charts that run the width of prose or a page section. */
export const CHART_MARGIN: Margin = { top: 8, right: 10, bottom: 4, left: 0 }

/**
 * Charts inside a dashboard card, where the negative left pulls the y-axis
 * labels back against the card's own padding instead of double-indenting them.
 */
export const COMPACT_CHART_MARGIN: Margin = { top: 8, right: 8, bottom: 0, left: -16 }

export const AXIS_TICK: AxisTickStyle = {
  fontSize: '0.6875rem', // text-2xs — chart chrome rides the rem ramp, not px literals
  fill: 'var(--muted-foreground)'
}

export const TOOLTIP_STYLE: CSSProperties = {
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--popover)',
  fontSize: '0.75rem', // text-xs
  color: 'var(--popover-foreground)'
}

export const LEGEND_STYLE: CSSProperties = { fontSize: '0.6875rem' }
