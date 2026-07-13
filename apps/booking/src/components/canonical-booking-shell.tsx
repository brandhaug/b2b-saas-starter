import { useCallback, useState } from 'react'
import { ServerBackedBookingFlow } from './server-backed-booking-flow.tsx'
import {
  BookingLanguagePicker,
  BookingLocalizationProvider,
  useBookingLocalization
} from '../localization/booking-localization-provider.tsx'
import type { BookingLocale } from '../localization/booking-localization.ts'
import type { BookingEmbedding } from '../lib/booking-route-contract.ts'

export function CanonicalBookingShell({
  merchantSlug,
  sessionId,
  locale,
  embedding
}: {
  readonly merchantSlug: string
  readonly sessionId: string
  readonly locale: BookingLocale
  readonly embedding: BookingEmbedding
}) {
  const [persistingLocale, setPersistingLocale] = useState(false)
  const persistLocale = useCallback(
    (nextLocale: BookingLocale) => {
      setPersistingLocale(true)
      void (async () => {
        try {
          const response = await fetch(
            `/${encodeURIComponent(merchantSlug)}/booking/session/${encodeURIComponent(sessionId)}/context`,
            {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ locale: nextLocale, embedding })
            }
          )
          if (!response.ok)
            throw new Error('Could not persist the Booking Session locale')

          const url = new URL(window.location.href)
          url.searchParams.set('locale', nextLocale)
          window.history.replaceState(window.history.state, '', url)
          setPersistingLocale(false)
        } catch {
          window.location.reload()
        }
      })()
    },
    [embedding, merchantSlug, sessionId]
  )

  return (
    <div
      data-booking-shell="canonical"
      data-embedding={embedding}
      data-booking-embedding={embedding}
      data-scroll-owner={embedding === 'standalone' ? 'document' : 'content'}
    >
      <BookingLocalizationProvider
        sessionLocale={locale}
        onLocaleChange={persistLocale}
      >
        <LocalizedLanguagePicker />
        {persistingLocale ? (
          <LocalePersistenceStatus />
        ) : (
          <LocalizedServerBackedBookingFlow
            merchantSlug={merchantSlug}
            sessionId={sessionId}
          />
        )}
      </BookingLocalizationProvider>
    </div>
  )
}

function LocalizedLanguagePicker() {
  const { message } = useBookingLocalization()
  return <BookingLanguagePicker label={message('label.language')} placement="toolbar" />
}

function LocalePersistenceStatus() {
  const { message } = useBookingLocalization()
  return <output>{message('feedback.loading')}</output>
}

function LocalizedServerBackedBookingFlow({
  merchantSlug,
  sessionId
}: {
  readonly merchantSlug: string
  readonly sessionId: string
}) {
  const { message } = useBookingLocalization()
  return (
    <ServerBackedBookingFlow
      merchantSlug={merchantSlug}
      sessionId={sessionId}
      selectionRefreshedMessage={message('feedback.selection_refreshed')}
    />
  )
}
