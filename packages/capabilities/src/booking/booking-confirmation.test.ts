import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { emptySeedBookingSelectionStore } from './booking-selection.ts'
import { emptySeedBookingSchedulingStore } from './booking-scheduling.ts'
import { emptySeedBookingCheckoutStore } from './booking-checkout.ts'
import {
  BookingConfirmation,
  emptySeedBookingConfirmationStore,
  SeedBookingConfirmation
} from './booking-confirmation.ts'
import {
  emptySeedPaymentSettlementStore,
  SeedPaymentSettlement
} from '../payments/payment-settlement.ts'
import {
  emptySeedBookingSessionStore,
  type BookingSession
} from './booking-sessions.ts'
import type { SeedBookingScenario } from '../merchant-catalog/merchant-onboarding.ts'

const now = '2026-07-12T09:00:00.000Z'
const scenario = {
  merchant: {
    id: 'mer_party',
    slug: 'party',
    publicName: 'Party Studio',
    timezone: 'Europe/Bucharest',
    currency: 'RON'
  },
  providers: [],
  services: [],
  eligibility: [],
  scheduleRules: [],
  existingAppointments: []
} as unknown as SeedBookingScenario

const quote = (requestId: string, providerId: string, startsAt: string) => ({
  startsAt,
  endsAt: new Date(Date.parse(startsAt) + 3_600_000).toISOString(),
  providerPreference: { kind: 'any' as const },
  assignedProvider: { id: providerId, displayName: providerId },
  services: [
    {
      id: `svc_${requestId}`,
      role: 'primary' as const,
      name: 'Service',
      durationMinutes: 60,
      priceMinor: 10000,
      currency: 'RON'
    }
  ],
  durationMinutes: 60,
  currency: 'RON',
  totalMinor: 10000
})

describe('Booking Confirmation', () => {
  it('atomically confirms every request and replays the same party result', async () => {
    const sessions = emptySeedBookingSessionStore()
    const session: BookingSession = {
      id: 'bsn_party',
      merchantSlug: 'party',
      checkoutPath: 'pay_in_person',
      lifecycle: 'active',
      createdAt: now,
      lastActivityAt: now,
      idleExpiresAt: '2026-07-12T10:00:00.000Z',
      absoluteExpiresAt: '2026-07-12T11:00:00.000Z'
    }
    sessions.sessions.set(session.id, {
      ...session,
      merchantId: 'mer_party',
      capabilityHash: 'hash'
    })
    const selections = emptySeedBookingSelectionStore(
      scenario as unknown as Parameters<typeof emptySeedBookingSelectionStore>[0]
    )
    const scheduling = emptySeedBookingSchedulingStore(scenario, selections)
    scheduling.partyRequests.set(session.id, new Set(['brq_one', 'brq_two']))
    for (const [requestId, providerId, startsAt] of [
      ['brq_one', 'prv_one', '2026-07-13T09:00:00.000Z'],
      ['brq_two', 'prv_two', '2026-07-13T10:00:00.000Z']
    ] as const) {
      const requestQuote = quote(requestId, providerId, startsAt)
      scheduling.holds.set(`hld_${requestId}`, {
        id: `hld_${requestId}`,
        merchantId: 'mer_party',
        bookingSessionId: session.id,
        bookingRequestId: requestId,
        providerId,
        startsAt: requestQuote.startsAt,
        endsAt: requestQuote.endsAt,
        createdAt: now,
        expiresAt: '2026-07-12T09:30:00.000Z',
        quote: requestQuote
      })
    }
    const checkout = emptySeedBookingCheckoutStore(scheduling)
    checkout.details.set('brq_one', {
      name: 'Mia',
      email: 'mia@example.com',
      phone: null
    })
    checkout.details.set('brq_two', {
      name: 'Noah',
      email: 'noah@example.com',
      phone: null
    })
    const store = emptySeedBookingConfirmationStore(sessions, checkout)
    const layer = SeedBookingConfirmation(store, {
      currentKeyId: 'test',
      keys: { test: 'confirmation-test-key' }
    }).pipe(Layer.provide(SeedPaymentSettlement(emptySeedPaymentSettlementStore())))
    const confirm = (value: BookingSession) =>
      Effect.runPromise(
        Effect.provide(
          Effect.flatMap(BookingConfirmation, (service) =>
            service.confirm(value, { now, traceId: 'trace_party' })
          ),
          layer
        )
      )

    const first = await confirm(session)
    const replay = await confirm({ ...session, lifecycle: 'consumed' })

    expect(first.appointments.map((appointment) => appointment.providerId)).toEqual([
      'prv_one',
      'prv_two'
    ])
    expect(first.accesses).toHaveLength(2)
    expect(first.outboxIds).toHaveLength(2)
    expect(replay).toEqual({ ...first, replayed: true })
    expect(store.appointments).toHaveLength(2)
    expect(scheduling.holds).toHaveLength(0)

    const protectedParty = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingConfirmation, (service) =>
          service.read({
            routeId: first.access.routeId,
            merchantSlug: 'party',
            credential: first.access.token,
            credentialKind: 'bearer',
            now
          })
        ),
        layer
      )
    )
    expect(protectedParty).toMatchObject({
      kind: 'found',
      confirmation: { appointments: [{}, {}] }
    })
  })
})
