import { describe, expect, it } from 'vitest'
import { formatProviderAvailability } from './provider-availability-format.ts'

describe('provider availability formatting', () => {
  it('uses the Shop calendar for legacy relative and dated labels', () => {
    const now = new Date('2026-07-14T20:30:00.000Z')

    expect(
      formatProviderAvailability(
        '2026-07-15T06:00:00.000Z',
        'Europe/Bucharest',
        'en',
        now
      )
    ).toBe('Tomorrow')
    expect(
      formatProviderAvailability(
        '2026-07-17T06:00:00.000Z',
        'Europe/Bucharest',
        'en',
        now
      )
    ).toBe('Friday, Jul 17')
  })
})
