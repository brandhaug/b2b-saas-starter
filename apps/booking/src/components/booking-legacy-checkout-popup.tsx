import * as stylex from '@stylexjs/stylex'
import { AnimatePresence, m } from 'motion/react'
import { useMemo, type ReactNode } from 'react'
import { bookingTheme } from '../presentation/booking-theme.stylex.ts'
import { BookingPopupSheet } from '../presentation/booking-primitives.tsx'

export type LegacyCheckoutPhase = 'policies' | 'userInfo'

export function BookingLegacyCheckoutPopup({
  open,
  target,
  phase,
  onClose,
  onPolicyComplete,
  cancellation,
  copy,
  children
}: {
  readonly open: boolean
  readonly target: HTMLElement | null
  readonly phase: LegacyCheckoutPhase
  readonly onClose: () => void
  readonly onPolicyComplete: () => void
  readonly cancellation: {
    readonly eligible: boolean
    readonly cancellableUntil: string
    readonly timeZone: string
    readonly locale: string
  } | null
  readonly copy: {
    readonly cancellationPolicy: string
    readonly cancellationPolicyCopy: string
    readonly noCancellation: string
    readonly now: string
    readonly appointment: string
    readonly confirmBooking: string
    readonly agree: string
    readonly close: string
  }
  readonly children: ReactNode
}) {
  const label = phase === 'policies' ? copy.cancellationPolicy : copy.confirmBooking
  const cancellationDeadline = cancellation
    ? new Date(cancellation.cancellableUntil)
    : null
  const canCancel = cancellation?.eligible ?? false
  const cancellationLocale = cancellation?.locale
  const cancellationTimeZone = cancellation?.timeZone
  const deadlineTimeFormatter = useMemo(
    () =>
      cancellationLocale && cancellationTimeZone
        ? new Intl.DateTimeFormat(cancellationLocale, {
            timeZone: cancellationTimeZone,
            hour: 'numeric',
            minute: '2-digit',
            timeZoneName: 'short'
          })
        : null,
    [cancellationLocale, cancellationTimeZone]
  )
  const deadlineDateFormatter = useMemo(
    () =>
      cancellationLocale && cancellationTimeZone
        ? new Intl.DateTimeFormat(cancellationLocale, {
            timeZone: cancellationTimeZone,
            month: 'long',
            day: 'numeric'
          })
        : null,
    [cancellationLocale, cancellationTimeZone]
  )
  const deadlineTime =
    deadlineTimeFormatter && cancellationDeadline
      ? deadlineTimeFormatter.format(cancellationDeadline)
      : ''
  const deadlineParts =
    deadlineTimeFormatter && cancellationDeadline
      ? deadlineTimeFormatter.formatToParts(cancellationDeadline)
      : []
  const tooltipTime = deadlineParts
    .filter(
      (part) =>
        part.type === 'hour' || part.type === 'minute' || part.type === 'literal'
    )
    .map((part) => part.value)
    .join('')
    .replace(/\s+/g, '')
  const tooltipPeriod =
    deadlineParts.find((part) => part.type === 'dayPeriod')?.value ?? ''
  const tooltipTimezone =
    deadlineParts.find((part) => part.type === 'timeZoneName')?.value ?? ''
  const deadlineDate =
    deadlineDateFormatter && cancellationDeadline
      ? deadlineDateFormatter.format(cancellationDeadline)
      : ''

  return (
    <BookingPopupSheet
      target={target}
      open={open}
      label={label}
      presenceKey={phase}
      testId={phase === 'policies' ? 'popup:policies' : 'popup:checkout'}
      legacyGeometry
      onClose={onClose}
    >
      <div {...stylex.props(styles.content)}>
        <button
          type="button"
          aria-label={copy.close}
          onClick={onClose}
          {...stylex.props(styles.close)}
        >
          <span aria-hidden="true">×</span>
        </button>
        <AnimatePresence mode="wait" initial={false}>
          {phase === 'policies' ? (
            <m.div
              key="policy"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              {...stylex.props(styles.policy)}
            >
              <h2 data-testid="text:cancellationTitle" {...stylex.props(styles.title)}>
                {copy.cancellationPolicy}
              </h2>
              {canCancel ? (
                <>
                  <div
                    data-testid="policy:tooltip"
                    {...stylex.props(styles.policyMarker)}
                  >
                    <strong {...stylex.props(styles.policyTime)}>{tooltipTime}</strong>
                    {tooltipPeriod ? (
                      <span {...stylex.props(styles.policyPeriod)}>
                        {tooltipPeriod}
                      </span>
                    ) : null}
                    <span {...stylex.props(styles.policyTimezone)}>
                      {tooltipTimezone}
                    </span>
                    <span {...stylex.props(styles.policyDate)}>{deadlineDate}</span>
                  </div>
                  <div
                    aria-hidden="true"
                    data-testid="policy:cancellation-bar"
                    {...stylex.props(styles.policyBar)}
                  />
                  <div {...stylex.props(styles.policyLabels)}>
                    <span>{copy.now}</span>
                    <span>{copy.appointment}</span>
                  </div>
                  <p {...stylex.props(styles.copy)}>
                    {copy.cancellationPolicyCopy.split('{time}')[0]}
                    <strong data-testid="text:cancellationTime">{deadlineTime}</strong>
                    {copy.cancellationPolicyCopy.split('{time}')[1]?.split('{date}')[0]}
                    <strong data-testid="text:cancellationDate">{deadlineDate}</strong>
                    {copy.cancellationPolicyCopy.split('{date}')[1]}
                  </p>
                </>
              ) : (
                <div {...stylex.props(styles.noCancellation)}>
                  <span aria-hidden="true" {...stylex.props(styles.noCancelIcon)}>
                    ×
                  </span>
                  <p {...stylex.props(styles.copy)}>{copy.noCancellation}</p>
                </div>
              )}
              <button
                type="button"
                data-testid="btn:confirm"
                onClick={onPolicyComplete}
                {...stylex.props(styles.primary)}
              >
                {copy.agree}
              </button>
            </m.div>
          ) : (
            <m.div
              key="user-info"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              {children}
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </BookingPopupSheet>
  )
}

const styles = stylex.create({
  content: {
    position: 'relative',
    width: '100%',
    padding: 16,
    boxSizing: 'border-box'
  },
  close: {
    position: 'absolute',
    zIndex: bookingTheme.layerTooltip,
    top: 14,
    right: 6,
    display: 'grid',
    width: 32,
    height: 32,
    padding: 0,
    placeItems: 'center',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: bookingTheme.colorBorder,
    borderRadius: 16,
    backgroundColor: 'transparent',
    color: bookingTheme.colorText,
    fontSize: 24,
    lineHeight: 1,
    cursor: 'pointer'
  },
  policy: {
    paddingTop: 0,
    overflow: 'hidden'
  },
  title: {
    margin: '8px 48px 0 0',
    color: bookingTheme.colorText,
    fontFamily: 'SF Pro Display, system-ui, sans-serif',
    fontSize: 20,
    fontWeight: 600,
    lineHeight: '24px',
    letterSpacing: '0.75px'
  },
  policyMarker: {
    position: 'relative',
    display: 'grid',
    width: 'max-content',
    gridTemplateAreas: '"time period" "time timezone" "date date"',
    gridTemplateColumns: 'repeat(2, max-content)',
    alignItems: 'start',
    gap: '0 4px',
    margin: '44px 0 12px 212px',
    padding: '12px 14px',
    borderRadius: 8,
    transform: 'translateX(-50%)',
    backgroundColor: '#000000',
    color: '#ffffff',
    fontFamily: 'SF Pro Text, system-ui, sans-serif',
    textAlign: 'center',
    ':after': {
      content: '""',
      position: 'absolute',
      top: '100%',
      left: '50%',
      borderTopWidth: 4,
      borderTopStyle: 'solid',
      borderTopColor: '#000000',
      borderRightWidth: 6,
      borderRightStyle: 'solid',
      borderRightColor: 'transparent',
      borderLeftWidth: 6,
      borderLeftStyle: 'solid',
      borderLeftColor: 'transparent',
      transform: 'translateX(-50%)'
    }
  },
  policyTime: {
    gridArea: 'time',
    fontFamily: 'SF Pro Display, system-ui, sans-serif',
    fontSize: 20,
    fontWeight: 600,
    lineHeight: '24px',
    letterSpacing: '0.75px'
  },
  policyPeriod: {
    position: 'relative',
    top: 3,
    gridArea: 'period',
    fontSize: 9,
    fontWeight: 700,
    lineHeight: '11px',
    textTransform: 'uppercase'
  },
  policyTimezone: {
    gridArea: 'timezone',
    fontSize: 9,
    fontWeight: 700,
    lineHeight: '16px'
  },
  policyDate: {
    gridArea: 'date',
    marginTop: 0,
    color: 'rgba(235, 235, 245, 0.6)',
    fontSize: 11,
    fontWeight: 400,
    lineHeight: '15px',
    textTransform: 'capitalize'
  },
  policyLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    margin: '4px 32px 0',
    color: bookingTheme.colorTextMuted,
    fontFamily: 'SF Pro Text, system-ui, sans-serif',
    fontSize: 12,
    fontWeight: 600,
    lineHeight: '16px',
    textTransform: 'uppercase'
  },
  noCancellation: {
    display: 'grid',
    justifyItems: 'center',
    padding: '48px 0 24px'
  },
  noCancelIcon: {
    display: 'grid',
    width: 64,
    height: 64,
    marginBottom: 20,
    placeItems: 'center',
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: bookingTheme.colorText,
    borderRadius: 32,
    fontSize: 36,
    lineHeight: 1
  },
  policyBar: {
    position: 'relative',
    width: 280,
    height: 6.25,
    margin: '0 auto',
    borderRadius: 16,
    backgroundColor: bookingTheme.colorText,
    ':after': {
      content: '""',
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      width: 100,
      height: 6.25,
      borderRadius: '0 16px 16px 0',
      backgroundImage:
        'repeating-linear-gradient(-45deg, #e5e5ea 0 5px, #d1d1d6 5px 6px)'
    }
  },
  copy: {
    margin: '24px 32px 44px',
    color: bookingTheme.colorTextMuted,
    fontFamily: 'SF Pro Text, system-ui, sans-serif',
    fontSize: 15,
    lineHeight: '18px',
    letterSpacing: '-0.24px',
    textAlign: 'center'
  },
  primary: {
    width: '100%',
    height: 48,
    padding: '0 20px',
    borderWidth: 0,
    borderRadius: 8,
    backgroundColor: bookingTheme.colorText,
    color: bookingTheme.colorSurface,
    fontFamily: 'SF Pro Text, system-ui, sans-serif',
    fontSize: 15,
    fontWeight: 600,
    lineHeight: '20px',
    letterSpacing: '-0.24px',
    cursor: 'pointer'
  }
})
