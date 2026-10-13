import { useState, useSyncExternalStore } from 'react'
import { Link } from '@tanstack/react-router'
import { m } from '@b2b-saas-starter/i18n/messages'
import { Button } from '@/components/ui/button'
import {
  analyticsConsent,
  saveAnalyticsConsent,
  serverAnalyticsConsent,
  subscribeAnalyticsConsent
} from './analytics-consent'
import { type ClientTelemetryConfig } from './server/telemetry-config'

export function ClientTelemetry({
  config
}: {
  readonly config: ClientTelemetryConfig
}) {
  if (!config.cloudflareWebAnalyticsToken) {
    return null
  }
  return <ConsentControlledAnalytics token={config.cloudflareWebAnalyticsToken} />
}

function ConsentControlledAnalytics({ token }: { readonly token: string }) {
  const choice = useSyncExternalStore(
    subscribeAnalyticsConsent,
    analyticsConsent,
    serverAnalyticsConsent
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [storageFailed, setStorageFailed] = useState(false)
  const visible = choice === 'pending' || settingsOpen || storageFailed

  function choose(next: 'accepted' | 'declined') {
    setStorageFailed(!saveAnalyticsConsent(next))
  }

  if (choice === 'loading') {
    return null
  }

  return (
    <>
      {choice === 'accepted' && !storageFailed ? (
        <script
          async
          src="https://static.cloudflareinsights.com/beacon.min.js"
          data-cf-beacon={JSON.stringify({ token })}
        />
      ) : null}
      {visible ? (
        <section
          aria-labelledby="analytics-consent-title"
          className="fixed inset-x-0 bottom-0 z-50 max-h-dvh overflow-y-auto border-t border-border bg-card px-4 py-5 sm:px-6"
        >
          <div className="mx-auto flex max-w-7xl flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex max-w-prose flex-col gap-2">
              <h2 id="analytics-consent-title" className="text-base font-semibold">
                {m.analytics_consent_title()}
              </h2>
              <p className="text-sm text-muted-foreground">
                {m.analytics_consent_description()}
              </p>
              <p className="text-sm text-muted-foreground">
                {m.analytics_consent_choice_notice()}{' '}
                <Link to="/privacy" className="underline underline-offset-4">
                  {m.privacy()}
                </Link>
              </p>
              {storageFailed ? (
                <p role="alert" className="text-sm text-destructive">
                  {m.analytics_consent_storage_failed()}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="outline" onClick={() => choose('declined')}>
                {m.analytics_consent_decline()}
              </Button>
              <Button variant="outline" onClick={() => choose('accepted')}>
                {m.analytics_consent_allow()}
              </Button>
              {choice !== 'pending' && !storageFailed ? (
                <Button variant="ghost" onClick={() => setSettingsOpen(false)}>
                  {m.common_close()}
                </Button>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
        <div className="fixed bottom-3 left-3 z-40">
          <Button variant="outline" size="xs" onClick={() => setSettingsOpen(true)}>
            {m.analytics_consent_settings()}
          </Button>
        </div>
      )}
    </>
  )
}
