import * as stylex from '@stylexjs/stylex'
import { Schema } from 'effect'
import {
  BOOKING_AVAILABILITY_HORIZON_DAYS,
  BookingAvailability as BookingAvailabilitySchema,
  CheckoutPreparation as CheckoutPreparationSchema,
  TimeSlotHold as TimeSlotHoldSchema,
  type BookingAvailability,
  type CustomerConfirmation,
  type TimeSlotHold
} from '@b2b-saas-starter/capabilities/booking'
import { useEffect, useRef, useState } from 'react'
import { translateBookingMessage } from '../localization/booking-localization.ts'
import { BookingPopupSheet } from '../presentation/booking-primitives.tsx'
import { bookingTheme } from '../presentation/booking-theme.stylex.ts'
import { BookingSchedulingFlow } from './booking-scheduling-flow.tsx'

type RescheduleSession = {
  readonly id: string
  readonly bookingSessionId: string
  readonly capability: string
}

type RescheduleState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready'
      readonly session: RescheduleSession
      readonly availability: BookingAvailability
    }
  | { readonly kind: 'error' }

const createCapability = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')

export function BookingConfirmationReschedulePopup({
  target,
  open,
  confirmation,
  appointment,
  merchantSlug,
  onClose
}: {
  readonly target: HTMLElement | null
  readonly open: boolean
  readonly confirmation: CustomerConfirmation
  readonly appointment: CustomerConfirmation['appointments'][number]
  readonly merchantSlug: string
  readonly onClose: () => void
}) {
  const copy = (key: Parameters<typeof translateBookingMessage>[1]) =>
    translateBookingMessage(confirmation.locale, key)
  const [state, setState] = useState<RescheduleState>({ kind: 'loading' })
  const [selectedStartsAt, setSelectedStartsAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)

  useEffect(() => {
    if (!open) return
    const currentGeneration = ++generation.current
    const controller = new AbortController()
    const capability = createCapability()
    setState({ kind: 'loading' })
    setSelectedStartsAt(null)
    setBusy(false)
    void (async () => {
      try {
        const beginResponse = await fetch(
          `${window.location.pathname}/appointments/${encodeURIComponent(appointment.id)}/reschedule`,
          {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              action: 'begin',
              capability,
              expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
            }),
            signal: controller.signal
          }
        )
        if (!beginResponse.ok) throw new Error('reschedule unavailable')
        const begun = (await beginResponse.json()) as {
          readonly id: string
          readonly bookingSessionId: string
        }
        const availabilityResponse = await fetch(
          `/${encodeURIComponent(merchantSlug)}/booking/session/${encodeURIComponent(begun.bookingSessionId)}/availability?days=${BOOKING_AVAILABILITY_HORIZON_DAYS}`,
          { credentials: 'same-origin', signal: controller.signal }
        )
        if (!availabilityResponse.ok) throw new Error('availability unavailable')
        const availability = Schema.decodeUnknownSync(BookingAvailabilitySchema)(
          await availabilityResponse.json()
        )
        if (generation.current === currentGeneration)
          setState({
            kind: 'ready',
            session: { ...begun, capability },
            availability
          })
      } catch {
        if (!controller.signal.aborted && generation.current === currentGeneration)
          setState({ kind: 'error' })
      }
    })()
    return () => controller.abort()
  }, [appointment.id, merchantSlug, open])

  const selectTime = async (startsAt: string) => {
    if (state.kind !== 'ready') return
    setSelectedStartsAt(startsAt)
    setBusy(true)
    try {
      const response = await fetch(
        `/${encodeURIComponent(merchantSlug)}/booking/session/${encodeURIComponent(state.session.bookingSessionId)}/hold`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ startsAt })
        }
      )
      if (!response.ok) throw new Error('slot unavailable')
      const hold = Schema.decodeUnknownSync(TimeSlotHoldSchema)(await response.json())
      setState((current) =>
        current.kind === 'ready'
          ? {
              ...current,
              availability: { ...current.availability, hold }
            }
          : current
      )
    } catch {
      setSelectedStartsAt(null)
      setState({ kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const confirmTime = async () => {
    if (state.kind !== 'ready' || !state.availability.hold) return
    setBusy(true)
    try {
      const sessionBase = `/${encodeURIComponent(merchantSlug)}/booking/session/${encodeURIComponent(state.session.bookingSessionId)}`
      const prepare = async () => {
        const response = await fetch(`${sessionBase}/checkout-prepare`, {
          credentials: 'same-origin'
        })
        if (!response.ok) throw new Error('reschedule preparation unavailable')
        return Schema.decodeUnknownSync(CheckoutPreparationSchema)(
          await response.json()
        )
      }
      let preparation = await prepare()
      if (!preparation.quote) throw new Error('quote unavailable')
      if (!preparation.quote.acceptedAt) {
        const response = await fetch(`${sessionBase}/quote-accept`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ quoteId: preparation.quote.id })
        })
        if (!response.ok) throw new Error('quote acceptance unavailable')
      }
      if (preparation.policy && !preparation.policyAcceptance) {
        const acceptedPolicy = appointment.snapshot.policyAcceptance
        if (
          !acceptedPolicy ||
          acceptedPolicy.policyId !== preparation.policy.id ||
          acceptedPolicy.disclosure !== preparation.policy.disclosure
        )
          throw new Error('updated policy requires customer review')
        const response = await fetch(`${sessionBase}/policy-accept`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ policyId: preparation.policy.id })
        })
        if (!response.ok) throw new Error('policy acceptance unavailable')
      }
      preparation = await prepare()
      const hold: TimeSlotHold = state.availability.hold
      if (
        !preparation.quote?.acceptedAt ||
        !preparation.policyAcceptance ||
        preparation.quote.totalMinor !== appointment.snapshot.totalMinor
      )
        throw new Error('replacement requires settlement')
      const commandUrl = `${window.location.pathname}/appointments/${encodeURIComponent(appointment.id)}/reschedule`
      const prepareResponse = await fetch(commandUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'prepare',
          sessionId: state.session.id,
          capability: state.session.capability,
          replacement: {
            hold: {
              id: hold.id,
              providerId: hold.quote.assignedProvider.id,
              providerDisplayName: hold.quote.assignedProvider.displayName,
              startsAt: hold.quote.startsAt,
              endsAt: hold.quote.endsAt,
              expiresAt: hold.expiresAt
            },
            quote: {
              id: preparation.quote.id,
              version: preparation.quote.version,
              totalMinor: preparation.quote.totalMinor,
              currency: preparation.quote.currency,
              acceptedAt: preparation.quote.acceptedAt,
              expiresAt: preparation.quote.expiresAt
            },
            policyAcceptance: {
              policyId: preparation.policyAcceptance.policyId,
              policyVersion: preparation.policyAcceptance.version,
              disclosureSnapshot: preparation.policyAcceptance.disclosure,
              acceptedAt: preparation.policyAcceptance.acceptedAt
            },
            settlement: { kind: 'unchanged', amountMinor: 0, referenceId: null },
            reminderAt: null
          }
        })
      })
      if (!prepareResponse.ok) throw new Error('replacement rejected')
      const commitResponse = await fetch(commandUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'commit',
          sessionId: state.session.id,
          capability: state.session.capability,
          idempotencyKey: `reschedule-${crypto.randomUUID()}`
        })
      })
      if (!commitResponse.ok) throw new Error('reschedule failed')
      window.location.reload()
    } catch {
      setState({ kind: 'error' })
      setBusy(false)
    }
  }

  return (
    <BookingPopupSheet
      target={target}
      open={open}
      label={copy('reservation.reschedule')}
      onClose={onClose}
      testId="popup:rescheduleAppointment"
      presenceKey="reschedule-appointment"
      legacyGeometry
      layout="legacyReschedule"
    >
      <section {...stylex.props(styles.root)}>
        <h2 {...stylex.props(styles.title)}>{copy('reservation.reschedule')}</h2>
        <button
          type="button"
          aria-label={copy('action.close')}
          onClick={onClose}
          {...stylex.props(styles.close)}
        >
          <CloseIcon />
        </button>
        {state.kind === 'loading' ? (
          <output {...stylex.props(styles.status)}>
            {copy('scheduling.finding_title')}…
          </output>
        ) : state.kind === 'error' ? (
          <p role="alert" {...stylex.props(styles.status)}>
            {copy('scheduling.unavailable_copy')}
          </p>
        ) : (
          <div {...stylex.props(styles.schedule)}>
            <BookingSchedulingFlow
              embedded
              embeddedVariant="reschedule"
              showOrderBar={false}
              availability={state.availability}
              busy={busy}
              slotLost={false}
              locale={confirmation.locale}
              selectedStartsAt={selectedStartsAt}
              onBack={onClose}
              onSelect={(startsAt) => void selectTime(startsAt)}
            />
          </div>
        )}
        {state.kind === 'ready' && state.availability.hold ? (
          <div {...stylex.props(styles.confirmContainer)}>
            <button
              type="button"
              data-testid="btn:confirm"
              aria-label={copy('reservation.reschedule')}
              disabled={busy}
              onClick={() => void confirmTime()}
              {...stylex.props(styles.confirm)}
            >
              <ConfirmIcon />
            </button>
          </div>
        ) : null}
      </section>
    </BookingPopupSheet>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...stylex.props(styles.closeIcon)}>
      <circle cx="12" cy="12" r="12" fill="#ebebeb" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7.176 15.971a.6.6 0 1 0 .849.849L12 12.846l3.975 3.974a.6.6 0 0 0 .849-.849l-3.975-3.973 3.975-3.974a.6.6 0 1 0-.849-.848L12 11.149 8.025 7.176a.6.6 0 0 0-.849.848l3.975 3.974-3.975 3.973Z"
        fill="currentColor"
      />
    </svg>
  )
}

function ConfirmIcon() {
  return (
    <svg viewBox="0 0 11 8" aria-hidden="true" {...stylex.props(styles.confirmIcon)}>
      <path
        d="m1 4.693 2.333 2.215L9.366 1"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  )
}

const styles = stylex.create({
  root: {
    position: 'relative',
    boxSizing: 'border-box',
    minHeight: '100%',
    padding: 16,
    paddingBottom: 112
  },
  title: {
    margin: 0,
    paddingRight: 32,
    color: bookingTheme.colorPrimaryLabel,
    fontFamily: bookingTheme.fontLegacyDisplay,
    fontSize: 20,
    fontWeight: 600,
    lineHeight: '24px',
    letterSpacing: '0.75px'
  },
  close: {
    position: 'absolute',
    top: 14,
    right: 6,
    display: 'grid',
    width: 44,
    height: 44,
    placeItems: 'center',
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: bookingTheme.colorSecondaryLabel,
    cursor: 'pointer'
  },
  closeIcon: { display: 'block', width: 24, height: 24 },
  status: {
    display: 'block',
    marginBlock: 48,
    color: bookingTheme.colorSecondaryLabel,
    fontFamily: bookingTheme.fontLegacyText,
    fontSize: 15,
    lineHeight: '20px',
    textAlign: 'center'
  },
  schedule: { marginTop: 0 },
  confirmContainer: {
    position: 'fixed',
    zIndex: 2,
    right: 0,
    bottom: 0,
    left: 0,
    display: 'flex',
    width: '100%',
    height: 112,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundImage:
      'linear-gradient(180deg, rgb(247 247 247 / 0%), rgb(247 247 247 / 85%) 80%)',
    pointerEvents: 'none'
  },
  confirm: {
    display: 'grid',
    width: 80,
    height: 80,
    placeItems: 'center',
    padding: 0,
    borderWidth: 0,
    borderRadius: 20,
    backgroundColor: bookingTheme.colorPrimary,
    color: bookingTheme.colorPrimaryFontOnPrimary,
    cursor: 'pointer',
    pointerEvents: 'auto',
    ':disabled': { opacity: 0.6, cursor: 'default' }
  },
  confirmIcon: { display: 'block', width: 24, height: 24 }
})
