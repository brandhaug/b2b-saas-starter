import { useCallback } from 'react'
import { ServerBackedBookingFlow } from './server-backed-booking-flow.tsx'
import {
  BookingLanguagePicker,
  BookingLocalizationProvider
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
  const persistLocale = useCallback(
    (nextLocale: BookingLocale) => {
      void fetch(
        `/${encodeURIComponent(merchantSlug)}/booking/session/${encodeURIComponent(sessionId)}/context`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ locale: nextLocale, embedding })
        }
      )
      const url = new URL(window.location.href)
      url.searchParams.set('locale', nextLocale)
      window.history.replaceState(window.history.state, '', url)
    },
    [embedding, merchantSlug, sessionId]
  )

  return (
    <div data-booking-shell="canonical" data-embedding={embedding}>
      <BookingLocalizationProvider
        sessionLocale={locale}
        onLocaleChange={persistLocale}
      >
        <BookingLanguagePicker label="Language" />
        <ServerBackedBookingFlow merchantSlug={merchantSlug} sessionId={sessionId} />
      </BookingLocalizationProvider>
    </div>
  )
}
