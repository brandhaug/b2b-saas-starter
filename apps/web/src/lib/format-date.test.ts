import { describe, expect, it } from 'vite-plus/test'
import { formatUtc, formatUtcOr } from './format-date'

describe('formatUtc', () => {
  it('formats in UTC regardless of the ambient time zone', () => {
    expect(formatUtc('2026-05-16T09:00:00.000Z')).toBe('5/16/2026, 9:00:00 AM')
  })

  it('accepts a Date as well as an ISO string', () => {
    expect(formatUtc(new Date('2026-05-16T09:00:00.000Z'))).toBe(
      formatUtc('2026-05-16T09:00:00.000Z')
    )
  })

  it('passes the field selection through to Intl', () => {
    expect(formatUtc('2026-05-16T09:00:00.000Z', { dateStyle: 'medium' })).toBe(
      'May 16, 2026'
    )
  })
})

describe('formatUtcOr', () => {
  it('shows the fallback copy for an absent value', () => {
    expect(formatUtcOr(null, 'never')).toBe('never')
  })

  it('formats a present value', () => {
    expect(formatUtcOr('2026-05-16T09:00:00.000Z', 'never')).toBe(
      formatUtc('2026-05-16T09:00:00.000Z')
    )
  })
})
