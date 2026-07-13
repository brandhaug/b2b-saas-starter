import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  BookingCancellations,
  SeedBookingCancellations,
  emptySeedBookingCancellationStore,
  type CancellableAppointment
} from './booking-cancellation.ts'

const now = '2026-07-13T10:00:00.000Z'

const appointment = (
  id: string,
  overrides: Partial<CancellableAppointment> = {}
): CancellableAppointment => ({
  id,
  merchantId: 'mrc_one',
  bookingPartyId: 'bpt_group',
  status: 'scheduled',
  version: 1,
  startsAt: '2026-07-14T10:00:00.000Z',
  totalMinor: 5_000,
  currency: 'USD',
  cancellationPolicy: {
    id: 'pol_cancel_v2',
    version: 2,
    cancellableUntilMinutesBeforeStart: 60
  },
  refundPolicy: {
    id: 'pol_refund_v3',
    version: 3,
    refundableUntilMinutesBeforeStart: 120,
    refundBasisPoints: 10_000
  },
  settlementAllocations: [
    { tender: 'gift_card', referenceId: 'gcd_one', amountMinor: 2_000 },
    { tender: 'external_payment', referenceId: 'pay_one', amountMinor: 3_000 }
  ],
  ...overrides
})

const run = <A, E>(
  store: ReturnType<typeof emptySeedBookingCancellationStore>,
  effect: Effect.Effect<A, E, BookingCancellations>
) => Effect.runPromise(effect.pipe(Effect.provide(SeedBookingCancellations(store))))

describe('Booking cancellation contract', () => {
  it('evaluates cancellation eligibility separately from refund entitlement', async () => {
    const record = appointment('apt_policy', {
      startsAt: '2026-07-13T11:30:00.000Z'
    })
    const store = emptySeedBookingCancellationStore([record])

    await expect(
      run(
        store,
        Effect.flatMap(BookingCancellations, (service) =>
          service.evaluate({
            merchantId: 'mrc_one',
            appointmentId: record.id,
            now
          })
        )
      )
    ).resolves.toEqual({
      appointmentId: record.id,
      cancellation: { eligible: true, policyId: 'pol_cancel_v2', policyVersion: 2 },
      refund: {
        entitled: false,
        amountMinor: 0,
        currency: 'USD',
        policyId: 'pol_refund_v3',
        policyVersion: 3,
        allocations: []
      }
    })
  })

  it('cancels one appointment without changing siblings and records immutable history', async () => {
    const first = appointment('apt_first')
    const sibling = appointment('apt_sibling')
    const store = emptySeedBookingCancellationStore([first, sibling])
    const cancel = () =>
      run(
        store,
        Effect.flatMap(BookingCancellations, (service) =>
          service.cancel({
            merchantId: 'mrc_one',
            scope: { kind: 'appointment', appointmentId: first.id },
            idempotencyKey: 'cancel-first-once',
            reason: 'customer_requested',
            now
          })
        )
      )

    const result = await cancel()
    expect(result.appointments.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: first.id, status: 'cancelled' }
    ])
    expect(result.refundObligations).toEqual([
      expect.objectContaining({
        appointmentId: first.id,
        status: 'pending',
        amountMinor: 5_000,
        allocations: [
          { tender: 'gift_card', referenceId: 'gcd_one', amountMinor: 2_000 },
          { tender: 'external_payment', referenceId: 'pay_one', amountMinor: 3_000 }
        ]
      })
    ])
    expect(store.appointments.get(sibling.id)?.status).toBe('scheduled')
    expect(store.history).toEqual([
      expect.objectContaining({
        appointmentId: first.id,
        fromStatus: 'scheduled',
        toStatus: 'cancelled',
        reason: 'customer_requested'
      })
    ])
    expect(await cancel()).toEqual({ ...result, replayed: true })
    expect(store.history).toHaveLength(1)
    expect(store.refundObligations).toHaveLength(1)
  })

  it('cancels a whole party explicitly and rejects it atomically when one sibling is ineligible', async () => {
    const eligible = appointment('apt_eligible')
    const completed = appointment('apt_completed', { status: 'completed' })
    const store = emptySeedBookingCancellationStore([eligible, completed])

    await expect(
      run(
        store,
        Effect.flatMap(BookingCancellations, (service) =>
          service.cancel({
            merchantId: 'mrc_one',
            scope: { kind: 'party', bookingPartyId: 'bpt_group' },
            idempotencyKey: 'cancel-party-once',
            reason: 'customer_requested',
            now
          })
        )
      )
    ).rejects.toMatchObject({ code: 'cancellation_ineligible' })
    expect(store.appointments.get(eligible.id)?.status).toBe('scheduled')
    expect(store.history).toHaveLength(0)
    expect(store.refundObligations).toHaveLength(0)
  })

  it('uses the same not-found result for unknown and cross-merchant appointments', async () => {
    const record = appointment('apt_private')
    const store = emptySeedBookingCancellationStore([record])
    const evaluate = (merchantId: string, appointmentId: string) =>
      run(
        store,
        Effect.flatMap(BookingCancellations, (service) =>
          service.evaluate({ merchantId, appointmentId, now })
        )
      )

    await expect(evaluate('mrc_other', record.id)).rejects.toMatchObject({
      code: 'appointment_not_found'
    })
    await expect(evaluate('mrc_one', 'apt_unknown')).rejects.toMatchObject({
      code: 'appointment_not_found'
    })
  })
})
