import { createIsomorphicFn } from '@tanstack/react-start'
import { useEffect } from 'react'

import { type ClientTelemetryConfig } from './server/telemetry-config'

/**
 * The browser SDK modules, loaded only where they can run. Both are pure
 * client-side — the SSR pass never executes them — so the `.server` halves
 * are an explicit none and the compiler strips the dynamic imports from the
 * server bundle; without this, the deploy build ships `@sentry/react` and
 * `posthog-js` to the Worker in chunks it can never execute.
 */
const loadSentry = createIsomorphicFn()
  .server(() => undefined)
  .client(async () => {
    const Sentry = await import('@sentry/react')
    return Sentry
  })

const loadPosthog = createIsomorphicFn()
  .server(() => undefined)
  .client(async () => {
    const posthogModule = await import('posthog-js')
    return posthogModule.default
  })

/**
 * Client-side half of the optional observability providers: initializes the
 * official browser SDKs (`@sentry/react`, `posthog-js`) when — and only when —
 * the server passed a DSN/key through the root route's loader. Unset vars mean
 * neither loader ever resolves, so the browser never contacts either vendor on
 * a provider-light deployment.
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
        const Sentry = await loadSentry()
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- the cleanup closure mutates `cancelled` after this runs
        if (Sentry && !cancelled && Sentry.getClient() === undefined) {
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
        const posthog = await loadPosthog()
        // oxlint-disable-next-line eslint/no-underscore-dangle, typescript/no-unnecessary-condition -- PostHog's own readiness flag; the cleanup closure mutates `cancelled` after this runs
        if (posthog && !cancelled && !posthog.__loaded) {
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
