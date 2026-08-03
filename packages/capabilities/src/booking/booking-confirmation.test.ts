import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  emptySeedBookingSelectionStore,
  seedBookingSelectionEligibilityKey
} from './booking-selection.ts'
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
import { buildSeedBookingScenario } from '../merchant-catalog/merchant-onboarding.ts'

const now = '2026-07-12T09:00:00.000Z'
const scenario = buildSeedBookingScenario('2026-07-10T09:30:00.000Z')

const quote = (requestId: string, providerId: string, startsAt: string) => ({
  startsAt,
  endsAt: new Date(Date.parse(startsAt) + 3_600_000).toISOString(),
  providerPreference: { kind: 'any' as const },
  assignedProvider: { id: providerId, displayName: providerId },
  services: [
    {
      id: scenario.services[0]!.id,
      role: 'primary' as const,
      name: scenario.services[0]!.name,
      durationMinutes: scenario.services[0]!.durationMinutes,
      priceMinor: scenario.services[0]!.priceMinor,
      currency: scenario.services[0]!.currency
    }
  ],
  durationMinutes: 60,
  currency: 'RON',
  totalMinor: 10000
})

describe('Booking Confirmation', () => {
  it('rejects confirmation access outside the canonical Appointment set', () => {
    const invalidScenario = {
      ...scenario,
      confirmationAccess: [
        { ...scenario.confirmationAccess[0]!, appointmentId: 'apt_other' }
      ]
    }
    const selections = emptySeedBookingSelectionStore({
      merchants: [],
      providers: invalidScenario.providers,
      services: invalidScenario.services,
      eligibility: invalidScenario.eligibility.map(seedBookingSelectionEligibilityKey)
    })
    const scheduling = emptySeedBookingSchedulingStore(invalidScenario, selections)
    const checkout = emptySeedBookingCheckoutStore(scheduling)

    expect(() =>
      emptySeedBookingConfirmationStore(emptySeedBookingSessionStore(), checkout)
    ).toThrow('Confirmation access references an unknown fixture Appointment')
  })

  it('atomically confirms every request and replays the same party result', async () => {
    const sessions = emptySeedBookingSessionStore()
    const session: BookingSession = {
      id: 'bsn_party',
      merchantSlug: scenario.merchant.slug,
      checkoutPath: 'pay_in_person',
      lifecycle: 'active',
      createdAt: now,
      lastActivityAt: now,
      idleExpiresAt: '2026-07-12T10:00:00.000Z',
      absoluteExpiresAt: '2026-07-12T11:00:00.000Z'
    }
    sessions.sessions.set(session.id, {
      ...session,
      merchantId: scenario.merchant.id,
      capabilityHash: 'hash'
    })
    const selections = emptySeedBookingSelectionStore({
      merchants: [
        {
          id: scenario.merchant.id,
          slug: scenario.merchant.slug,
          presentation: scenario.merchant.plan,
          publicName: scenario.merchant.publicName
        }
      ],
      providers: scenario.providers,
      services: scenario.services,
      eligibility: scenario.eligibility.map(seedBookingSelectionEligibilityKey)
    })
    const scheduling = emptySeedBookingSchedulingStore(scenario, selections)
    scheduling.partyRequests.set(session.id, new Set(['brq_one', 'brq_two']))
    for (const [requestId, providerId, startsAt] of [
      ['brq_one', scenario.provider.id, '2026-07-13T09:00:00.000Z'],
      ['brq_two', scenario.provider.id, '2026-07-13T10:00:00.000Z']
    ] as const) {
      const requestQuote = quote(requestId, providerId, startsAt)
      scheduling.holds.set(`hld_${requestId}`, {
        id: `hld_${requestId}`,
        merchantId: scenario.merchant.id,
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
      scenario.provider.id,
      scenario.provider.id
    ])
    expect(first.appointment.snapshot).toMatchObject({
      merchantTimezone: scenario.merchant.timezone,
      assignedProvider: { id: scenario.provider.id },
      services: [{ id: scenario.services[0]!.id }]
    })
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
            merchantSlug: scenario.merchant.slug,
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
      confirmation: {
        appointments: [{}, {}],
        shop: { publicName: scenario.merchant.publicName }
      }
    })
  })
})
