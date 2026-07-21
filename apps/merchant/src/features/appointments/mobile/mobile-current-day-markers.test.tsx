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
      />
    )
    const anotherDay = renderToStaticMarkup(
      <MobileDateHero
        date="2026-07-21"
        currentDate="2026-07-20"
        timezone="Europe/Bucharest"
      />
    )

    expect(today.match(/data-current-day-marker="true"/g)).toHaveLength(1)
    expect(anotherDay).not.toContain('data-current-day-marker="true"')
  })

  it('shows one dot on the current day in the week strip', () => {
    const html = renderToStaticMarkup(
      <MobileWeekStrip selectedDate="2026-07-22" currentDate="2026-07-20" />
    )

    expect(html.match(/data-current-day-marker="true"/g)).toHaveLength(1)
    expect(html).toMatch(/data-current-day-marker="true"[\s\S]*?>20<\/span>/)
  })
})
