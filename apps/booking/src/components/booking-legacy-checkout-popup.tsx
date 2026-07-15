import * as stylex from '@stylexjs/stylex'
import { AnimatePresence, m } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { bookingTheme } from '../presentation/booking-theme.stylex.ts'
import { BookingPopupSheet } from '../presentation/booking-primitives.tsx'
import type {
  LegacyBookingPolicyStep,
  PendingMarketingConsentTarget
} from '@b2b-saas-starter/capabilities/booking'

export type LegacyCheckoutPhase = 'policies' | 'userInfo'

export function BookingLegacyCheckoutPopup({
  open,
  target,
  phase,
  policyKinds,
  onClose,
  onPolicyComplete,
  cancellation,
  checkoutPolicy,
  copy,
  children
}: {
  readonly open: boolean
  readonly target: HTMLElement | null
  readonly phase: LegacyCheckoutPhase
  readonly policyKinds: readonly LegacyBookingPolicyStep[]
  readonly onClose: () => void
  readonly onPolicyComplete: () => void
  readonly cancellation: {
    readonly eligible: boolean
    readonly cancellableUntil: string
    readonly timeZone: string
    readonly locale: string
  } | null
  readonly checkoutPolicy?: {
    readonly version: number
    readonly disclosure: string
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
    readonly policiesLabel: string
    readonly policyProgress: string
    readonly checkoutPolicyVersion: string
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
      presenceKey={effectivePhase}
      testId={effectivePhase === 'policies' ? 'popup:policies' : 'popup:checkout'}
      legacyGeometry
      layout={effectivePhase === 'userInfo' ? 'legacyCheckout' : 'content'}
      onClose={onClose}
    >
      <AnimatePresence mode="wait" initial={false}>
        {effectivePhase === 'policies' ? (
          <m.div key={`policy:${activePolicy}`} {...stylex.props(styles.content)}>
            <button
              type="button"
              aria-label={copy.close}
              onClick={onClose}
              {...stylex.props(styles.close)}
            >
              <span aria-hidden="true">×</span>
            </button>
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
                        <span>{copy.appointment}</span>
                      </div>
                      <p {...stylex.props(styles.copy)}>
                        {copy.cancellationPolicyCopy.split('{time}')[0]}
                        <strong data-testid="text:cancellationTime">
                          {deadlineTime}
                        </strong>
                        {
                          copy.cancellationPolicyCopy
                            .split('{time}')[1]
                            ?.split('{date}')[0]
                        }
                        <strong data-testid="text:cancellationDate">
                          {deadlineDate}
                        </strong>
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
                  {checkoutPolicy ? (
                    <div data-testid="policy:checkout-disclosure">
                      <p {...stylex.props(styles.exactPolicyVersion)}>
                        {copy.checkoutPolicyVersion.replace(
                          '{version}',
                          String(checkoutPolicy.version)
                        )}
                      </p>
                      <p {...stylex.props(styles.exactPolicyDisclosure)}>
                        {checkoutPolicy.disclosure}
                      </p>
                    </div>
                  ) : null}
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
                    <span
                      key={kind}
                      data-testid="policy:status"
                      data-policy-status={
                        index < activePolicyIndex
                          ? 'complete'
                          : index === activePolicyIndex
                            ? 'active'
                            : 'pending'
                      }
                      {...stylex.props(
                        styles.status,
                        index === activePolicyIndex && styles.statusActive,
                        index < activePolicyIndex && styles.statusComplete
                      )}
                    >
                      {index < activePolicyIndex ? '✓' : null}
                    </span>
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
  readonly targets: readonly PendingMarketingConsentTarget[]
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
    decisions: readonly (PendingMarketingConsentTarget & {
      readonly granted: boolean
    })[]
  ) => void
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const decisions = useRef<
    readonly (PendingMarketingConsentTarget & { readonly granted: boolean })[]
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
        <button
          type="button"
          aria-label={copy.close}
          onClick={onClose}
          {...stylex.props(styles.close)}
        >
          <span aria-hidden="true">×</span>
        </button>
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
                  <span
                    key={`${target.bookingRequestId}:${target.channel}`}
                    data-testid="policy:status"
                    {...stylex.props(
                      styles.status,
                      index === activeIndex && styles.statusActive,
                      index < activeIndex && styles.statusComplete
                    )}
                  >
                    {index < activeIndex ? '✓' : null}
                  </span>
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
    padding: 16,
    boxSizing: 'border-box'
  },
  checkoutPopupBase: {
    position: 'relative',
    width: '100%',
    height: 'auto',
    padding: 16,
    overflow: 'auto',
    boxSizing: 'border-box',
    fontFamily: 'SF Pro Text, Roboto, sans-serif'
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
    borderColor: bookingTheme.colorText,
    borderRadius: 40,
    color: bookingTheme.colorText,
    fontFamily: 'SF Pro Display, system-ui, sans-serif',
    fontSize: 20,
    fontWeight: 600,
    letterSpacing: '0.75px'
  },
  adultsCopy: {
    margin: 0,
    color: bookingTheme.colorTextMuted,
    fontFamily: 'SF Pro Text, system-ui, sans-serif',
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
    color: bookingTheme.colorTextMuted,
    fontFamily: 'SF Pro Text, system-ui, sans-serif',
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
  exactPolicyVersion: {
    margin: '8px 32px 0',
    color: bookingTheme.colorTextMuted,
    fontFamily: 'SF Pro Text, system-ui, sans-serif',
    fontSize: 12,
    fontWeight: 600,
    lineHeight: '16px'
  },
  exactPolicyDisclosure: {
    margin: '4px 32px 24px',
    color: bookingTheme.colorText,
    fontFamily: 'SF Pro Text, system-ui, sans-serif',
    fontSize: 13,
    lineHeight: '18px'
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
    borderRadius: '50%',
    backgroundColor: bookingTheme.colorBorder,
    color: bookingTheme.colorSurface,
    fontSize: 5,
    lineHeight: 1
  },
  statusActive: {
    backgroundColor: bookingTheme.colorLink
  },
  statusComplete: {
    width: 8,
    height: 8,
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
    fontFamily: 'SF Pro Text, system-ui, sans-serif',
    fontSize: 15,
    fontWeight: 600,
    lineHeight: '20px',
    letterSpacing: '-0.24px',
    cursor: 'pointer'
  }
})
