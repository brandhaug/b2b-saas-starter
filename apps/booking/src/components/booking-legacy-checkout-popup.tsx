import * as stylex from '@stylexjs/stylex'
import { AnimatePresence, m } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { bookingTheme } from '../presentation/booking-theme.stylex.ts'
import { BookingPopupSheet } from '../presentation/booking-primitives.tsx'
import { BookingIcon } from '../presentation/booking-icon.tsx'
import type {
  LegacyBookingPolicyStep,
  PendingNotificationPolicyTarget
} from '@b2b-saas-starter/capabilities/booking'

export type LegacyCheckoutPhase = 'policies' | 'userInfo'

function LegacyCloseButton({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      data-testid="btn:close"
      onClick={onClose}
      {...stylex.props(styles.close)}
    >
      <BookingIcon iconRole="popup-close" width={24} height={24} />
    </button>
  )
}

function LegacyPolicyStatus({
  active,
  complete,
  policyStatus
}: {
  active: boolean
  complete: boolean
  policyStatus?: 'complete' | 'active' | 'pending'
}) {
  return (
    <span
      data-testid="policy:status"
      {...(policyStatus ? { 'data-policy-status': policyStatus } : {})}
      {...stylex.props(styles.status, active && styles.statusActive)}
    >
      {complete ? (
        <BookingIcon iconRole="policy-status-check" width={6} height={5} />
      ) : null}
    </span>
  )
}

function LegacyCancellationCopy({
  template,
  time,
  date
}: {
  template: string
  time: string
  date: string
}) {
  return template.split(/(\{time\}|\{date\})/).map((part, index) => {
    if (part === '{time}')
      return (
        <strong
          key={`time:${index}`}
          data-testid="text:cancellationTime"
          {...stylex.props(styles.copyStrong)}
        >
          {time}
        </strong>
      )
    if (part === '{date}')
      return (
        <strong
          key={`date:${index}`}
          data-testid="text:cancellationDate"
          {...stylex.props(styles.copyStrong, styles.copyDate)}
        >
          {date}
        </strong>
      )
    return part
  })
}

export function BookingLegacyCheckoutPopup({
  open,
  target,
  phase,
  policyKinds,
  appointmentCount,
  onClose,
  onPolicyComplete,
  cancellation,
  copy,
  children
}: {
  readonly open: boolean
  readonly target: HTMLElement | null
  readonly phase: LegacyCheckoutPhase
  readonly policyKinds: readonly LegacyBookingPolicyStep[]
  readonly appointmentCount: number
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
    readonly cancellationPolicyCopyPlural: string
    readonly noCancellation: string
    readonly noCancellationPlural: string
    readonly now: string
    readonly appointment: string
    readonly appointments: string
    readonly confirmBooking: string
    readonly agree: string
    readonly close: string
    readonly policiesLabel: string
    readonly policyProgress: string
    readonly adultsTitle: string
    readonly adultsCopy: string
    readonly adultsConfirm: string
  }
  readonly children: ReactNode
}) {
  const [activePolicyIndex, setActivePolicyIndex] = useState(0)
  useEffect(() => {
    if (open && phase === 'policies') setActivePolicyIndex(0)
  }, [open, phase])
  const activePolicy = policyKinds[activePolicyIndex]
  const effectivePhase = phase === 'policies' && activePolicy ? 'policies' : 'userInfo'
  const completeActivePolicy = () => {
    if (!activePolicy) {
      onPolicyComplete()
      return
    }
    if (activePolicyIndex === policyKinds.length - 1) onPolicyComplete()
    else setActivePolicyIndex((current) => current + 1)
  }
  const label =
    effectivePhase === 'policies'
      ? policyKinds.length > 1
        ? copy.policiesLabel
        : copy.cancellationPolicy
      : copy.confirmBooking
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
  const deadlineLongDateFormatter = useMemo(
    () =>
      cancellationLocale && cancellationTimeZone
        ? new Intl.DateTimeFormat(cancellationLocale, {
            timeZone: cancellationTimeZone,
            month: 'long',
            day: 'numeric',
            year: 'numeric'
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
  const deadlineDateParts =
    deadlineLongDateFormatter && cancellationDeadline
      ? deadlineLongDateFormatter.formatToParts(cancellationDeadline)
      : []
  const deadlineMonth =
    deadlineDateParts.find((part) => part.type === 'month')?.value ?? ''
  const deadlineDay = deadlineDateParts.find((part) => part.type === 'day')?.value ?? ''
  const deadlineYear =
    deadlineDateParts.find((part) => part.type === 'year')?.value ?? ''
  const legacyMonthFirst =
    cancellationLocale?.startsWith('en') || cancellationLocale?.startsWith('es')
  const deadlineDate = legacyMonthFirst
    ? `${deadlineMonth} ${deadlineDay}`
    : `${deadlineDay} ${deadlineMonth}`
  const deadlineLongDate = legacyMonthFirst
    ? `${deadlineMonth} ${deadlineDay}, ${deadlineYear}`
    : `${deadlineDay} ${deadlineMonth} ${deadlineYear}`
  const cancellationPolicyCopy =
    appointmentCount === 1
      ? copy.cancellationPolicyCopy
      : copy.cancellationPolicyCopyPlural
  const noCancellationCopy =
    appointmentCount === 1 ? copy.noCancellation : copy.noCancellationPlural

  return (
    <BookingPopupSheet
      target={target}
      open={open}
      label={label}
      presenceKey={effectivePhase}
      testId={effectivePhase === 'policies' ? 'popup:policies' : 'popup:checkout'}
      legacyGeometry
      layout={effectivePhase === 'userInfo' ? 'legacyCheckout' : 'legacyPolicy'}
      onClose={onClose}
    >
      <AnimatePresence mode="wait" initial={false}>
        {effectivePhase === 'policies' ? (
          <m.div key={`policy:${activePolicy}`} {...stylex.props(styles.content)}>
            <LegacyCloseButton label={copy.close} onClose={onClose} />
            <m.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              {...stylex.props(styles.policy)}
            >
              {activePolicy === 'adults' ? (
                <>
                  <h2 data-testid="text:adultsTitle" {...stylex.props(styles.title)}>
                    {copy.adultsTitle}
                  </h2>
                  <div {...stylex.props(styles.adultsPolicy)}>
                    <div aria-hidden="true" {...stylex.props(styles.adultsBadge)}>
                      21 +
                    </div>
                    <p {...stylex.props(styles.adultsCopy)}>{copy.adultsCopy}</p>
                  </div>
                </>
              ) : (
                <>
                  <h2
                    data-testid="text:cancellationTitle"
                    {...stylex.props(styles.title)}
                  >
                    {copy.cancellationPolicy}
                  </h2>
                  {canCancel ? (
                    <>
                      <div
                        data-testid="policy:tooltip"
                        {...stylex.props(styles.policyMarker)}
                      >
                        <strong {...stylex.props(styles.policyTime)}>
                          {tooltipTime}
                        </strong>
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
                        <span>
                          {appointmentCount === 1
                            ? copy.appointment
                            : copy.appointments}
                        </span>
                      </div>
                      <p {...stylex.props(styles.copy)}>
                        <LegacyCancellationCopy
                          template={cancellationPolicyCopy}
                          time={deadlineTime}
                          date={deadlineLongDate}
                        />
                      </p>
                    </>
                  ) : (
                    <div {...stylex.props(styles.noCancellation)}>
                      <BookingIcon
                        iconRole="policy-cancellation"
                        width={81}
                        height={80}
                      />
                      <p
                        data-testid="text:noCancellation"
                        {...stylex.props(styles.noCancellationCopy)}
                      >
                        {noCancellationCopy}
                      </p>
                    </div>
                  )}
                </>
              )}
              <button
                type="button"
                data-testid="btn:confirm"
                onClick={completeActivePolicy}
                {...stylex.props(styles.primary)}
              >
                {activePolicy === 'adults' ? copy.adultsConfirm : copy.agree}
              </button>
              {policyKinds.length > 1 ? (
                <div
                  aria-label={copy.policyProgress}
                  {...stylex.props(styles.statuses)}
                >
                  {policyKinds.map((kind, index) => (
                    <LegacyPolicyStatus
                      key={kind}
                      policyStatus={
                        index < activePolicyIndex
                          ? 'complete'
                          : index === activePolicyIndex
                            ? 'active'
                            : 'pending'
                      }
                      active={index === activePolicyIndex}
                      complete={index < activePolicyIndex}
                    />
                  ))}
                </div>
              ) : null}
            </m.div>
          </m.div>
        ) : (
          <div
            key="user-info"
            data-testid="checkout-popup-root"
            {...stylex.props(styles.checkoutPopupBase)}
          >
            {children}
          </div>
        )}
      </AnimatePresence>
    </BookingPopupSheet>
  )
}

export function BookingLegacyNotificationPolicies({
  open,
  target,
  targets,
  shopName,
  copy,
  onClose,
  onComplete
}: {
  readonly open: boolean
  readonly target: HTMLElement | null
  readonly targets: readonly PendingNotificationPolicyTarget[]
  readonly shopName: string
  readonly copy: {
    readonly smsTitle: string
    readonly emailTitle: string
    readonly smsCopy: string
    readonly emailCopy: string
    readonly yes: string
    readonly skip: string
    readonly close: string
    readonly notificationPreferences: string
    readonly policyProgress: string
  }
  readonly onClose: () => void
  readonly onComplete: (
    decisions: readonly (PendingNotificationPolicyTarget & {
      readonly granted: boolean
    })[]
  ) => void
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const decisions = useRef<
    readonly (PendingNotificationPolicyTarget & { readonly granted: boolean })[]
  >([])
  useEffect(() => {
    if (!open) return
    setActiveIndex(0)
    decisions.current = []
  }, [open])
  const activeTarget = targets[activeIndex]
  const activeChannel = activeTarget?.channel ?? 'email'
  const decide = (granted: boolean) => {
    if (!activeTarget) return
    const next = [...decisions.current, { ...activeTarget, granted }]
    decisions.current = next
    if (activeIndex === targets.length - 1) onComplete(next)
    else setActiveIndex((current) => current + 1)
  }
  return (
    <BookingPopupSheet
      target={target}
      open={open && targets.length > 0}
      label={copy.notificationPreferences}
      presenceKey="notification-policies"
      testId="popup:notification-policies"
      legacyGeometry
      onClose={onClose}
    >
      <div {...stylex.props(styles.content)}>
        <LegacyCloseButton label={copy.close} onClose={onClose} />
        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={`${activeTarget?.bookingRequestId ?? 'none'}:${activeChannel}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <h2
              data-testid={`text:consent${activeChannel}`}
              {...stylex.props(styles.title)}
            >
              {(activeChannel === 'sms' ? copy.smsTitle : copy.emailTitle).replace(
                '{shop}',
                shopName
              )}
            </h2>
            <div {...stylex.props(styles.consentPolicy)}>
              <div aria-hidden="true" {...stylex.props(styles.consentIcon)}>
                {activeChannel === 'sms' ? '•••' : '✉'}
              </div>
              <p {...stylex.props(styles.consentCopy)}>
                {activeChannel === 'sms' ? copy.smsCopy : copy.emailCopy}
              </p>
            </div>
            <button
              type="button"
              data-testid="btn:consent"
              onClick={() => decide(true)}
              {...stylex.props(styles.primary, styles.consentYes)}
            >
              {copy.yes}
            </button>
            <button
              type="button"
              data-testid="btn:decline"
              onClick={() => decide(false)}
              {...stylex.props(styles.secondary)}
            >
              {copy.skip}
            </button>
            {targets.length > 1 ? (
              <div aria-label={copy.policyProgress} {...stylex.props(styles.statuses)}>
                {targets.map((target, index) => (
                  <LegacyPolicyStatus
                    key={`${target.bookingRequestId}:${target.channel}`}
                    active={index === activeIndex}
                    complete={index < activeIndex}
                  />
                ))}
              </div>
            ) : null}
          </m.div>
        </AnimatePresence>
      </div>
    </BookingPopupSheet>
  )
}

const styles = stylex.create({
  content: {
    position: 'relative',
    width: '100%',
    maxHeight: '100%',
    padding: 16,
    overflow: 'auto',
    boxSizing: 'border-box',
    fontFamily: bookingTheme.fontLegacyText
  },
  checkoutPopupBase: {
    position: 'relative',
    width: '100%',
    height: 'auto',
    padding: 16,
    overflow: 'auto',
    boxSizing: 'border-box',
    fontFamily: bookingTheme.fontLegacyText
  },
  close: {
    position: 'absolute',
    zIndex: bookingTheme.layerTooltip,
    top: 14,
    right: 6,
    display: 'grid',
    width: 44,
    height: 44,
    padding: 0,
    placeItems: 'center',
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: bookingTheme.colorSystemGray1,
    cursor: 'pointer'
  },
  policy: {
    paddingTop: 0
  },
  title: {
    margin: '8px 0 0',
    color: bookingTheme.colorText,
    fontFamily: bookingTheme.fontLegacyDisplay,
    fontSize: 20,
    fontWeight: 600,
    lineHeight: '24px',
    letterSpacing: '0.75px'
  },
  adultsPolicy: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginBlock: '56px 64px'
  },
  adultsBadge: {
    display: 'flex',
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: bookingTheme.colorLink,
    borderRadius: 40,
    color: bookingTheme.colorText,
    fontFamily: bookingTheme.fontLegacyDisplay,
    fontSize: 20,
    fontWeight: 600,
    letterSpacing: '0.75px'
  },
  adultsCopy: {
    margin: 0,
    color: bookingTheme.colorSystemGray1,
    fontFamily: bookingTheme.fontLegacyText,
    fontSize: 15,
    lineHeight: '18px',
    letterSpacing: '-0.24px',
    textAlign: 'center'
  },
  consentPolicy: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    margin: '32px 28px 40px'
  },
  consentIcon: {
    display: 'flex',
    width: 96,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    borderRadius: 20,
    backgroundColor: '#e5e5ea',
    color: bookingTheme.colorText,
    fontSize: 30,
    fontWeight: 600,
    letterSpacing: 3
  },
  consentCopy: {
    margin: 0,
    color: bookingTheme.colorSystemGray1,
    fontFamily: bookingTheme.fontLegacyText,
    fontSize: 13,
    lineHeight: '18px',
    letterSpacing: '-0.078px',
    textAlign: 'center'
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
    fontFamily: bookingTheme.fontLegacyText,
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
    fontFamily: bookingTheme.fontLegacyDisplay,
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
    textAlign: 'center',
    textTransform: 'capitalize'
  },
  policyLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    margin: '4px 32px 0',
    color: bookingTheme.secondaryFontA30,
    fontFamily: bookingTheme.fontLegacyText,
    fontSize: 12,
    fontWeight: 600,
    lineHeight: '16px',
    textTransform: 'uppercase'
  },
  noCancellation: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    margin: '56px 0'
  },
  noCancellationCopy: {
    margin: '24px 0 0',
    color: bookingTheme.colorText,
    fontFamily: bookingTheme.fontLegacyText,
    fontSize: 15,
    lineHeight: '18px',
    letterSpacing: '-0.24px',
    textAlign: 'center'
  },
  policyBar: {
    position: 'relative',
    width: 280,
    height: 6.25,
    margin: '0 auto',
    borderRadius: 16,
    backgroundColor: bookingTheme.colorLink,
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
    color: bookingTheme.colorSystemGray1,
    fontFamily: bookingTheme.fontLegacyText,
    fontSize: 15,
    lineHeight: '18px',
    letterSpacing: '-0.24px',
    textAlign: 'center'
  },
  copyStrong: {
    color: bookingTheme.colorText,
    fontWeight: 600,
    whiteSpace: 'nowrap'
  },
  copyDate: {
    textTransform: 'capitalize'
  },
  primary: {
    width: '100%',
    height: 48,
    padding: '0 20px',
    borderWidth: 0,
    borderRadius: 8,
    backgroundColor: bookingTheme.colorPrimary,
    color: bookingTheme.colorPrimaryFont,
    fontFamily: bookingTheme.fontLegacyText,
    fontSize: 15,
    fontWeight: 600,
    lineHeight: '20px',
    letterSpacing: '-0.24px',
    cursor: 'pointer'
  },
  statuses: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12
  },
  status: {
    display: 'flex',
    width: 6,
    height: 6,
    boxSizing: 'border-box',
    alignItems: 'center',
    justifyContent: 'center',
    margin: 0,
    paddingLeft: 1.5,
    borderRadius: '50%',
    backgroundColor: bookingTheme.colorCardBorder,
    color: bookingTheme.colorText
  },
  statusActive: {
    backgroundColor: bookingTheme.colorLink
  },
  consentYes: {
    marginBottom: 8
  },
  secondary: {
    width: '100%',
    height: 48,
    padding: '0 20px',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: bookingTheme.colorBorder,
    borderRadius: 8,
    backgroundColor: 'transparent',
    color: bookingTheme.colorTextMuted,
    fontFamily: bookingTheme.fontLegacyText,
    fontSize: 15,
    fontWeight: 600,
    lineHeight: '20px',
    letterSpacing: '-0.24px',
    cursor: 'pointer'
  }
})
