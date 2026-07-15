import * as stylex from '@stylexjs/stylex'
import { AnimatePresence, m } from 'motion/react'
import type { ReactNode } from 'react'
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
  const deadlineTime =
    cancellation && cancellationDeadline
      ? new Intl.DateTimeFormat(cancellation.locale, {
          timeZone: cancellation.timeZone,
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short'
        }).format(cancellationDeadline)
      : ''
  const deadlineDate =
    cancellation && cancellationDeadline
      ? new Intl.DateTimeFormat(cancellation.locale, {
          timeZone: cancellation.timeZone,
          month: 'long',
          day: 'numeric'
        }).format(cancellationDeadline)
      : ''

  return (
    <BookingPopupSheet
      target={target}
      open={open}
      label={label}
      presenceKey={phase}
      testId={phase === 'policies' ? 'popup:policies' : 'popup:checkout'}
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
              <h2 {...stylex.props(styles.title)}>{copy.cancellationPolicy}</h2>
              {canCancel ? (
                <>
                  <div aria-hidden="true" {...stylex.props(styles.policyGraphic)}>
                    <span {...stylex.props(styles.policyMarker)}>
                      <strong>{deadlineTime}</strong>
                      <small>{deadlineDate}</small>
                    </span>
                    <span {...stylex.props(styles.policyBar)} />
                  </div>
                  <div {...stylex.props(styles.policyLabels)}>
                    <span>{copy.now}</span>
                    <span>{copy.appointment}</span>
                  </div>
                  <p {...stylex.props(styles.copy)}>
                    {copy.cancellationPolicyCopy
                      .replace('{time}', deadlineTime)
                      .replace('{date}', deadlineDate)}
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
    paddingTop: 0
  },
  title: {
    margin: '0 48px 0 0',
    color: bookingTheme.colorText,
    fontSize: 24,
    fontWeight: 650,
    lineHeight: 1.2
  },
  policyGraphic: {
    position: 'relative',
    height: 98,
    marginTop: 28
  },
  policyMarker: {
    position: 'absolute',
    top: 0,
    left: '62%',
    padding: '8px 11px',
    borderRadius: 8,
    transform: 'translateX(-50%)',
    backgroundColor: '#000000',
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 650,
    display: 'grid',
    gap: 2,
    textAlign: 'center',
    ':after': {
      content: '""',
      position: 'absolute',
      top: '100%',
      left: '50%',
      borderTopWidth: 5,
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
  policyLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    margin: '-24px 8px 24px',
    color: bookingTheme.colorTextMuted,
    fontSize: 10,
    fontWeight: 700,
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
    position: 'absolute',
    top: 64,
    left: 0,
    width: '100%',
    height: 6,
    borderRadius: 16,
    backgroundColor: bookingTheme.colorText,
    backgroundImage: 'linear-gradient(90deg, transparent 0 64%, #e5e5ea 64% 100%)'
  },
  copy: {
    margin: '0 8px 24px',
    color: bookingTheme.colorTextMuted,
    fontSize: 14,
    lineHeight: 1.5,
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
    fontSize: 14,
    fontWeight: 650,
    cursor: 'pointer'
  }
})
