import * as stylex from '@stylexjs/stylex'
import { Schema } from 'effect'
import { AnimatePresence, LazyMotion, domAnimation, m } from 'motion/react'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { BookingIcon } from '../presentation/booking-icon.tsx'
import {
  clearBookingProcessingSuccess,
  readBookingProcessingSuccess
} from '../lib/booking-processing-transition.ts'
import type { BookingEmbedding } from '../lib/booking-route-contract.ts'
import {
  BookingConfirmationPresentation,
  type BookingConfirmationPresentation as BookingConfirmationPresentationData
} from '../lib/booking-confirmation-presentation.ts'
import {
  translateBookingMessage,
  type BookingLocale
} from '../localization/booking-localization.ts'
import { BookingLocalizationProvider } from '../localization/booking-localization-provider.tsx'
import { BookingPopupSheet } from '../presentation/booking-primitives.tsx'
import { BookingPremiumThemeBoundary } from '../presentation/booking-premium-theme.tsx'
import { BookingConfirmationReschedulePopup } from './booking-confirmation-reschedule-popup.tsx'
import {
  BookingLegacyProcessingOverlay,
  BookingShellProvider,
  BookingWidgetShell
} from './booking-widget-shell.tsx'
import { confirmationStyles as styles } from './booking-confirmation-flow.styles.ts'

type ConfirmationState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'found'
      readonly confirmation: BookingConfirmationPresentationData
    }
  | { readonly kind: 'error'; readonly message: string }

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

const legacyProviderShortName = (name: string) => {
  const [firstName = '', ...lastNameParts] = name.trim().split(/\s+/)
  const lastName = lastNameParts.join(' ')
  if (!firstName || !lastName) return firstName || lastName
  if (/^[\p{L}]\.$/u.test(lastName)) return `${firstName} ${lastName}`
  return `${firstName} ${lastName[0]}.`
}

const legacyCurrency = (locale: BookingLocale, amountMinor: number, currency: string) =>
  new Intl.NumberFormat(locale === 'fr' ? 'fr-CA' : 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(amountMinor / 100)

const ordinal = (day: number) => {
  if (day >= 11 && day <= 13) return `${day}th`
  if (day % 10 === 1) return `${day}st`
  if (day % 10 === 2) return `${day}nd`
  if (day % 10 === 3) return `${day}rd`
  return `${day}th`
}

const reservationDateTime = (
  locale: BookingLocale,
  instant: string,
  timeZone: string,
  at: string
) => {
  const date = new Date(instant)
  const dateParts = new Intl.DateTimeFormat(locale, {
    timeZone,
    month: 'short',
    day: 'numeric'
  }).formatToParts(date)
  const day = Number(dateParts.find((part) => part.type === 'day')?.value)
  const month = dateParts.find((part) => part.type === 'month')?.value ?? ''
  const formattedDate = locale === 'en' ? `${month} ${ordinal(day)}` : `${day} ${month}`
  const time = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit'
  })
    .format(date)
    .replace(/\s([AP]M)$/i, '$1')
  return `${formattedDate}\u00a0${at}\u00a0${time}`
}

const safeImageUrl = (value: string | undefined) => {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

const calendarUrl = (target: {
  readonly confirmation: {
    readonly merchantSlug: string
    readonly routeId: string
    readonly appointmentId: string
  }
}) => {
  return `/${encodeURIComponent(target.confirmation.merchantSlug)}/booking/confirmations/${encodeURIComponent(target.confirmation.routeId)}/appointments/${encodeURIComponent(target.confirmation.appointmentId)}/calendar.ics`
}

export function BookingConfirmationRouteFlow({
  merchantSlug,
  routeId,
  embedding
}: {
  readonly merchantSlug: string
  readonly routeId: string
  readonly embedding: BookingEmbedding
}) {
  const [state, setState] = useState<ConfirmationState>({ kind: 'loading' })
  const [processingSuccess, setProcessingSuccess] = useState(() =>
    readBookingProcessingSuccess()
  )

  useEffect(() => {
    if (!processingSuccess) return
    const remaining = processingSuccess.expiresAt - Date.now()
    if (remaining <= 0) {
      clearBookingProcessingSuccess()
      setProcessingSuccess(null)
      return
    }
    const timer = window.setTimeout(() => {
      clearBookingProcessingSuccess()
      setProcessingSuccess(null)
    }, remaining)
    return () => window.clearTimeout(timer)
  }, [processingSuccess])

  useEffect(() => {
    const controller = new AbortController()
    void fetch(
      `/${encodeURIComponent(merchantSlug)}/booking/confirmations/${encodeURIComponent(routeId)}/data`,
      { credentials: 'same-origin', signal: controller.signal }
    )
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null)
        if (!response.ok) {
          const message =
            body &&
            typeof body === 'object' &&
            'copy' in body &&
            typeof body.copy === 'string'
              ? body.copy
              : translateBookingMessage('en', 'recovery.booking_not_found_copy')
          throw new Error(message)
        }
        setState({
          kind: 'found',
          confirmation: Schema.decodeUnknownSync(BookingConfirmationPresentation)(body)
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          kind: 'error',
          message:
            error instanceof Error
              ? error.message
              : translateBookingMessage('en', 'recovery.booking_not_found_copy')
        })
      })
    return () => controller.abort()
  }, [merchantSlug, routeId])

  const locale = state.kind === 'found' ? state.confirmation.locale : 'en'
  return (
    <BookingShellProvider embedding={embedding}>
      <BookingLocalizationProvider sessionLocale={locale}>
        <BookingPremiumThemeBoundary palette={null}>
          <BookingWidgetShell>
            {state.kind === 'found' ? (
              <BookingConfirmationView
                confirmation={state.confirmation}
                merchantSlug={merchantSlug}
              />
            ) : state.kind === 'error' ? (
              <p role="alert" {...stylex.props(styles.error)}>
                {state.message}
              </p>
            ) : null}
            <BookingLegacyProcessingOverlay
              state={processingSuccess ? 'success' : 'hidden'}
              pendingLabel=""
              successLabel={processingSuccess?.label ?? ''}
            />
          </BookingWidgetShell>
        </BookingPremiumThemeBoundary>
      </BookingLocalizationProvider>
    </BookingShellProvider>
  )
}

function BookingConfirmationView({
  confirmation,
  merchantSlug
}: {
  readonly confirmation: BookingConfirmationPresentationData
  readonly merchantSlug: string
}) {
  const locale = confirmation.locale
  const copy = (key: Parameters<typeof translateBookingMessage>[1]) =>
    translateBookingMessage(locale, key)
  const isGroup = confirmation.appointments.length > 1
  const hasCancelled = confirmation.appointments.some(
    (appointment) => appointment.status === 'cancelled'
  )
  const allCancelled = confirmation.appointments.every(
    (appointment) => appointment.status === 'cancelled'
  )
  const allScheduled = confirmation.appointments.every(
    (appointment) => appointment.status === 'scheduled'
  )
  const aggregateStatus = confirmation.appointments.every(
    (appointment) => appointment.status === confirmation.appointments[0]?.status
  )
    ? confirmation.appointments[0]?.status
    : undefined
  const customerFirstName = confirmation.customerFirstName
  const headingKey = allCancelled
    ? isGroup
      ? 'reservation.heading_group_cancelled'
      : 'reservation.heading_cancelled'
    : isGroup && hasCancelled
      ? 'reservation.heading_group_mixed'
      : isGroup
        ? 'reservation.heading_group'
        : 'reservation.heading'
  const heading = copy(headingKey).replace('{name}', customerFirstName)
  const statusKey = {
    scheduled: 'status.appointment_scheduled',
    completed: 'status.appointment_completed',
    cancelled: 'status.appointment_cancelled',
    no_show: 'status.appointment_no_show'
  } as const
  const [scrolled, setScrolled] = useState(false)
  const [popupOpen, setPopupOpen] = useState(false)
  const [cancelAppointmentId, setCancelAppointmentId] = useState<string | null>(null)
  const [rescheduleAppointmentId, setRescheduleAppointmentId] = useState<string | null>(
    null
  )
  const [popupTarget, setPopupTarget] = useState<HTMLDivElement | null>(null)
  const [mutation, setMutation] = useState<'idle' | 'pending' | 'failed'>('idle')
  const groupTotal = confirmation.appointments.reduce(
    (total, appointment) => total + appointment.snapshot.totalMinor,
    0
  )
  const imageUrl = useMemo(
    () => safeImageUrl(confirmation.shop.coverPhotoUrl),
    [confirmation.shop.coverPhotoUrl]
  )
  const shopAddress = confirmation.shop.addressLines?.join(', ') ?? ''
  const directionsQuery = confirmation.shop.coordinates
    ? `${confirmation.shop.coordinates.latitude},${confirmation.shop.coordinates.longitude}`
    : shopAddress
  const cancelPath = cancelAppointmentId
    ? `/appointments/${encodeURIComponent(cancelAppointmentId)}/cancel`
    : isGroup
      ? '/cancel'
      : `/appointments/${encodeURIComponent(confirmation.appointments[0]?.id ?? '')}/cancel`
  const cancelTitle =
    cancelAppointmentId === null
      ? copy('reservation.cancel_title')
      : copy('reservation.cancel')
  const cancelCopy =
    cancelAppointmentId === null
      ? copy('reservation.cancel_copy')
      : copy('reservation.cancel_appointment_copy')

  const cancel = async () => {
    setMutation('pending')
    try {
      const response = await fetch(`${window.location.pathname}${cancelPath}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: `cancel-${crypto.randomUUID()}`,
          reason: 'customer_requested'
        })
      })
      if (!response.ok) throw new Error('cancel failed')
      window.location.reload()
    } catch {
      setMutation('failed')
    }
  }

  return (
    <>
      <div
        data-testid="container:title"
        {...stylex.props(styles.title, scrolled && styles.titleScrolled)}
      >
        <div {...stylex.props(styles.titleContent)}>
          <ConfirmationIcon cancelled={allCancelled} />
          <span
            data-testid="text:apptConfirmationTitle"
            {...stylex.props(styles.titleText)}
          >
            {heading}
          </span>
        </div>
        {aggregateStatus ? (
          <span
            data-testid="text:confirmationStatus"
            {...stylex.props(styles.visuallyHidden)}
          >
            {copy(statusKey[aggregateStatus])}
          </span>
        ) : null}
      </div>

      <div {...stylex.props(styles.contentFrame)}>
        <div
          data-testid="container:scrollable"
          onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
          {...stylex.props(styles.scrollable)}
        >
          <div {...stylex.props(styles.scrollSentinel)} />
          {confirmation.appointments.map((appointment) => (
            <AppointmentCard
              key={appointment.id}
              appointment={appointment}
              confirmation={confirmation}
              merchantSlug={merchantSlug}
              cancelled={appointment.status === 'cancelled'}
              scheduled={appointment.status === 'scheduled'}
              group={isGroup}
              onReschedule={() => setRescheduleAppointmentId(appointment.id)}
              onCancel={() => {
                setCancelAppointmentId(appointment.id)
                setPopupOpen(true)
              }}
            />
          ))}
          {isGroup ? (
            <div {...stylex.props(styles.totalRow, styles.groupTotal)}>
              <span>{copy('reservation.total')}</span>
              <span data-testid="text:total">
                {legacyCurrency(locale, groupTotal, confirmation.snapshot.currency)}
              </span>
            </div>
          ) : null}
          {allCancelled && !isGroup ? (
            <section {...stylex.props(styles.scheduleAnotherWrapper)}>
              <button
                type="button"
                data-testid="btn:scheduleAnother"
                onClick={() =>
                  window.location.assign(`/${encodeURIComponent(merchantSlug)}/booking`)
                }
                {...stylex.props(styles.actionButton, styles.primaryAction)}
              >
                {copy('reservation.schedule_another')}
              </button>
            </section>
          ) : null}
          <section {...stylex.props(styles.shop)}>
            <div
              style={
                imageUrl
                  ? ({
                      backgroundImage: `url(${JSON.stringify(imageUrl)})`
                    } as CSSProperties)
                  : undefined
              }
              {...stylex.props(styles.shopCover, !imageUrl && styles.shopPlaceholder)}
            >
              <span {...stylex.props(styles.shopPin)} />
            </div>
            <div {...stylex.props(styles.shopCopy)}>
              <p data-testid="text:shopName" {...stylex.props(styles.shopName)}>
                {confirmation.shop.publicName}
              </p>
              {shopAddress ? (
                <p data-testid="text:shopAddress" {...stylex.props(styles.shopAddress)}>
                  {shopAddress}
                </p>
              ) : null}
              {directionsQuery ? (
                <button
                  type="button"
                  data-testid="btn:getDirections"
                  onClick={() =>
                    window.open(
                      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(directionsQuery)}`,
                      '_blank',
                      'noopener,noreferrer'
                    )
                  }
                  {...stylex.props(styles.directions)}
                >
                  <p {...stylex.props(styles.directionsText)}>
                    {copy('reservation.get_directions')}
                  </p>
                </button>
              ) : null}
            </div>
          </section>
          <hr {...stylex.props(styles.reservationDivider)} />
          {confirmation.snapshot.checkoutPath === 'pay_in_person' ? (
            <PayInPerson confirmation={confirmation} />
          ) : null}
          {allScheduled ? (
            <section {...stylex.props(styles.actions)}>
              {!isGroup ? (
                <button
                  type="button"
                  data-testid="btn:reschedule"
                  disabled={mutation === 'pending'}
                  onClick={() =>
                    setRescheduleAppointmentId(
                      confirmation.appointments.find(
                        (appointment) => appointment.status === 'scheduled'
                      )?.id ?? null
                    )
                  }
                  {...stylex.props(styles.actionButton)}
                >
                  {copy('reservation.reschedule')}
                </button>
              ) : null}
              <button
                type="button"
                data-testid="btn:cancel"
                disabled={mutation === 'pending'}
                onClick={() => setPopupOpen(true)}
                {...stylex.props(
                  styles.actionButton,
                  !isGroup && styles.actionSpacing,
                  styles.dangerAction
                )}
              >
                {copy('reservation.cancel')}
              </button>
            </section>
          ) : null}
        </div>
      </div>

      <div
        ref={setPopupTarget}
        data-testid="reservation-popup-root"
        {...stylex.props(
          styles.popupMount,
          (popupOpen || rescheduleAppointmentId !== null) && styles.popupMountOpen
        )}
      />
      <BookingConfirmationReschedulePopup
        target={popupTarget}
        open={rescheduleAppointmentId !== null}
        confirmation={confirmation}
        appointment={
          confirmation.appointments.find(
            (appointment) => appointment.id === rescheduleAppointmentId
          ) ?? confirmation.appointments[0]!
        }
        merchantSlug={merchantSlug}
        onClose={() => setRescheduleAppointmentId(null)}
      />
      <BookingPopupSheet
        target={popupTarget}
        open={popupOpen}
        label={cancelTitle}
        onClose={() => {
          setPopupOpen(false)
          setCancelAppointmentId(null)
        }}
        testId="popup:cancelAppointment"
        presenceKey="cancel-appointment"
        legacyGeometry
        header={
          <div {...stylex.props(styles.popupHeader)}>
            <h2 {...stylex.props(styles.popupTitle)}>{cancelTitle}</h2>
            <button
              type="button"
              aria-label={copy('action.close')}
              onClick={() => {
                setPopupOpen(false)
                setCancelAppointmentId(null)
              }}
              {...stylex.props(styles.popupClose)}
            >
              <CloseIcon />
            </button>
          </div>
        }
      >
        <div {...stylex.props(styles.popupBody)}>
          <p {...stylex.props(styles.popupCopy)}>{cancelCopy}</p>
          <button
            type="button"
            data-testid="button:confirmCancel"
            disabled={mutation === 'pending'}
            onClick={() => void cancel()}
            {...stylex.props(styles.actionButton, styles.popupPrimary)}
          >
            {copy('reservation.cancel_confirm')}
          </button>
          <button
            type="button"
            data-testid="button:discardCancel"
            onClick={() => {
              setPopupOpen(false)
              setCancelAppointmentId(null)
            }}
            {...stylex.props(styles.actionButton, styles.popupSecondary)}
          >
            {copy('reservation.cancel_keep')}
          </button>
          <output aria-live="polite" {...stylex.props(styles.popupStatus)}>
            {mutation === 'failed' ? copy('confirmation.cancel_failed') : ''}
          </output>
        </div>
      </BookingPopupSheet>
    </>
  )
}

function AppointmentCard({
  appointment,
  confirmation,
  merchantSlug,
  cancelled,
  scheduled,
  group,
  onReschedule,
  onCancel
}: {
  readonly appointment: BookingConfirmationPresentationData['appointments'][number]
  readonly confirmation: BookingConfirmationPresentationData
  readonly merchantSlug: string
  readonly cancelled: boolean
  readonly scheduled: boolean
  readonly group: boolean
  readonly onReschedule: () => void
  readonly onCancel: () => void
}) {
  const locale = confirmation.locale
  const copy = (key: Parameters<typeof translateBookingMessage>[1]) =>
    translateBookingMessage(locale, key)
  const snapshot = appointment.snapshot
  const primaryService =
    snapshot.services.find((service) => service.role === 'primary') ??
    snapshot.services[0]
  const additions = snapshot.services.filter((service) => service.role === 'additional')
  const servicesTotal = snapshot.services.reduce(
    (total, service) => total + service.priceMinor,
    0
  )
  const showServicePrice = additions.length > 0 || snapshot.totalMinor !== servicesTotal
  const confirmationCode = appointment.id.replace(/^apt_/, '').slice(-8).toUpperCase()
  const time = reservationDateTime(
    locale,
    appointment.startsAt,
    snapshot.merchantTimezone,
    copy('label.appointment_at')
  )
  const providerName = legacyProviderShortName(snapshot.assignedProvider.displayName)
  const appointmentStatus = copy(
    {
      scheduled: 'status.appointment_scheduled',
      completed: 'status.appointment_completed',
      cancelled: 'status.appointment_cancelled',
      no_show: 'status.appointment_no_show'
    }[appointment.status] as Parameters<typeof copy>[0]
  )

  return (
    <section
      data-testid="container:orderApptGroup"
      {...stylex.props(styles.orderAppointment)}
    >
      <div data-testid="container:groupAppt" {...stylex.props(styles.appointmentCard)}>
        <div {...stylex.props(styles.barberAndService)}>
          <div {...stylex.props(styles.avatarWrapper)}>
            <div {...stylex.props(styles.avatar)}>
              <p {...stylex.props(styles.avatarInitials)}>
                {initials(snapshot.assignedProvider.displayName)}
              </p>
            </div>
          </div>
          <div {...stylex.props(styles.barberNameWrapper)}>
            <p data-testid="text:barberName" {...stylex.props(styles.primaryText)}>
              {providerName}
            </p>
          </div>
          <div {...stylex.props(styles.totalPriceWrapper)}>
            <p
              data-testid="text:barberTotal"
              {...stylex.props(styles.primaryText, styles.totalText)}
            >
              {legacyCurrency(locale, snapshot.totalMinor, snapshot.currency)}
            </p>
          </div>
          <div {...stylex.props(styles.serviceNameWrapper)}>
            {primaryService ? (
              <div
                data-testid={`service:${primaryService.id}`}
                {...stylex.props(styles.serviceLine)}
              >
                <div {...stylex.props(styles.serviceLabelWrapper)}>
                  <p
                    data-testid="text:serviceName"
                    {...stylex.props(styles.secondaryText)}
                  >
                    {primaryService.name}
                  </p>
                </div>
                {showServicePrice ? (
                  <p
                    data-testid="text:servicePrice"
                    {...stylex.props(styles.secondaryText, styles.secondaryPrice)}
                  >
                    {legacyCurrency(
                      locale,
                      primaryService.priceMinor,
                      primaryService.currency
                    )}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div
          {...stylex.props(
            styles.serviceAddonsWrapper,
            additions.length > 0 && styles.serviceAddonsWrapperPopulated
          )}
        >
          {additions.map((service) => (
            <div key={service.id} {...stylex.props(styles.addon)}>
              <span>+ {service.name}</span>
              <span>
                {legacyCurrency(locale, service.priceMinor, service.currency)}
              </span>
            </div>
          ))}
        </div>
        <div {...stylex.props(styles.serviceTimeWrapper)} />
      </div>
      <div {...stylex.props(styles.breakdown)}>
        <div {...stylex.props(styles.row)}>
          <span>{copy('reservation.status')}</span>
          <span data-testid={`text:status:${appointment.id}`}>{appointmentStatus}</span>
        </div>
        {!cancelled ? (
          <div {...stylex.props(styles.row)}>
            <span>{copy('reservation.confirmation_code')}</span>
            <strong
              data-testid="text:confirmationCode"
              {...stylex.props(styles.confirmationCode)}
            >
              {confirmationCode}
            </strong>
          </div>
        ) : null}
        <div {...stylex.props(styles.row)}>
          <span>{copy('label.duration')}</span>
          <span data-testid="text:duration">{snapshot.durationMinutes} min</span>
        </div>
        <div {...stylex.props(styles.row)}>
          <span>{copy('label.time')}</span>
          {scheduled ? (
            <button
              type="button"
              data-testid="btn:time"
              onClick={onReschedule}
              {...stylex.props(styles.appointmentTime, styles.appointmentTimeAction)}
            >
              {time}
            </button>
          ) : (
            <time
              data-testid="btn:time"
              dateTime={appointment.startsAt}
              {...stylex.props(styles.appointmentTime)}
            >
              {time}
            </time>
          )}
        </div>
      </div>
      {scheduled ? (
        <div {...stylex.props(styles.calendar)}>
          <p {...stylex.props(styles.calendarLabel)}>
            {copy('reservation.add_to_calendar')}
          </p>
          <div {...stylex.props(styles.calendarActions)}>
            {(['apple'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                data-testid={`btn:calendar:${kind}`}
                aria-label="iCalendar"
                onClick={() =>
                  window.open(
                    calendarUrl({
                      confirmation: {
                        merchantSlug,
                        routeId: confirmation.routeId,
                        appointmentId: appointment.id
                      }
                    }),
                    '_blank',
                    'noopener,noreferrer'
                  )
                }
                {...stylex.props(styles.calendarButton)}
              >
                <CalendarIcon />
              </button>
            ))}
          </div>
          {group ? (
            <button
              type="button"
              data-testid={`btn:cancel:${appointment.id}`}
              onClick={onCancel}
              {...stylex.props(styles.actionButton, styles.dangerAction)}
            >
              {copy('reservation.cancel')}
            </button>
          ) : null}
        </div>
      ) : null}
      {!group ? (
        <>
          <hr {...stylex.props(styles.divider)} />
          <div {...stylex.props(styles.totalRow)}>
            <span>{copy('reservation.total')}</span>
            <span data-testid="text:total">
              {legacyCurrency(locale, snapshot.totalMinor, snapshot.currency)}
            </span>
          </div>
          <TaxesAndFeesExpandable
            label={copy('reservation.including_taxes')}
            adjustments={appointment.adjustments}
            currency={snapshot.currency}
            locale={locale}
            taxLabel={copy('reservation.taxes')}
            feeLabel={copy('reservation.booking_fee')}
          />
        </>
      ) : null}
    </section>
  )
}

function TaxesAndFeesExpandable({
  label,
  adjustments,
  currency,
  locale,
  taxLabel,
  feeLabel
}: {
  readonly label: string
  readonly adjustments: BookingConfirmationPresentationData['appointments'][number]['adjustments']
  readonly currency: string
  readonly locale: BookingLocale
  readonly taxLabel: string
  readonly feeLabel: string
}) {
  const [expanded, setExpanded] = useState(false)
  const visibleAdjustments = (['tax', 'fee'] as const)
    .map((kind) => ({
      kind,
      amountMinor: adjustments
        .filter((adjustment) => adjustment.kind === kind)
        .reduce((total, adjustment) => total + adjustment.amountMinor, 0)
    }))
    .filter((adjustment) => adjustment.amountMinor !== 0)

  return (
    <LazyMotion features={domAnimation} strict>
      <AnimatePresence initial>
        {!expanded ? (
          <m.div
            key="taxes-and-fees-toggler"
            initial={{ height: 0, opacity: 1, overflow: 'hidden' }}
            animate={{
              height: 'auto',
              opacity: 1,
              transitionEnd: { overflow: 'unset' }
            }}
            exit={{ height: 0, opacity: 1, overflow: 'hidden' }}
            transition={{ times: [0, 0.99, 1], duration: 0.15 }}
          >
            <button
              type="button"
              data-testid="unfold:taxes-n-fees"
              onClick={() => setExpanded(true)}
              {...stylex.props(styles.taxesToggle)}
            >
              {label}
              <BookingIcon
                iconRole="navigation-back"
                {...stylex.props(styles.taxesChevron)}
              />
            </button>
          </m.div>
        ) : (
          <m.div
            key="taxes-and-fees-breakdown"
            initial={{ height: 0, opacity: 1, overflow: 'hidden' }}
            animate={{
              height: 'auto',
              opacity: 1,
              transitionEnd: { overflow: 'unset' }
            }}
            exit={{ height: 0, opacity: 1, overflow: 'hidden' }}
            transition={{ times: [0, 0.99, 1], duration: 0.15 }}
          >
            <div {...stylex.props(styles.taxesBreakdown)}>
              {visibleAdjustments.map((adjustment, index) => (
                <div
                  key={adjustment.kind}
                  {...stylex.props(
                    styles.taxesEntry,
                    index === visibleAdjustments.length - 1 && styles.taxesEntryLast
                  )}
                >
                  <p {...stylex.props(styles.taxesEntryText)}>
                    {adjustment.kind === 'tax' ? taxLabel : feeLabel}
                  </p>
                  <p
                    data-testid={
                      adjustment.kind === 'tax' ? 'text:taxes' : 'text:bookingFee'
                    }
                    {...stylex.props(styles.taxesEntryText)}
                  >
                    {legacyCurrency(locale, adjustment.amountMinor, currency)}
                  </p>
                </div>
              ))}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </LazyMotion>
  )
}

function PayInPerson({
  confirmation
}: {
  readonly confirmation: BookingConfirmationPresentationData
}) {
  const copy = (key: Parameters<typeof translateBookingMessage>[1]) =>
    translateBookingMessage(confirmation.locale, key)
  return (
    <section {...stylex.props(styles.payment)}>
      <div {...stylex.props(styles.paymentTitle)}>
        <PayInPersonIcon />
        <strong data-testid="text:payInPerson" {...stylex.props(styles.paymentName)}>
          {copy('reservation.pay_in_person')}
        </strong>
      </div>
    </section>
  )
}

function ConfirmationIcon({ cancelled }: { readonly cancelled: boolean }) {
  return (
    <svg viewBox="0 0 42 42" aria-hidden="true" {...stylex.props(styles.titleIcon)}>
      <circle cx="21" cy="21" r="21" fill={cancelled ? '#ff3b30' : '#2caf00'} />
      {cancelled ? (
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M16.03 17.126a.84.84 0 0 1 1.487-.884L21.004 19.73l3.478-3.481a.84.84 0 1 1 1.275 1.269l-3.482 3.482 3.483 3.483a.84.84 0 1 1-1.275 1.269l-3.48-3.48-3.487 3.486a.84.84 0 1 1-1.269-1.269l3.486-3.488-3.485-3.484a.84.84 0 0 1-.218-.39Z"
          fill="#fff"
        />
      ) : (
        <path
          d="m14.7 21 4.214 4.2 8.385-8.4"
          fill="none"
          stroke="#fff"
          strokeWidth="2"
        />
      )}
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg
      width="14px"
      height="16px"
      viewBox="0 0 14 16"
      aria-hidden="true"
      {...stylex.props(styles.calendarIcon)}
    >
      <path
        fill="currentColor"
        d="m10.883 8.5c.022 2.421 2.124 3.227 2.147 3.237-.018.057-.336 1.149-1.107 2.276-.667.975-1.359 1.946-2.45 1.966-1.07.02-1.415-.635-2.64-.635-1.224 0-1.607.615-2.621.655-1.052.04-1.854-1.054-2.527-2.025C.311 11.987-.739 8.36.671 5.912c.7-1.216 1.952-1.986 3.31-2.005 1.034-.02 2.009.695 2.641.695s1.817-.86 3.063-.733c.521.021 1.986.21 2.926 1.587-.076.047-1.747 1.02-1.729 3.044ZM8.869 2.555c.559-.676.935-1.618.832-2.555-.805.032-1.779.537-2.357 1.213-.517.598-.97 1.556-.848 2.475.898.069 1.815-.457 2.373-1.133Z"
      />
    </svg>
  )
}

function PayInPersonIcon() {
  return (
    <svg viewBox="0 0 38 24" aria-hidden="true" {...stylex.props(styles.paymentIcon)}>
      <rect width="38" height="24" rx="3" fill="#000" />
      <path
        d="M22.8 6h-7.6L13 9v1.5a1.5 1.5 0 0 0 3 0 1.5 1.5 0 0 0 3 0 1.5 1.5 0 0 0 3 0 1.5 1.5 0 0 0 3 0V9l-2.2-3Z"
        fill="#fff"
      />
      <path
        fillRule="evenodd"
        d="M14 13.966V17a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3.034a3.5 3.5 0 0 1-2-.303 3.5 3.5 0 0 1-3 0 3.5 3.5 0 0 1-3 0 3.5 3.5 0 0 1-2 .303ZM20.5 15v3h-3v-3h3Z"
        fill="#fff"
      />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      {...stylex.props(styles.popupCloseIcon)}
    >
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
