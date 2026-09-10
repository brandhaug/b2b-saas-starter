import { type WebhookEndpoint } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { formatNumber } from '@b2b-saas-starter/i18n/format'
import { m } from '@b2b-saas-starter/i18n/messages'
import { getLocale } from '@b2b-saas-starter/i18n/runtime'

/** Below this many endpoints a sentence says more than a chart does. */
const MIN_ENDPOINTS_FOR_CHART = 3

export function WebhookSuccessChart({
  webhooks
}: {
  readonly webhooks: ReadonlyArray<WebhookEndpoint>
}) {
  if (webhooks.length === 0) {
    return <p className="text-sm text-muted-foreground">{m.shell_chart_empty()}</p>
  }

  // One or two endpoints are a fact, not a distribution — a single slab
  // filling a card wastes the space and reads as decoration.
  if (webhooks.length < MIN_ENDPOINTS_FOR_CHART) {
    return (
      <ul className="grid gap-1 text-sm">
        {webhooks.map((endpoint) => (
          <li key={endpoint.id} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-xs">{new URL(endpoint.url).host}</span>
            <span className="font-medium">
              {m.shell_chart_delivered({
                percent: formatPercent(endpoint.successRate)
              })}
            </span>
            {endpoint.enabled ? null : (
              <span className="text-xs text-muted-foreground">
                {m.common_disabled()}
              </span>
            )}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <ul className="grid gap-2 text-sm">
      {webhooks.map((endpoint) => {
        const host = new URL(endpoint.url).host
        const percent = formatPercent(endpoint.successRate)
        return (
          <li key={endpoint.id} className="grid gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-mono text-xs">{host}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {percent}
              </span>
            </div>
            {/* The host and its percentage are already text above; the bar
                is the same fact drawn, so it carries no second label. */}
            <div
              aria-hidden
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full"
                style={{
                  // Status hues, not a chart palette: the threshold is a
                  // judgement about health, and blue read as foreign chrome
                  // in a mauve-accent shell.
                  background:
                    endpoint.successRate >= 95
                      ? 'var(--status-ok)'
                      : 'var(--status-warn)',
                  width: `${clampPercent(endpoint.successRate)}%`
                }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

function formatPercent(value: number): string {
  return formatNumber(value / 100, getLocale(), {
    style: 'percent',
    maximumFractionDigits: 2
  })
}
