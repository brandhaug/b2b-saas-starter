import { describe, expect, it } from 'vitest'
import {
  decodeAppointmentCalendarSearch,
  decodeCalendarDate
} from './appointment-calendar-date.ts'

describe('appointment calendar dates', () => {
  it('accepts valid date-only values', () => {
    expect(decodeCalendarDate('2028-02-29')).toBe('2028-02-29')
    expect(decodeAppointmentCalendarSearch({ date: '2026-07-20' })).toEqual({
      date: '2026-07-20'
    })
  })

  it.each(['not-a-date', '2026-02-29', '2026-13-01', '2026-7-20'])(
    'rejects invalid calendar date %s',
    (date) => {
      expect(() => decodeCalendarDate(date)).toThrow()
    }
  )
})
