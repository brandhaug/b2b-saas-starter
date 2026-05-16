import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import type { CatalogRefreshRun } from '@b2b-saas-starter/capabilities'
import { AXIS_TICK, CHART_MARGIN, TOOLTIP_STYLE } from '../chart-defaults'

export function CatalogRefreshChart({
  runs
}: {
  readonly runs: readonly CatalogRefreshRun[]
}) {
  const data = useMemo(
    () =>
      runs.map((run) => ({
        label: run.label,
        durationMs: run.durationMs,
        status: run.status
      })),
    [runs]
  )

  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} />
          <YAxis tickLine={false} axisLine={false} tick={AXIS_TICK} />
          <Tooltip
            cursor={{ fill: 'var(--muted)' }}
            contentStyle={TOOLTIP_STYLE}
            formatter={(value, _name, item) => {
              const status =
                (item as { payload?: { status?: string } })?.payload?.status ?? 'ok'
              return [`${String(value)}ms (${status})`, 'Duration']
            }}
          />
          <Bar dataKey="durationMs" radius={4}>
            {data.map((entry) => (
              <Cell
                key={entry.label}
                fill={entry.status === 'ok' ? 'var(--chart-1)' : 'var(--destructive)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
