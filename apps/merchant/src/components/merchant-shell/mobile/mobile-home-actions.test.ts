import { describe, expect, it } from 'vitest'
import { mobileCalendarDockAction } from './mobile-home-actions.tsx'
import { mobileCalendarMonth } from './mobile-calendar-sheet.tsx'

describe('mobile appointment action dock', () => {
  it('opens the calendar while the current day is selected', () => {
    expect(mobileCalendarDockAction('2026-07-21', '2026-07-21')).toBe('open-calendar')
  })

  it('returns to today before opening the calendar', () => {
    expect(mobileCalendarDockAction('2026-07-20', '2026-07-21')).toBe('return-today')
  })
})

describe('mobile calendar sheet', () => {
  it('builds a Monday-first month with blank leading cells', () => {
    const month = mobileCalendarMonth('2026-07-21')

    expect(month.label).toBe('Jul 2026')
    expect(month.leadingBlankDays).toBe(2)
    expect(month.days).toHaveLength(31)
    expect(month.days[0]?.date).toBe('2026-07-01')
    expect(month.days.at(-1)?.date).toBe('2026-07-31')
    expect(month.days.find((day) => day.selected)?.date).toBe('2026-07-21')
    expect(month.previousMonth).toBe('2026-06-01')
    expect(month.nextMonth).toBe('2026-08-01')
  })
})
