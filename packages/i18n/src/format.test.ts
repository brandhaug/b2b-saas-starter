import { describe, expect, it } from 'vite-plus/test'
import { formatCurrency, formatDate, formatDateTime, formatNumber } from './format.ts'

describe('format helpers', () => {
  // Failure cases: combined style connectors differ across ICU versions,
  // splitting a date/time loses its timezone or hour cycle, and calendar dates
  // accidentally shift to the previous day in western timezones.
  it('keeps combined styles stable with locale, zone and hour-cycle options', () => {
    const timestamp = '2026-11-01T11:48:00.000Z'
    expect(formatDateTime(timestamp, 'en', undefined, 'Europe/Oslo')).toBe(
      'Nov 1, 2026, 12:48 PM'
    )
    expect(formatDateTime(timestamp, 'nb', undefined, 'Europe/Oslo')).toBe(
      '1. nov. 2026, 12:48'
    )
    expect(
      formatDate(
        timestamp,
        'en',
        {
          dateStyle: 'medium',
          timeStyle: 'short',
          hour12: false
        },
        'America/New_York'
      )
    ).toBe('Nov 1, 2026, 06:48')
    expect(
      formatDate(
        '2026-05-16',
        'en',
        {
          dateStyle: 'medium',
          timeStyle: 'short'
        },
        'America/New_York'
      )
    ).toBe('May 16, 2026, 12:00 AM')
  })

  it('formats dates with the supplied locale and timezone', () => {
    const timestamp = '2026-05-16T23:00:00.000Z'
    expect(formatDate(timestamp, 'en', { dateStyle: 'short' }, 'UTC')).toBe('5/16/26')
    expect(formatDate(timestamp, 'nb', { dateStyle: 'short' }, 'Europe/Oslo')).toBe(
      '17.05.2026'
    )
    expect(
      formatDate('2026-05-16', 'en', { dateStyle: 'short' }, 'America/New_York')
    ).toBe('5/16/26')
  })

  it('uses locale-specific number and currency conventions', () => {
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5')
    expect(formatNumber(1234.5, 'nb')).toBe('1 234,5')
    expect(formatCurrency(1234.5, 'EUR', 'nb')).toContain('1 234,50')
  })
})
