import { describe, expect, it } from 'vite-plus/test'
import { formatCurrency, formatDate, formatNumber, pluralCategory } from './format.ts'

describe('format helpers', () => {
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

  it('selects plural categories through Intl', () => {
    expect(pluralCategory(1, 'en')).toBe('one')
    expect(pluralCategory(2, 'en')).toBe('other')
    expect(pluralCategory(1, 'nb')).toBe('one')
  })
})
