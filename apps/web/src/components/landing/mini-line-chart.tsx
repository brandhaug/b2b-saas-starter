import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import {
  COMPACT_AXIS_TICK,
  COMPACT_CHART_MARGIN,
  COMPACT_TOOLTIP_STYLE
} from '../chart-defaults'

export function MiniLineChart({
  data,
  xKey,
  lines
}: {
  readonly data: readonly Record<string, unknown>[]
  readonly xKey: string
  readonly lines: readonly { readonly key: string; readonly color: string }[]
}) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={[...data]} margin={COMPACT_CHART_MARGIN}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="color-mix(in oklch, var(--border) 30%, transparent)"
        />
        <XAxis dataKey={xKey} tick={COMPACT_AXIS_TICK} stroke="transparent" />
        <YAxis tick={COMPACT_AXIS_TICK} stroke="transparent" />
        <Tooltip contentStyle={COMPACT_TOOLTIP_STYLE} />
        {lines.map((l) => (
          <Line
            key={l.key}
            type="monotone"
            dataKey={l.key}
            stroke={l.color}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
