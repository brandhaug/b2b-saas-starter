import { describe, expect, it } from 'vitest'
import { buildSeedSql } from '../scripts/seed.ts'
import { bookingProductWorkers } from './topology.ts'

describe('Booking Product verification contract', () => {
  it('keeps exactly six settled Worker identities', () => {
    expect(Object.keys(bookingProductWorkers)).toEqual([
      'web',
      'merchant',
      'operations',
      'booking',
      'api',
      'background'
    ])
  })

  it('renders the canonical seed deterministically and scopes replacement', () => {
    const first = buildSeedSql()
    const second = buildSeedSql()
    expect(second).toBe(first)
    expect(first).toContain(
      "DELETE FROM merchants WHERE id = 'mer_seed_booking_studio'"
    )
    expect(first).not.toMatch(/DELETE FROM merchants(?:;|\s+WHERE id !=)/)
    expect(first).toContain("'mara-booking-studio'")
    expect(first).toContain("'apt_seed_future'")
  })
})
