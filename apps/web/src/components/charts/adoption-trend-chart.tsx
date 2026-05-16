import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import type { ReadinessPoint } from '@b2b-saas-starter/capabilities'
import { AXIS_TICK, CHART_MARGIN, TOOLTIP_STYLE } from '../chart-defaults'

export function AdoptionTrendChart({
  data
}: {
  readonly data: readonly ReadinessPoint[]
}) {
  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={[...data]} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            className="text-xs"
            tick={AXIS_TICK}
          />
          <YAxis tickLine={false} axisLine={false} domain={[0, 100]} tick={AXIS_TICK} />
          <Tooltip
            cursor={{ stroke: 'var(--border)' }}
            contentStyle={TOOLTIP_STYLE}
            formatter={(value) => [`${String(value)}%`, 'Readiness']}
          />
          <Area
            dataKey="score"
            type="monotone"
            stroke="var(--chart-1)"
            fill="var(--chart-1)"
            fillOpacity={0.18}
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
