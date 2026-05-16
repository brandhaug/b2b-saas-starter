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
import type {
  ModuleStatus,
  StarterModuleWithState
} from '@b2b-saas-starter/capabilities'
import { AXIS_TICK, TOOLTIP_STYLE } from '../chart-defaults'

const STATUS_COLORS: Record<ModuleStatus, string> = {
  ready: 'var(--chart-1)',
  'needs-config': 'var(--chart-3)',
  attention: 'var(--destructive)',
  disabled: 'var(--muted-foreground)'
}

export function ModuleStatusChart({
  modules
}: {
  readonly modules: readonly StarterModuleWithState[]
}) {
  const data = useMemo(() => {
    const counts: Record<ModuleStatus, number> = {
      ready: 0,
      'needs-config': 0,
      attention: 0,
      disabled: 0
    }
    for (const module of modules) counts[module.state.status] += 1
    return (Object.keys(counts) as ModuleStatus[]).map((status) => ({
      status,
      count: counts[status]
    }))
  }, [modules])

  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="status" tickLine={false} axisLine={false} tick={AXIS_TICK} />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK}
          />
          <Tooltip cursor={{ fill: 'var(--muted)' }} contentStyle={TOOLTIP_STYLE} />
          <Bar dataKey="count" radius={4}>
            {data.map((entry) => (
              <Cell key={entry.status} fill={STATUS_COLORS[entry.status]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
