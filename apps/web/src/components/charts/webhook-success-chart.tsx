import { type WebhookEndpoint } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints' // oxlint-disable-next-line react-doctor/prefer-dynamic-import -- TanStack Start's autoCodeSplitting (default on) puts this module in the dashboard route's chunk, so recharts never loads outside this route. Lazy-loading inside the page would trade an SSR'd card flash for bytes on the app's main screen.
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
import { AXIS_TICK, COMPACT_CHART_MARGIN, TOOLTIP_STYLE } from '../chart-defaults'

/** Below this many endpoints a sentence says more than a chart does. */
const MIN_ENDPOINTS_FOR_CHART = 3

export function WebhookSuccessChart({
  webhooks
}: {
  readonly webhooks: ReadonlyArray<WebhookEndpoint>
}) {
  const data = webhooks.map((endpoint) => ({
    label: new URL(endpoint.url).host,
    successRate: endpoint.successRate
  }))

  if (webhooks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No webhook endpoints configured yet.
      </p>
    )
  }

  // One or two endpoints are a fact, not a distribution — a single slab
  // filling a card wastes the space and reads as decoration.
  if (webhooks.length < MIN_ENDPOINTS_FOR_CHART) {
    return (
      <ul className="grid gap-1 text-sm">
        {webhooks.map((endpoint) => (
          <li key={endpoint.id} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-xs">{new URL(endpoint.url).host}</span>
            <span className="font-medium">{endpoint.successRate}% delivered</span>
            {endpoint.enabled ? null : (
              <span className="text-xs text-muted-foreground">disabled</span>
            )}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="h-40 w-full">
      <ul className="sr-only">
        {data.map((entry) => (
          <li key={entry.label}>
            {entry.label}: {entry.successRate}% success rate
          </li>
        ))}
      </ul>
      <ResponsiveContainer aria-hidden width="100%" height="100%">
        <BarChart
          data={data}
          margin={COMPACT_CHART_MARGIN}
          /* accessibilityLayer default adds a focusable SVG wrapper — a
             keyboard trap inside the aria-hidden container above (axe:
             aria-hidden-focus). The sr-only list carries the data. */
          accessibilityLayer={false}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} />
          <YAxis tickLine={false} axisLine={false} domain={[0, 100]} tick={AXIS_TICK} />
          <Tooltip
            cursor={{ fill: 'var(--muted)' }}
            contentStyle={TOOLTIP_STYLE}
            formatter={(value) => [`${String(value)}%`, 'Success']}
          />

          <Bar dataKey="successRate" radius={4} isAnimationActive={false}>
            {data.map((entry) => (
              <Cell
                key={entry.label}
                // Status hues, not the chart palette: the threshold is a
                // judgement about health, and blue read as foreign chrome in
                // a mauve-accent shell. Disabling the entry animation also
                // means the first paint is the chart, not an empty grid.
                fill={
                  entry.successRate >= 95 ? 'var(--status-ok)' : 'var(--status-warn)'
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
