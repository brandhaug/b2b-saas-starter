import { describe, expect, it, vi } from 'vite-plus/test'
import { formatTimestamp, formatTimestampOr } from './format-date'

vi.mock('./i18n', () => ({ presentationSettings: () => ({ timeZone: zone.value }) }))
const zone = vi.hoisted(() => ({ value: 'UTC' }))

describe('formatTimestamp', () => {
  it('formats in UTC regardless of the ambient time zone', () => {
    expect(formatTimestamp('2026-05-16T09:00:00.000Z')).toBe('5/16/2026, 9:00:00 AM')
  })

  it('keeps calendar dates stable while converting instants to the account zone', () => {
    zone.value = 'America/Los_Angeles'
    expect(formatTimestamp('2026-05-16', { dateStyle: 'medium' })).toBe('May 16, 2026')
    expect(formatTimestamp('2026-05-16T00:00:00.000Z', { dateStyle: 'medium' })).toBe(
      'May 15, 2026'
    )
    zone.value = 'UTC'
  })

  it('accepts a Date as well as an ISO string', () => {
    expect(formatTimestamp(new Date('2026-05-16T09:00:00.000Z'))).toBe(
      '5/16/2026, 9:00:00 AM'
    )
  })

  it('passes the field selection through to Intl', () => {
    expect(formatTimestamp('2026-05-16T09:00:00.000Z', { dateStyle: 'medium' })).toBe(
      'May 16, 2026'
    )
  })
})

describe('formatTimestampOr', () => {
  it('shows the fallback copy for an absent value', () => {
    expect(formatTimestampOr(null, 'never')).toBe('never')
  })

  it('formats a present value', () => {
    expect(formatTimestampOr('2026-05-16T09:00:00.000Z', 'never')).toBe(
      '5/16/2026, 9:00:00 AM'
    )
  })
})
