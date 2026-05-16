export const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: -16 } as const
export const COMPACT_CHART_MARGIN = { top: 5, right: 10, left: -10, bottom: 5 } as const

export const AXIS_TICK = { fontSize: 11 } as const
export const COMPACT_AXIS_TICK = {
  fontSize: 10,
  fill: 'var(--muted-foreground)'
} as const

export const TOOLTIP_STYLE = {
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--popover)',
  fontSize: 12
} as const

export const COMPACT_TOOLTIP_STYLE = {
  backgroundColor: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  fontSize: 11,
  color: 'var(--foreground)'
} as const
