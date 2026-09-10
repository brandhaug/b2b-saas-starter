import { sentryPrivacyOptions } from '@b2b-saas-starter/logger/sanitization'
import { useRouter } from '@tanstack/react-router'
import { createClientOnlyFn } from '@tanstack/react-start'
import { useEffect } from 'react'

import { type ClientTelemetryConfig } from './server/telemetry-config'

/**
 * The Sentry browser SDK, loaded only where it can run. It is pure
 * client-side — the SSR pass never executes it, and `createClientOnlyFn`
 * swaps the loader for a stub in the server build so the dynamic import
 * never enters the server graph; without this, the deploy build ships
 * `@sentry/react` to the Worker in a chunk it can never execute (ADR 0063).
 */
const loadSentry = createClientOnlyFn(async () => {
  const Sentry = await import('@sentry/react')
  return Sentry
})

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'

/**
 * The two page events, posted straight to PostHog's ingestion endpoint. The
 * vendor SDK exists to autocapture, identify and flag, all of which this app
 * turns off, so a beacon carries the same payload without the bundle.
 *
 * `distinct_id` is a fresh UUID per event: correlation within one payload,
 * never a user or device identity, and `$process_person_profile: false`
 * keeps ingestion from building a person out of it.
 */
function capturePageEvent(
  host: string,
  apiKey: string,
  event: '$pageview' | '$pageleave'
): void {
  const url = `${host.replace(/\/+$/u, '')}/i/v0/e/`
  const body = JSON.stringify({
    api_key: apiKey,
    event,
    distinct_id: crypto.randomUUID(),
    properties: { $process_person_profile: false },
    timestamp: new Date().toISOString()
  })
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- browser capability probe: jsdom and pre-2017 browsers have no `sendBeacon`
  if (typeof navigator.sendBeacon === 'function') {
    navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
    return
  }
  // `keepalive` so the unload-time `$pageleave` survives the navigation.
  void fetch(url, {
    method: 'POST',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body
  }).catch(() => undefined)
}

/**
 * Client-side half of the optional observability providers: initializes the
 * Sentry browser SDK and posts page analytics when — and only when — the
 * server passed a DSN/key through the root route's loader. Unset vars mean
 * nothing loads and nothing is sent, so the browser never contacts either
 * vendor on a provider-light deployment.
 *
 * The component itself renders nothing; it exists so the work runs after
 * hydration with the SSR-serialized loader data.
 */
export function ClientTelemetry({
  config
}: {
  readonly config: ClientTelemetryConfig
}) {
  const { sentryDsn, posthogKey, posthogHost } = config
  const router = useRouter()

  useEffect(() => {
    if (!sentryDsn) {
      return
    }
    let cancelled = false
    async function initializeSentry(dsn: string) {
      const Sentry = await loadSentry()
      if (!cancelled && Sentry.getClient() === undefined) {
        Sentry.init({
          dsn,
          ...sentryPrivacyOptions,
          // Session replay stays off until a starter use case asks for it.
          integrations: []
        })
      }
    }
    void initializeSentry(sentryDsn)
    return () => {
      cancelled = true
    }
  }, [sentryDsn])

  // oxlint-disable-next-line react-doctor/no-fetch-in-effect -- fire-and-forget analytics beacons, not a read the UI renders
  useEffect(() => {
    if (!posthogKey) {
      return
    }
    const host = posthogHost ?? DEFAULT_POSTHOG_HOST
    const apiKey: string = posthogKey
    // One open view at a time: every `$pageview` is closed by exactly one
    // `$pageleave`, whether the view ends in a client-side navigation, a
    // closed tab, or an unmount.
    let viewing = false
    function leave() {
      if (viewing) {
        viewing = false
        capturePageEvent(host, apiKey, '$pageleave')
      }
    }
    function view() {
      leave()
      viewing = true
      capturePageEvent(host, apiKey, '$pageview')
    }
    view()
    const unsubscribe = router.subscribe('onResolved', view)
    window.addEventListener('pagehide', leave)
    return () => {
      unsubscribe()
      window.removeEventListener('pagehide', leave)
      leave()
    }
  }, [router, posthogKey, posthogHost])

  return null
}
