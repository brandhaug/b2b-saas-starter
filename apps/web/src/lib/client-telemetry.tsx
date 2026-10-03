import { type ClientTelemetryConfig } from './server/telemetry-config'

/** React deduplicates this async script across hydration and SPA navigation. */
export function ClientTelemetry({
  config
}: {
  readonly config: ClientTelemetryConfig
}) {
  if (!config.cloudflareWebAnalyticsToken) {
    return null
  }
  return (
    <script
      async
      src="https://static.cloudflareinsights.com/beacon.min.js"
      data-cf-beacon={JSON.stringify({ token: config.cloudflareWebAnalyticsToken })}
    />
  )
}
