// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearBookingProcessingSuccess,
  exchangeBookingConfirmationAccess,
  readBookingProcessingSuccess,
  replaceWithBookingSuccess
} from './booking-processing-transition.ts'

afterEach(() => {
  clearBookingProcessingSuccess()
  window.history.replaceState(null, '', '/')
})

describe('booking processing transition', () => {
  it('exchanges the bearer URL before exposing the confirmation route', async () => {
    const fetchConfirmation = vi.fn(async () => ({
      ok: true,
      url: `${window.location.origin}/merchant/booking/confirmations/cnf_demo`
    }))

    await expect(
      exchangeBookingConfirmationAccess(
        '/merchant/booking/confirmations/cnf_demo?token=secret',
        fetchConfirmation
      )
    ).resolves.toBe('/merchant/booking/confirmations/cnf_demo')
    expect(fetchConfirmation).toHaveBeenCalledWith(
      '/merchant/booking/confirmations/cnf_demo?token=secret',
      { credentials: 'same-origin' }
    )
  })

  it('moves to the confirmation route immediately and carries the success phase', () => {
    window.history.replaceState({ existing: true }, '', '/merchant/booking')

    replaceWithBookingSuccess(
      '/merchant/booking/confirmations/cnf_demo?token=secret',
      'Success'
    )

    expect(window.location.pathname).toBe('/merchant/booking/confirmations/cnf_demo')
    expect(window.location.search).toBe('?token=secret')
    expect(window.history.state.existing).toBe(true)
    expect(readBookingProcessingSuccess()).toEqual({
      expiresAt: expect.any(Number),
      label: 'Success'
    })
  })
})
