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
import { type WebhookEndpoint } from '@b2b-saas-starter/capabilities'
import { AXIS_TICK, CHART_MARGIN, TOOLTIP_STYLE } from '../chart-defaults'

export function WebhookSuccessChart({
  webhooks
}: {
  readonly webhooks: readonly WebhookEndpoint[]
}) {
  const data = webhooks.map((endpoint) => ({
    label: new URL(endpoint.url).host,
    successRate: endpoint.successRate
  }))

  if (webhooks.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No webhook endpoints configured yet.
      </p>
    )
  }

  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} />
          <YAxis tickLine={false} axisLine={false} domain={[0, 100]} tick={AXIS_TICK} />
          <Tooltip
            cursor={{ fill: 'var(--muted)' }}
            contentStyle={TOOLTIP_STYLE}
            formatter={(value) => [`${String(value)}%`, 'Success']}
          />
          <Bar dataKey="successRate" radius={4}>
            {data.map((entry) => (
              <Cell
                key={entry.label}
                fill={entry.successRate >= 95 ? 'var(--chart-1)' : 'var(--destructive)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
