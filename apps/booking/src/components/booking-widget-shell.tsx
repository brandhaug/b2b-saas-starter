import * as stylex from '@stylexjs/stylex'
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
  busyLabel = 'Processing…',
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
      data-scroll-owner={embedding === 'standalone' ? 'document' : 'content'}
      style={premiumStyle}
      {...stylex.props(styles.widget)}
    >
      {children}
      {busy ? (
        <output aria-live="polite" {...stylex.props(styles.processingOverlay)}>
          {busyLabel}
        </output>
      ) : null}
    </div>
  )
}
