import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  merchantHomeCalendarQuery,
  merchantHomeCalendarQueryKey
} from './merchant-home-queries.ts'

const { getMerchantHomeCalendar } = vi.hoisted(() => ({
  getMerchantHomeCalendar: vi.fn()
}))

vi.mock('./server/merchant-home-calendar.ts', () => ({ getMerchantHomeCalendar }))
vi.mock('./server/merchant-onboarding.ts', () => ({
  getMerchantPublicBookingUrl: vi.fn()
}))

describe('merchant home query keys', () => {
  beforeEach(() => getMerchantHomeCalendar.mockReset())

  it('caches each appointment day independently', () => {
    expect(merchantHomeCalendarQueryKey('2026-07-22')).not.toEqual(
      merchantHomeCalendarQueryKey('2026-07-23')
    )
  })

  it('reuses a visited day while keeping another day in a separate cache entry', async () => {
    getMerchantHomeCalendar
      .mockResolvedValueOnce({
        date: '2026-07-22',
        timezone: 'Europe/Bucharest',
        providers: []
      })
      .mockResolvedValueOnce({
        date: '2026-07-23',
        timezone: 'Europe/Bucharest',
        providers: []
      })
    const client = new QueryClient()

    await client.fetchQuery(
      merchantHomeCalendarQuery('2026-07-22', '/appointments?date=2026-07-22')
    )
    await client.fetchQuery(
      merchantHomeCalendarQuery('2026-07-22', '/appointments?date=2026-07-22')
    )
    await client.fetchQuery(
      merchantHomeCalendarQuery('2026-07-23', '/appointments?date=2026-07-23')
    )

    expect(getMerchantHomeCalendar).toHaveBeenCalledTimes(2)
    expect(client.getQueryData(merchantHomeCalendarQueryKey('2026-07-22'))).toEqual(
      expect.objectContaining({ date: '2026-07-22' })
    )
    expect(client.getQueryData(merchantHomeCalendarQueryKey('2026-07-23'))).toEqual(
      expect.objectContaining({ date: '2026-07-23' })
    )
  })
})
