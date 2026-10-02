import { createClientOnlyFn } from '@tanstack/react-start'
import { useEffect } from 'react'

import { type ClientTelemetryConfig } from './server/telemetry-config'

const loadPosthog = createClientOnlyFn(async () => {
  const posthogModule = await import('posthog-js')
  return posthogModule.default
})

/** Initializes optional browser analytics after hydration. */
export function ClientTelemetry({
  config
}: {
  readonly config: ClientTelemetryConfig
}) {
  const { posthogKey, posthogHost } = config
  useEffect(() => {
    let cancelled = false
    async function initializePosthog() {
      if (posthogKey) {
        const posthog = await loadPosthog()
        // oxlint-disable-next-line eslint/no-underscore-dangle -- PostHog's own readiness flag
        if (!cancelled && !posthog.__loaded) {
          posthog.init(posthogKey, {
            api_host: posthogHost ?? 'https://us.i.posthog.com',
            autocapture: false,
            capture_pageview: 'history_change',
            capture_pageleave: true,
            capture_exceptions: false,
            disable_session_recording: true,
            person_profiles: 'never',
            persistence: 'memory',
            advanced_disable_flags: true,
            disable_external_dependency_loading: true,
            before_send: (event) => {
              if (event?.event !== '$pageview' && event?.event !== '$pageleave') {
                return null
              }
              // Per-event correlation, never a user/device identity. The project
              // token is required by ingestion; every data property is rebuilt.
              return {
                event: event.event,
                uuid: event.uuid,
                properties: {
                  token: posthogKey,
                  distinct_id: event.uuid,
                  $process_person_profile: false
                }
              }
            }
          })
        }
      }
    }
    void initializePosthog()
    return () => {
      cancelled = true
    }
  }, [posthogKey, posthogHost])
  return null
}
