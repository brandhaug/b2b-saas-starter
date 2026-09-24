import { describe, expect, it, vi } from 'vite-plus/test'
import { formatTimestamp } from './format-date'

vi.mock('./i18n', () => ({ presentationSettings: () => ({ timeZone: zone.value }) }))
const zone = vi.hoisted(() => ({ value: 'UTC' }))

describe('formatTimestamp', () => {
  it('keeps calendar dates stable while converting instants to the account zone', () => {
    zone.value = 'America/Los_Angeles'
    expect(formatTimestamp('2026-05-16', { dateStyle: 'medium' })).toBe('May 16, 2026')
    expect(formatTimestamp('2026-05-16T00:00:00.000Z', { dateStyle: 'medium' })).toBe(
      'May 15, 2026'
    )
    zone.value = 'UTC'
  })
})
