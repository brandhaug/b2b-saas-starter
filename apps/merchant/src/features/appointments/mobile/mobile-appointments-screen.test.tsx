import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MerchantPresentationProvider } from '@/components/merchant-shell/merchant-presentation.tsx'
import { MobileAppointmentsScreen } from './mobile-appointments-screen.tsx'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { readonly children: ReactNode; readonly to: string }) => (
    <a href={to}>{children}</a>
  ),
  useRouter: () => ({ navigate: vi.fn() })
}))

const calendar = {
  date: '2026-07-27',
  timezone: 'Europe/Bucharest',
  providers: []
}

describe('MobileAppointmentsScreen', () => {
  it('keeps the desktop week strip outside the appointment scrollport', () => {
    const html = renderToStaticMarkup(
      <MerchantPresentationProvider presentation="desktop">
        <MobileAppointmentsScreen calendar={calendar} selectedDate={calendar.date} />
      </MerchantPresentationProvider>
    )
    const weekStrip = html.indexOf('aria-label="Appointment week"')
    const scrollport = html.indexOf('data-desktop-appointment-scroll="true"')
    const appointmentList = html.indexOf('aria-label="Appointments for selected day"')

    expect(weekStrip).toBeGreaterThan(-1)
    expect(scrollport).toBeGreaterThan(weekStrip)
    expect(appointmentList).toBeGreaterThan(scrollport)
    expect(html).toContain('data-desktop-appointments-layout="fixed-week-strip"')
  })
})
