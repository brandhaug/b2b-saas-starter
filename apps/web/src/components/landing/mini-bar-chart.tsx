import {
  Bar,
  BarChart,
  CartesianGrid,
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

const BAR_RADIUS: [number, number, number, number] = [2, 2, 0, 0]

export function MiniBarChart({
  data,
  xKey,
  dataKey,
  color
}: {
  readonly data: readonly Record<string, unknown>[]
  readonly xKey: string
  readonly dataKey: string
  readonly color: string
}) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={[...data]} margin={COMPACT_CHART_MARGIN}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="color-mix(in oklch, var(--border) 30%, transparent)"
        />
        <XAxis dataKey={xKey} tick={COMPACT_AXIS_TICK} stroke="transparent" />
        <YAxis tick={COMPACT_AXIS_TICK} stroke="transparent" />
        <Tooltip contentStyle={COMPACT_TOOLTIP_STYLE} />
        <Bar dataKey={dataKey} fill={color} radius={BAR_RADIUS} />
      </BarChart>
    </ResponsiveContainer>
  )
}
