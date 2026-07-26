import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { shouldCommitAppointmentDaySwipe } from './mobile-appointment-day-swipe.ts'
import { MobileAppointmentLedger } from './mobile-appointment-ledger.tsx'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    className,
    'data-desktop-appointment-row': desktopRow,
    'data-mobile-appointment-row': mobileRow
  }: {
    readonly children: ReactNode
    readonly className?: string
    readonly 'data-desktop-appointment-row'?: string
    readonly 'data-mobile-appointment-row'?: string
  }) => (
    <a
      href="/appointment"
      className={className}
      data-desktop-appointment-row={desktopRow}
      data-mobile-appointment-row={mobileRow}
    >
      {children}
    </a>
  )
}))

const calendar = {
  date: '2026-07-22',
  timezone: 'Europe/Bucharest',
  providers: [
    {
      provider: { id: 'provider-1', displayName: 'Mara' },
      appointments: [
        {
          id: 'appointment-1',
          merchantId: 'merchant-1',
          providerId: 'provider-1',
          status: 'scheduled' as const,
          startsAt: '2026-07-22T09:00:00.000Z',
          endsAt: '2026-07-22T09:30:00.000Z',
          createdAt: '2026-07-20T09:00:00.000Z',
          snapshot: {
            startsAt: '2026-07-22T09:00:00.000Z',
            endsAt: '2026-07-22T09:30:00.000Z',
            providerPreference: { kind: 'any' as const },
            assignedProvider: { id: 'provider-1', displayName: 'Mara' },
            services: [
              {
                id: 'service-1',
                role: 'primary' as const,
                name: 'Haircut',
                durationMinutes: 30,
                priceMinor: 5_000,
                currency: 'RON'
              }
            ],
            durationMinutes: 30,
            currency: 'RON',
            totalMinor: 5_000,
            merchantTimezone: 'Europe/Bucharest',
            customerDetails: {
              name: 'Previous-day customer',
              email: 'customer@example.test',
              phone: null
            },
            checkoutPath: 'pay_in_person' as const
          }
        }
      ]
    }
  ]
}

describe('MobileAppointmentLedger', () => {
  it('uses native-style distance and release-velocity thresholds', () => {
    expect(
      shouldCommitAppointmentDaySwipe({
        distance: 70,
        duration: 1_000,
        width: 360
      })
    ).toBe(false)
    expect(
      shouldCommitAppointmentDaySwipe({
        distance: 24,
        duration: 1_000,
        velocity: 0.8,
        width: 360
      })
    ).toBe(true)
  })

  it('can own the mobile schedule scroll without moving the date controls', () => {
    const html = renderToStaticMarkup(
      <MobileAppointmentLedger calendar={calendar} pending scrollable />
    )

    expect(html).toContain('data-mobile-appointment-scroll="true"')
    expect(html).toContain('merchant-mobile-appointment-scrollport')
    expect(html).toContain('overscroll-y-contain')
    expect(html).not.toContain('overscroll-y-none')
  })

  it('renders appointment events without a schedule summary row', () => {
    const html = renderToStaticMarkup(
      <MobileAppointmentLedger calendar={calendar} scrollable />
    )

    expect(html).toContain('Previous-day customer')
    expect(html).toContain('data-mobile-appointment-row="true"')
    expect(html).toContain('min-h-24')
    expect(html).toContain('after:inset-x-5')
    expect(html).not.toContain('Schedule')
    expect(html).not.toContain('1 Appointment')
  })

  it('uses compact appointment rows for the desktop schedule', () => {
    const html = renderToStaticMarkup(
      <MobileAppointmentLedger calendar={calendar} rowPresentation="desktop" />
    )

    expect(html).toContain('data-desktop-appointment-row="true"')
    expect(html).toContain('min-h-16')
    expect(html).not.toContain('min-h-24')
    expect(html).not.toContain('data-mobile-appointment-row="true"')
  })

  it('only reserves action-bar scroll space for a populated current day', () => {
    const populated = renderToStaticMarkup(
      <MobileAppointmentLedger calendar={calendar} scrollable />
    )
    const empty = renderToStaticMarkup(
      <MobileAppointmentLedger
        calendar={{ ...calendar, providers: [] }}
        previousCalendar={calendar}
        scrollable
      />
    )

    expect(populated).toContain('pb-[calc(8rem+env(safe-area-inset-bottom))]')
    expect(empty).not.toContain('pb-[calc(8rem+env(safe-area-inset-bottom))]')
    expect(empty).toContain('data-mobile-appointment-scroll="true"')
    expect(empty).toContain('overflow-hidden')
  })

  it('does not present stale appointments while the newly selected day loads', () => {
    const html = renderToStaticMarkup(
      <MobileAppointmentLedger calendar={calendar} pending />
    )

    expect(html).toContain('Loading appointments for selected day')
    expect(html).not.toContain('Previous-day customer')
  })
})
