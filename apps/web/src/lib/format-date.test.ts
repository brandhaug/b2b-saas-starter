import { describe, expect, it, vi } from 'vite-plus/test'
import { formatCalendarDate, formatTimestamp } from './format-date'

vi.mock('./i18n', () => ({ presentationSettings: () => ({ timeZone: zone.value }) }))
const zone = vi.hoisted(() => ({ value: 'UTC' }))

describe('formatCalendarDate', () => {
  it('keeps calendar dates stable while converting instants to the account zone', () => {
    zone.value = 'America/Los_Angeles'
    expect(formatCalendarDate('2026-05-16')).toBe('May 16, 2026')
    expect(formatCalendarDate('2026-05-16T00:00:00.000Z')).toBe('May 15, 2026')
    zone.value = 'UTC'
  })
})

describe('formatTimestamp', () => {
  it('names the display zone it converted to', () => {
    zone.value = 'America/Los_Angeles'
    expect(formatTimestamp('2026-05-16T14:30:00.000Z')).toBe(
      'May 16, 2026, 7:30 AM America/Los_Angeles'
    )
    zone.value = 'UTC'
  })
})
