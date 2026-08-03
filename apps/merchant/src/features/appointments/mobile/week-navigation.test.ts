import { describe, expect, it } from 'vitest'
import {
  appointmentDayTarget,
  appointmentWeekDirection,
  appointmentWeekTarget
} from './week-navigation.ts'

describe('appointment week navigation', () => {
  it('preserves the selected weekday across week changes', () => {
    expect(appointmentWeekTarget('2026-07-22', 'previous')).toBe('2026-07-15')
    expect(appointmentWeekTarget('2026-07-22', 'next')).toBe('2026-07-29')
  })

  it('crosses month and year boundaries as calendar dates', () => {
    expect(appointmentWeekTarget('2026-12-30', 'next')).toBe('2027-01-06')
    expect(appointmentWeekTarget('2027-01-04', 'previous')).toBe('2026-12-28')
  })

  it('moves one calendar day for ledger swipes across month boundaries', () => {
    expect(appointmentDayTarget('2026-07-31', 'next')).toBe('2026-08-01')
    expect(appointmentDayTarget('2026-08-01', 'previous')).toBe('2026-07-31')
  })

  it('animates only when the selected week changes', () => {
    expect(appointmentWeekDirection('2026-07-20', '2026-07-22')).toBe(null)
    expect(appointmentWeekDirection('2026-07-22', '2026-07-29')).toBe('next')
    expect(appointmentWeekDirection('2026-07-29', '2026-07-15')).toBe('previous')
  })
})
