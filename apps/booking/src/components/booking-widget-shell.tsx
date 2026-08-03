import * as stylex from '@stylexjs/stylex'
import { AnimatePresence, LazyMotion, domAnimation, m } from 'motion/react'
import { createContext, useContext, type ReactNode } from 'react'
import type { BookingEmbedding } from '../lib/booking-route-contract.ts'
import { useBookingPremiumTheme } from '../presentation/booking-premium-theme.tsx'
import { styles } from './booking-flow.styles.ts'

const BookingShellContext = createContext<BookingEmbedding>('standalone')

export function BookingShellProvider({
  embedding,
  children
}: {
  readonly embedding: BookingEmbedding
  readonly children: ReactNode
}) {
  return (
    <BookingShellContext.Provider value={embedding}>
      {children}
    </BookingShellContext.Provider>
  )
}

export function BookingWidgetShell({
  busy = false,
  busyLabel,
  children
}: {
  readonly busy?: boolean
  readonly busyLabel?: string
  readonly children: ReactNode
}) {
  const embedding = useContext(BookingShellContext)
  const premiumStyle = useBookingPremiumTheme()

  return (
    <div
      data-booking-shell="canonical"
      data-embedding={embedding}
      data-booking-embedding={embedding}
      data-scroll-owner="content"
      style={premiumStyle}
      {...stylex.props(styles.widget)}
    >
      {children}
      <BookingLegacyProcessingOverlay
        state={busy && busyLabel ? 'pending' : 'hidden'}
        pendingLabel={busyLabel ?? ''}
        successLabel={busyLabel ?? ''}
      />
    </div>
  )
}

export function BookingLegacyProcessingOverlay({
  state,
  pendingLabel,
  successLabel
}: {
  readonly state: 'hidden' | 'pending' | 'success'
  readonly pendingLabel: string
  readonly successLabel: string
}) {
  return (
    <LazyMotion features={domAnimation} strict>
      <AnimatePresence mode="wait" initial={false}>
        {state !== 'hidden' ? (
          <m.div
            key="booking-processing-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            {...stylex.props(styles.legacyProcessingOverlay)}
          >
            {state === 'success' ? (
              <LegacySuccessMessage label={successLabel} />
            ) : (
              <LegacyProcessingMessage label={pendingLabel} />
            )}
          </m.div>
        ) : null}
      </AnimatePresence>
    </LazyMotion>
  )
}

function LegacyProcessingMessage({ label }: { readonly label: string }) {
  return (
    <div {...stylex.props(styles.processingMessage)}>
      <div {...stylex.props(styles.processingIconContainer)}>
        <m.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          exit={{ scale: 0 }}
          transition={{ duration: 0.15 }}
          {...stylex.props(styles.processingPendingCollapsible)}
        >
          <ProcessingPendingIcon />
        </m.div>
      </div>
      <div {...stylex.props(styles.processingTitleBox)}>
        <p {...stylex.props(styles.processingTitle)}>{label}</p>
      </div>
    </div>
  )
}

function LegacySuccessMessage({ label }: { readonly label: string }) {
  return (
    <div {...stylex.props(styles.processingMessage)}>
      <div {...stylex.props(styles.processingIconContainer)}>
        <AnimatePresence initial>
          <m.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={{ duration: 0.15 }}
            {...stylex.props(styles.processingSuccessCircle)}
          >
            <m.svg
              aria-hidden="true"
              width="24"
              height="18"
              viewBox="0 0 24 18"
              initial="hidden"
              animate="visible"
              fill="none"
            >
              <m.path
                d="M2 8.5 8.69 15 22 2"
                stroke="currentColor"
                strokeWidth="3"
                variants={{
                  hidden: { pathLength: 0 },
                  visible: {
                    pathLength: 1,
                    transition: {
                      pathLength: {
                        type: 'spring',
                        duration: 0.15,
                        delay: 0.075,
                        bounce: 0
                      }
                    }
                  }
                }}
              />
            </m.svg>
          </m.div>
        </AnimatePresence>
      </div>
      <div {...stylex.props(styles.processingTitleBox)}>
        <p data-testid="text:successMessage" {...stylex.props(styles.processingTitle)}>
          {label}
        </p>
      </div>
    </div>
  )
}

function ProcessingPendingIcon() {
  return (
    <svg
      aria-hidden="true"
      width="62"
      height="62"
      viewBox="0 0 62 62"
      {...stylex.props(styles.processingIcon)}
    >
      <defs>
        <linearGradient
          id="booking-processing-right"
          gradientUnits="userSpaceOnUse"
          x1="46.25"
          y1="0.5"
          x2="46.25"
          y2="61.5"
        >
          <stop offset="0" stopColor="currentColor" stopOpacity="0" />
          <stop offset="0.7999" stopColor="currentColor" stopOpacity="0.82" />
        </linearGradient>
        <linearGradient
          id="booking-processing-left"
          gradientUnits="userSpaceOnUse"
          x1="15.75"
          y1="0.5"
          x2="15.75"
          y2="61.5"
        >
          <stop offset="0.8" stopColor="currentColor" stopOpacity="0" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.8" />
        </linearGradient>
      </defs>
      <path
        fill="none"
        stroke="url(#booking-processing-right)"
        strokeWidth="3"
        d="M31 60c16 0 29-13 29-29S47 2 31 2"
      />
      <path
        fill="none"
        stroke="url(#booking-processing-left)"
        strokeWidth="3"
        d="M31 2C15 2 2 15 2 31s13 29 29 29"
      />
    </svg>
  )
}
