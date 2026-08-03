import * as stylex from '@stylexjs/stylex'
import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { ServerBackedBookingFlow } from './server-backed-booking-flow.tsx'
import {
  BookingLocalizationProvider,
  useBookingLocalization
} from '../localization/booking-localization-provider.tsx'
import type { BookingLocale } from '../localization/booking-localization.ts'
import type {
  BookingEmbedding,
  CanonicalBookingRouteKind
} from '../lib/booking-route-contract.ts'
import { BookingShellProvider } from './booking-widget-shell.tsx'
import { styles } from './booking-flow.styles.ts'
import { BookingWidgetMenu } from './booking-widget-menu.tsx'

export function CanonicalBookingShell({
  merchantSlug,
  sessionId,
  locale,
  embedding,
  initialRouteKind
}: {
  readonly merchantSlug: string
  readonly sessionId: string
  readonly locale: BookingLocale
  readonly embedding: BookingEmbedding
  readonly initialRouteKind?: CanonicalBookingRouteKind
}) {
  const [persistingLocale, setPersistingLocale] = useState(false)
  const [widgetMenuOpen, setWidgetMenuOpen] = useState(false)
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
    <BookingShellProvider embedding={embedding}>
      <BookingLocalizationProvider
        sessionLocale={locale}
        onLocaleChange={persistLocale}
      >
        <BookingWidgetMenuPortal
          target={titleActionTarget}
          open={widgetMenuOpen}
          onOpenChange={setWidgetMenuOpen}
        />
        <LocalizedServerBackedBookingFlow
          merchantSlug={merchantSlug}
          sessionId={sessionId}
          {...(initialRouteKind ? { initialRouteKind } : {})}
          onTitleActionMount={setTitleActionTarget}
          onSignIn={() => setWidgetMenuOpen(true)}
        />
        {persistingLocale ? (
          <LocalePersistenceStatus target={titleActionTarget?.parentElement ?? null} />
        ) : null}
      </BookingLocalizationProvider>
    </BookingShellProvider>
  )
}

function BookingWidgetMenuPortal({
  target,
  open,
  onOpenChange
}: {
  readonly target: HTMLDivElement | null
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  return target
    ? createPortal(
        <BookingWidgetMenu open={open} onOpenChange={onOpenChange} />,
        target
      )
    : null
}

function LocalePersistenceStatus({ target }: { readonly target: HTMLElement | null }) {
  const { message } = useBookingLocalization()
  return target
    ? createPortal(
        <output aria-live="polite" {...stylex.props(styles.processingOverlay)}>
          {message('feedback.loading')}
        </output>,
        target
      )
    : null
}

function LocalizedServerBackedBookingFlow({
  merchantSlug,
  sessionId,
  initialRouteKind,
  onTitleActionMount,
  onSignIn
}: {
  readonly merchantSlug: string
  readonly sessionId: string
  readonly initialRouteKind?: CanonicalBookingRouteKind
  readonly onTitleActionMount: (element: HTMLDivElement | null) => void
  readonly onSignIn: () => void
}) {
  const { message } = useBookingLocalization()
  return (
    <ServerBackedBookingFlow
      merchantSlug={merchantSlug}
      sessionId={sessionId}
      {...(initialRouteKind ? { initialRouteKind } : {})}
      onTitleActionMount={onTitleActionMount}
      onSignIn={onSignIn}
      selectionRefreshedMessage={message('feedback.selection_refreshed')}
    />
  )
}
