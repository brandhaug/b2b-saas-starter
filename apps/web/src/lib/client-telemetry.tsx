import { useEffect } from 'react'

import { type ClientTelemetryConfig } from './server/telemetry-config'

/**
 * Client-side half of the optional observability providers: initializes the
 * official browser SDKs (`@sentry/react`, `posthog-js`) when — and only when —
 * the server passed a DSN/key through the root route's loader. Unset vars mean
 * neither dynamic import ever executes, so the browser never contacts either
 * vendor on a provider-light deployment.
 *
 * The component itself renders nothing; it exists so the init runs after
 * hydration with the SSR-serialized loader data.
 */
export function ClientTelemetry({
  config
}: {
  readonly config: ClientTelemetryConfig
}) {
  useEffect(() => {
    // Explicit annotation: the cleanup closure mutates this after return, so
    // control-flow analysis must not narrow it to `false`.
    let cancelled: boolean = false
    void (async () => {
      if (config.sentryDsn) {
        const Sentry = await import('@sentry/react')
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- the cleanup closure mutates `cancelled` after this runs
        if (!cancelled && Sentry.getClient() === undefined) {
          Sentry.init({
            dsn: config.sentryDsn,
            // 100% traces would sample every browser session — an order of
            // magnitude noisier (and pricier) than the server's per-request
            // sampling. Errors stay at the SDK default (100%).
            tracesSampleRate: 0.1,
            // Session replay stays off until a starter use case asks for it.
            integrations: []
          })
        }
      }
      if (config.posthogKey) {
        const { default: posthog } = await import('posthog-js')
        // oxlint-disable-next-line eslint/no-underscore-dangle, typescript/no-unnecessary-condition -- PostHog's own readiness flag; the cleanup closure mutates `cancelled` after this runs
        if (!cancelled && !posthog.__loaded) {
          posthog.init(config.posthogKey, {
            api_host: config.posthogHost ?? 'https://us.i.posthog.com',
            capture_pageview: 'history_change',
            capture_pageleave: true,
            persistence: 'localStorage+cookie'
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [config])
  return null
}
