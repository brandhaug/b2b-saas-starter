// oxlint-disable-next-line react-doctor/prefer-dynamic-import -- TanStack Start's autoCodeSplitting (default on) puts this module in the dashboard route's chunk, so recharts never loads outside this route. Lazy-loading inside the page would trade an SSR'd card flash for bytes on the app's main screen.
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
import {
  type ModuleStatus,
  type ModuleStatusCount
} from '@b2b-saas-starter/capabilities'
import { AXIS_TICK, TOOLTIP_STYLE } from '../chart-defaults'

const STATUS_COLORS = {
  ready: 'var(--chart-1)',
  'needs-config': 'var(--chart-3)',
  attention: 'var(--destructive)',
  disabled: 'var(--muted-foreground)'
} satisfies Record<ModuleStatus, string>

// Tallying happens in the `workspaceDashboard` projection
// (`countModuleStatuses`) — this component only renders.
export function ModuleStatusChart({
  data
}: {
  readonly data: readonly ModuleStatusCount[]
}) {
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
