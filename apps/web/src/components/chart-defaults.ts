import type { CSSProperties } from 'react'
import type { Margin } from 'recharts'

/** The only tick-text attributes these charts set. */
type AxisTickStyle = {
  readonly fontSize: number
  readonly fill?: string
}

export const CHART_MARGIN: Margin = { top: 8, right: 8, bottom: 0, left: -16 }
export const COMPACT_CHART_MARGIN: Margin = { top: 5, right: 10, left: -10, bottom: 5 }

export const AXIS_TICK: AxisTickStyle = { fontSize: 11 }
export const COMPACT_AXIS_TICK: AxisTickStyle = {
  fontSize: 10,
  fill: 'var(--muted-foreground)'
}

export const TOOLTIP_STYLE: CSSProperties = {
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--popover)',
  fontSize: 12
}

export const COMPACT_TOOLTIP_STYLE: CSSProperties = {
  backgroundColor: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  fontSize: 11,
  color: 'var(--foreground)'
}
