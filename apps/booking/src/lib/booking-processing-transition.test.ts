// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearBookingProcessingSuccess,
  readBookingProcessingSuccess,
  replaceWithBookingSuccess
} from './booking-processing-transition.ts'

afterEach(() => {
  clearBookingProcessingSuccess()
  window.history.replaceState(null, '', '/')
})

describe('booking processing transition', () => {
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
