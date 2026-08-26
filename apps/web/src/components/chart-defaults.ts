import { type CSSProperties } from 'react'
import { type Margin } from 'recharts'

/** The only tick-text attributes these charts set. */
type AxisTickStyle = {
  readonly fontSize: number
  readonly fill?: string
}

export const CHART_MARGIN: Margin = { top: 8, right: 8, bottom: 0, left: -16 }

export const AXIS_TICK: AxisTickStyle = { fontSize: 11 }

export const TOOLTIP_STYLE: CSSProperties = {
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--popover)',
  fontSize: 12
}
