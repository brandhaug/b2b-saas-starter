import { createClientOnlyFn } from '@tanstack/react-start'
import { useEffect } from 'react'

import { type ClientTelemetryConfig } from './server/telemetry-config'

/**
 * The browser SDK modules, loaded only where they can run. Both are pure
 * client-side — the SSR pass never executes them, and `createClientOnlyFn`
 * swaps each loader for a stub in the server build so the dynamic imports
 * never enter the server graph; without this, the deploy build ships
 * `@sentry/react` and `posthog-js` to the Worker in chunks it can never
 * execute (ADR 0063).
 */
const loadSentry = createClientOnlyFn(async () => {
  const Sentry = await import('@sentry/react')
  return Sentry
})

const loadPosthog = createClientOnlyFn(async () => {
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
  const { sentryDsn, posthogKey, posthogHost } = config
  useEffect(() => {
    let cancelled = false
    async function initializeSentry() {
      if (sentryDsn) {
        const Sentry = await loadSentry()
        if (!cancelled && Sentry.getClient() === undefined) {
          Sentry.init({
            dsn: sentryDsn,
            // 100% traces would sample every browser session — an order of
            // magnitude noisier (and pricier) than the server's per-request
            // sampling. Errors stay at the SDK default (100%).
            tracesSampleRate: 0.1,
            // Session replay stays off until a starter use case asks for it.
            integrations: []
          })
        }
      }
    }
    async function initializePosthog() {
      if (posthogKey) {
        const posthog = await loadPosthog()
        // oxlint-disable-next-line eslint/no-underscore-dangle -- PostHog's own readiness flag
        if (!cancelled && !posthog.__loaded) {
          posthog.init(posthogKey, {
            api_host: posthogHost ?? 'https://us.i.posthog.com',
            capture_pageview: 'history_change',
            capture_pageleave: true,
            persistence: 'localStorage+cookie'
          })
        }
      }
    }
    // oxlint-disable-next-line effect/noNewPromise -- independent browser SDK imports; Effect must stay out of the client bundle
    void Promise.all([initializeSentry(), initializePosthog()])
    return () => {
      cancelled = true
    }
  }, [sentryDsn, posthogKey, posthogHost])
  return null
}
