import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MobileDateHero } from './mobile-date-hero.tsx'
import { MobileWeekStrip } from './mobile-week-strip.tsx'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  )
}))

describe('mobile current-day markers', () => {
  it('shows the hero dot only when the selected date is today', () => {
    const today = renderToStaticMarkup(
      <MobileDateHero
        date="2026-07-20"
        currentDate="2026-07-20"
        timezone="Europe/Bucharest"
        calendarOpen={false}
        onOpenCalendar={() => undefined}
        onReturnToCurrentDay={() => undefined}
      />
    )
    const anotherDay = renderToStaticMarkup(
      <MobileDateHero
        date="2026-07-21"
        currentDate="2026-07-20"
        timezone="Europe/Bucharest"
        calendarOpen={false}
        onOpenCalendar={() => undefined}
        onReturnToCurrentDay={() => undefined}
      />
    )

    expect(today.match(/data-current-day-marker="true"/g)).toHaveLength(1)
    expect(anotherDay).not.toContain('data-current-day-marker="true"')
    expect(today).toContain('data-current-day-marker-slot="true"')
    expect(anotherDay).toContain('data-current-day-marker-slot="true"')
    expect(today).toContain('data-current-day-marker-state="visible"')
    expect(anotherDay).toContain('data-current-day-marker-state="hidden"')
    expect(anotherDay).toContain('opacity:0')
    expect(today).toContain('data-mobile-date-current-day-trigger="true"')
    expect(today).toContain('aria-current="date"')
    expect(anotherDay).not.toContain('aria-current="date"')
  })

  it('shows one dot on the current day in the week strip', () => {
    const html = renderToStaticMarkup(
      <MobileWeekStrip
        selectedDate="2026-07-22"
        currentDate="2026-07-20"
        onSelectDate={() => {}}
      />
    )

    expect(html.match(/data-current-day-marker="true"/g)).toHaveLength(1)
    expect(html).toMatch(/data-current-day-marker="true"[\s\S]*?>20<\/span>/)
  })

  it('keeps mobile spacing while allowing a compact desktop gap', () => {
    const mobile = renderToStaticMarkup(
      <MobileWeekStrip
        selectedDate="2026-07-22"
        currentDate="2026-07-20"
        onSelectDate={() => {}}
      />
    )
    const desktop = renderToStaticMarkup(
      <MobileWeekStrip
        selectedDate="2026-07-22"
        currentDate="2026-07-20"
        spacing="desktop"
        onSelectDate={() => {}}
      />
    )

    expect(mobile).toContain('data-week-strip-spacing="mobile"')
    expect(mobile).toContain('class="mt-3 relative"')
    expect(desktop).toContain('data-week-strip-spacing="desktop"')
    expect(desktop).toContain('class="mt-4 relative"')
    expect(desktop).toContain('aria-label="Previous week"')
    expect(desktop).toContain('aria-label="Next week"')
  })
})
