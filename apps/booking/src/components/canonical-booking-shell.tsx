import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
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
  const [titleActionTarget, setTitleActionTarget] = useState<HTMLDivElement | null>(
    null
  )
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
    <BookingLocalizationProvider sessionLocale={locale} onLocaleChange={persistLocale}>
      <LocalizedLanguagePicker target={titleActionTarget} />
      {persistingLocale ? (
        <LocalePersistenceStatus />
      ) : (
        <LocalizedServerBackedBookingFlow
          merchantSlug={merchantSlug}
          sessionId={sessionId}
          embedding={embedding}
          onTitleActionMount={setTitleActionTarget}
        />
      )}
    </BookingLocalizationProvider>
  )
}

function LocalizedLanguagePicker({
  target
}: {
  readonly target: HTMLDivElement | null
}) {
  const { message } = useBookingLocalization()
  const picker = (
    <BookingLanguagePicker
      label={message('label.language')}
      placement={target ? 'title' : 'toolbar'}
    />
  )
  return target ? createPortal(picker, target) : picker
}

function LocalePersistenceStatus() {
  const { message } = useBookingLocalization()
  return <output>{message('feedback.loading')}</output>
}

function LocalizedServerBackedBookingFlow({
  merchantSlug,
  sessionId,
  embedding,
  onTitleActionMount
}: {
  readonly merchantSlug: string
  readonly sessionId: string
  readonly embedding: BookingEmbedding
  readonly onTitleActionMount: (element: HTMLDivElement | null) => void
}) {
  const { message } = useBookingLocalization()
  return (
    <ServerBackedBookingFlow
      merchantSlug={merchantSlug}
      sessionId={sessionId}
      embedding={embedding}
      onTitleActionMount={onTitleActionMount}
      selectionRefreshedMessage={message('feedback.selection_refreshed')}
    />
  )
}
