import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MobileAppointmentSummary } from './mobile-appointment-summary.tsx'

describe('MobileAppointmentSummary', () => {
  it('keeps the icon, count, and singular noun together', () => {
    const html = renderToStaticMarkup(
      <MobileAppointmentSummary
        appointmentCount={1}
        isToday
        pending={false}
        weekday="Thursday"
      />
    )

    expect(html).toContain('data-mobile-appointment-summary-count="true"')
    expect(html).toContain('whitespace-nowrap')
    expect(html).toContain('1 appointment')
    expect(html).toContain('today.')
    expect(html).toContain('lucide-calendar-days')
    expect(html).toContain('align-[-0.12em]')
    expect(html).not.toContain('inline-flex')
    expect(html).not.toContain('bg-foreground')
  })

  it('uses plural copy for another selected day', () => {
    const html = renderToStaticMarkup(
      <MobileAppointmentSummary
        appointmentCount={3}
        isToday={false}
        pending={false}
        weekday="Friday"
      />
    )

    expect(html).toContain('3 appointments')
    expect(html).toContain('on Friday.')
  })

  it('describes an empty current day without a zero-count icon', () => {
    const html = renderToStaticMarkup(
      <MobileAppointmentSummary
        appointmentCount={0}
        isToday
        pending={false}
        weekday="Thursday"
      />
    )

    expect(html).toContain('You have')
    expect(html).toContain('>nothing<')
    expect(html).toContain('left today.')
    expect(html).not.toContain('lucide-calendar-days')
    expect(html).not.toContain('0 appointments')
  })

  it('describes an empty selected date without claiming it is today', () => {
    const html = renderToStaticMarkup(
      <MobileAppointmentSummary
        appointmentCount={0}
        isToday={false}
        pending={false}
        weekday="Friday"
      />
    )

    expect(html).toContain('nothing')
    expect(html).toContain('scheduled on Friday.')
  })
})
