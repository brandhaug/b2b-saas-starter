import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  appointments,
  bookingParties,
  bookingRequests,
  bookingOutbox,
  bookingSessions,
  brands,
  confirmationAccess,
  Database,
  layerFromD1,
  merchants,
  notificationIntents,
  notificationIntentControlledFacts,
  protectedMessagingDestinations,
  deliveryRoutes,
  providers,
  pricingAdjustments,
  pricingQuoteAcceptances,
  pricingQuotes,
  publicBookingPages,
  services,
  settlementAllocations,
  shops,
  timeSlotHolds
} from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  BookingConfirmation,
  type ConfirmationSigningKeyring,
  deriveConfirmationCookieCredential,
  deriveConfirmationToken,
  LiveBookingConfirmation,
  verifyConfirmationToken
} from './booking-confirmation.ts'
import { LivePaymentSettlement } from '../payments/adapters.ts'
import {
  AppointmentOperations,
  LiveAppointmentOperations
} from './appointment-operations.ts'
import { testMerchantContext } from '../merchant-catalog/merchant-context.ts'
import type { BookingSession } from './booking-sessions.ts'

let test: TestD1
const now = '2026-07-10T09:30:00.000Z'
const keyring = {
  currentKeyId: 'current',
  keys: { current: 'test-current-key', old: 'test-old-key' }
}
const destinationSecrets = {
  encryption: 'test-notification-encryption',
  fingerprint: 'test-notification-fingerprint',
  keyVersion: 1
}
const quote = {
  startsAt: '2026-07-13T09:00:00.000Z',
  endsAt: '2026-07-13T10:30:00.000Z',
  providerPreference: { kind: 'any' as const },
  assignedProvider: { id: 'prv_confirm', displayName: 'Ava' },
  services: [
    {
      id: 'svc_primary',
      role: 'primary' as const,
      name: 'Cut',
      durationMinutes: 60,
      priceMinor: 5000,
      currency: 'USD'
    },
    {
      id: 'svc_extra',
      role: 'additional' as const,
      name: 'Detail',
      durationMinutes: 30,
      priceMinor: 2500,
      currency: 'USD'
    }
  ],
  durationMinutes: 90,
  currency: 'USD',
  totalMinor: 7500
}
const session = (
  id: string,
  lifecycle: 'active' | 'consumed' = 'active'
): BookingSession => ({
  id,
  merchantSlug: 'confirm-live',
  checkoutPath: 'pay_in_person',
  lifecycle,
  createdAt: now,
  lastActivityAt: now,
  idleExpiresAt: '2026-07-10T10:00:00.000Z',
  absoluteExpiresAt: '2026-07-10T11:30:00.000Z'
})

const seedSession = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Database
    yield* db.insert(bookingSessions).values({
      id,
      merchantId: 'mer_confirm',
      capabilityHash: id.padEnd(64, '0'),
      lifecycle: 'active',
      customerName: 'Mia',
      customerEmail: 'mia@example.com',
      customerPhone: '+40722123456',
      providerPreference: 'any',
      primaryServiceId: null,
      createdAt: now,
      lastActivityAt: now,
      idleExpiresAt: '2026-07-10T10:00:00.000Z',
      absoluteExpiresAt: '2026-07-10T11:30:00.000Z'
    })
    yield* db.insert(timeSlotHolds).values({
      id: `hld_${id}`,
      merchantId: 'mer_confirm',
      bookingSessionId: id,
      providerId: 'prv_confirm',
      startsAt: quote.startsAt,
      endsAt: quote.endsAt,
      createdAt: now,
      expiresAt: '2026-07-10T09:40:00.000Z',
      quote
    })
  })

beforeAll(async () => {
  test = await provisionTestD1()
  await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const db = yield* Database
        yield* db.insert(merchants).values({
          id: 'mer_confirm',
          publicName: 'Confirm Live',
          slug: 'confirm-live',
          timezone: 'America/New_York',
          currency: 'USD',
          plan: 'solo',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(brands).values({
          id: 'brd_confirm',
          merchantId: 'mer_confirm',
          name: 'Confirm Live',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(shops).values({
          id: 'shp_confirm',
          brandId: 'brd_confirm',
          merchantId: 'mer_confirm',
          slug: 'confirm-live-shop',
          publicName: 'Confirm Live',
          timezone: 'America/New_York',
          currency: 'USD',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(providers).values({
          id: 'prv_confirm',
          merchantId: 'mer_confirm',
          displayName: 'Ava',
          status: 'active',
          isDefault: true,
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(publicBookingPages).values({
          id: 'pbp_confirm',
          merchantId: 'mer_confirm',
          status: 'published',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(services).values([
          {
            id: 'svc_primary',
            merchantId: 'mer_confirm',
            name: 'Cut',
            priceMinor: 5000,
            currency: 'USD',
            durationMinutes: 60,
            status: 'active',
            createdAt: now,
            updatedAt: now
          },
          {
            id: 'svc_extra',
            merchantId: 'mer_confirm',
            name: 'Detail',
            priceMinor: 2500,
            currency: 'USD',
            durationMinutes: 30,
            status: 'active',
            createdAt: now,
            updatedAt: now
          }
        ])
        yield* seedSession('bsn_confirm')
        yield* seedSession('bsn_rollback')
        yield* seedSession('bsn_competing')
      }),
      layerFromD1(test.d1)
    )
  )
}, 60_000)

afterAll(async () => test.dispose())

describe('Live Booking Confirmation', () => {
  const layer = () =>
    LiveBookingConfirmation(keyring, destinationSecrets).pipe(
      Layer.provide(LivePaymentSettlement),
      Layer.provide(layerFromD1(test.d1))
    )
  const confirm = (id: string, lifecycle: 'active' | 'consumed' = 'active') =>
    Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingConfirmation, (service) =>
          service.confirm(session(id, lifecycle), { now, traceId: 'trace_confirm' })
        ),
        layer()
      )
    )

  it('atomically snapshots, reduces, persists access/outbox, and replays exactly once', async () => {
    const first = await confirm('bsn_confirm')
    const replay = await confirm('bsn_confirm', 'consumed')
    expect(replay).toEqual({ ...first, replayed: true })
    expect(first.appointment.snapshot).toEqual({
      ...quote,
      merchantTimezone: 'America/New_York',
      customerDetails: {
        name: 'Mia',
        email: 'mia@example.com',
        phone: '+40722123456'
      },
      checkoutPath: 'pay_in_person',
      cancellationPolicy: {
        id: 'cancellation:default:v1',
        version: 1,
        cancellableUntilMinutesBeforeStart: 60
      },
      refundPolicy: {
        id: 'refund:default:v1',
        version: 1,
        refundableUntilMinutesBeforeStart: 24 * 60,
        refundBasisPoints: 10_000
      }
    })
    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const db = yield* Database
          yield* db
            .update(providers)
            .set({ displayName: 'Renamed Ava', status: 'inactive' })
          yield* db
            .update(services)
            .set({ name: 'Renamed Service', status: 'inactive' })
          yield* db.update(publicBookingPages).set({ status: 'unpublished' })
        }),
        layerFromD1(test.d1)
      )
    )
    const operationsLayer = Layer.merge(
      LiveAppointmentOperations.pipe(Layer.provide(layerFromD1(test.d1))),
      testMerchantContext({
        id: 'mer_confirm',
        publicName: 'Confirm Live',
        slug: 'confirm-live',
        timezone: 'America/New_York',
        currency: 'USD',
        plan: 'solo'
      })
    )
    const operational = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(AppointmentOperations, (service) =>
          service.detail(first.appointment.id)
        ),
        operationsLayer
      )
    )
    expect(operational).toMatchObject({
      kind: 'found',
      appointment: {
        snapshot: {
          assignedProvider: { displayName: 'Ava' },
          services: [{ name: 'Cut' }, { name: 'Detail' }]
        }
      }
    })
    expect(first.access.token).toBe(
      await deriveConfirmationToken(
        {
          routeId: first.access.routeId,
          tokenVersion: 1,
          signingKeyId: 'current',
          expiresAt: first.access.expiresAt
        },
        keyring
      )
    )

    const stored = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const db = yield* Database
          return {
            sessions: yield* db.select().from(bookingSessions),
            holds: yield* db.select().from(timeSlotHolds),
            appointments: yield* db.select().from(appointments),
            access: yield* db.select().from(confirmationAccess),
            outbox: yield* db.select().from(bookingOutbox),
            notificationIntents: yield* db.select().from(notificationIntents),
            protectedDestinations: yield* db
              .select()
              .from(protectedMessagingDestinations),
            controlledFacts: yield* db.select().from(notificationIntentControlledFacts),
            routes: yield* db.select().from(deliveryRoutes)
          }
        }),
        layerFromD1(test.d1)
      )
    )
    const terminal = stored.sessions.find((row) => row.id === 'bsn_confirm')!
    expect(terminal).toMatchObject({
      lifecycle: 'consumed',
      customerName: null,
      customerEmail: null,
      customerPhone: null,
      providerPreference: null,
      providerId: null,
      primaryServiceId: null
    })
    expect(stored.holds.some((row) => row.bookingSessionId === 'bsn_confirm')).toBe(
      false
    )
    expect(
      stored.appointments.filter((row) => row.bookingSessionId === 'bsn_confirm')
    ).toHaveLength(1)
    expect(stored.access).toHaveLength(1)
    expect(stored.outbox).toEqual([
      expect.objectContaining({
        id: first.outboxId,
        traceId: 'trace_confirm',
        kind: 'appointment.created'
      })
    ])
    expect(JSON.stringify(stored.outbox)).not.toContain(first.access.token)
    expect(stored.notificationIntents).toEqual([
      expect.objectContaining({
        id: first.notificationIntentIds![0],
        shopId: 'shp_confirm',
        topic: 'appointment.confirmation',
        sourceType: 'appointment',
        sourceId: first.appointment.id,
        sourceVersion: 1,
        deduplicationKey: `confirmation:${first.appointment.id}:1`,
        purpose: 'appointment_confirmation',
        phase: 'ready',
        status: 'pending',
        traceId: 'trace_confirm'
      })
    ])
    expect(JSON.parse(stored.notificationIntents[0]!.payloadJson).permission).toEqual({
      granted: false,
      destinationFingerprint: stored.protectedDestinations[0]!.fingerprint
    })
    expect(stored.protectedDestinations).toEqual([
      expect.objectContaining({
        intentId: first.notificationIntentIds![0],
        maskedValue: '+40•••••••456',
        countryCode: 'RO'
      })
    ])
    expect(stored.controlledFacts).toHaveLength(1)
    expect(stored.routes).toEqual([
      expect.objectContaining({ channel: 'whatsapp', ordinal: 0, state: 'planned' }),
      expect.objectContaining({ channel: 'sms', ordinal: 1, state: 'planned' })
    ])
  })

  it('rolls the entire transaction back when an access write fails', async () => {
    await test.d1
      .prepare(
        "CREATE TRIGGER reject_confirmation BEFORE INSERT ON confirmation_access BEGIN SELECT RAISE(ABORT, 'forced rollback'); END"
      )
      .run()
    try {
      await expect(confirm('bsn_rollback')).rejects.toMatchObject({
        _tag: 'CapabilityUnavailable',
        capability: 'booking-confirmation'
      })
    } finally {
      await test.d1.prepare('DROP TRIGGER reject_confirmation').run()
    }
    const counts = await test.d1
      .prepare(
        "SELECT (SELECT count(*) FROM appointments WHERE booking_session_id = 'bsn_rollback') appointments, (SELECT count(*) FROM booking_outbox) outbox, (SELECT count(*) FROM time_slot_holds WHERE booking_session_id = 'bsn_rollback') holds"
      )
      .first<{ appointments: number; outbox: number; holds: number }>()
    expect(counts).toEqual({ appointments: 0, outbox: 1, holds: 1 })
  })

  it('converges competing confirmations on one Appointment and outbox item', async () => {
    const results = await Promise.all([
      confirm('bsn_competing'),
      confirm('bsn_competing')
    ])
    expect(results[0]!.appointment.id).toBe(results[1]!.appointment.id)
    const rows = await test.d1
      .prepare(
        "SELECT count(*) count FROM appointments WHERE booking_session_id = 'bsn_competing'"
      )
      .first<{ count: number }>()
    expect(rows?.count).toBe(1)
  })

  it('atomically confirms and replays every request in a live Booking Party', async () => {
    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const db = yield* Database
          yield* db.insert(brands).values({
            id: 'brd_group',
            merchantId: 'mer_confirm',
            name: 'Group Brand',
            createdAt: now,
            updatedAt: now
          })
          yield* db.insert(shops).values({
            id: 'shp_group',
            brandId: 'brd_group',
            merchantId: 'mer_confirm',
            slug: 'group',
            publicName: 'Group Shop',
            timezone: 'America/New_York',
            currency: 'USD',
            createdAt: now,
            updatedAt: now
          })
          yield* db.insert(bookingSessions).values({
            id: 'bsn_group',
            merchantId: 'mer_confirm',
            capabilityHash: 'bsn_group'.padEnd(64, '0'),
            lifecycle: 'active',
            locale: 'ro',
            createdAt: now,
            lastActivityAt: now,
            idleExpiresAt: '2026-07-10T10:00:00.000Z',
            absoluteExpiresAt: '2026-07-10T11:30:00.000Z'
          })
          yield* db.insert(bookingParties).values({
            id: 'bpt_group',
            bookingSessionId: 'bsn_group',
            shopId: 'shp_group',
            activeRequestId: 'brq_group_one',
            lifecycle: 'active',
            currency: 'USD',
            locale: 'ro',
            version: 2,
            createdAt: now,
            updatedAt: now
          })
          yield* db.insert(bookingRequests).values([
            {
              id: 'brq_group_one',
              bookingPartyId: 'bpt_group',
              position: 0,
              customerDetailsJson: JSON.stringify({
                name: 'Mia',
                email: 'mia@example.com',
                phone: null
              }),
              createdAt: now,
              updatedAt: now
            },
            {
              id: 'brq_group_two',
              bookingPartyId: 'bpt_group',
              position: 1,
              customerDetailsJson: JSON.stringify({
                name: 'Noah',
                email: 'noah@example.com',
                phone: null
              }),
              createdAt: now,
              updatedAt: now
            }
          ])
          yield* db.insert(pricingQuotes).values({
            id: 'pqt_group',
            bookingPartyId: 'bpt_group',
            version: 1,
            currency: 'USD',
            subtotalMinor: 15000,
            totalMinor: 15000,
            factsJson: '{}',
            acceptedAt: now,
            expiresAt: '2026-07-10T09:40:00.000Z',
            createdAt: now
          })
          yield* db.insert(pricingQuoteAcceptances).values({
            pricingQuoteId: 'pqt_group',
            bookingPartyId: 'bpt_group',
            partyVersion: 2,
            acceptedAt: now,
            createdAt: now
          })
          yield* db.insert(timeSlotHolds).values([
            {
              id: 'hld_group_one',
              merchantId: 'mer_confirm',
              bookingSessionId: 'bsn_group',
              bookingRequestId: 'brq_group_one',
              providerId: 'prv_confirm',
              startsAt: quote.startsAt,
              endsAt: quote.endsAt,
              createdAt: now,
              expiresAt: '2026-07-10T09:40:00.000Z',
              quote
            },
            {
              id: 'hld_group_two',
              merchantId: 'mer_confirm',
              bookingSessionId: 'bsn_group',
              bookingRequestId: 'brq_group_two',
              providerId: 'prv_confirm',
              startsAt: '2026-07-13T11:00:00.000Z',
              endsAt: '2026-07-13T12:30:00.000Z',
              createdAt: now,
              expiresAt: '2026-07-10T09:40:00.000Z',
              quote: {
                ...quote,
                startsAt: '2026-07-13T11:00:00.000Z',
                endsAt: '2026-07-13T12:30:00.000Z'
              }
            }
          ])
        }),
        layerFromD1(test.d1)
      )
    )

    await test.d1
      .prepare(
        "CREATE TRIGGER reject_group_settlement BEFORE INSERT ON settlement_allocations BEGIN SELECT RAISE(ABORT, 'forced group rollback'); END"
      )
      .run()
    try {
      await expect(confirm('bsn_group')).rejects.toMatchObject({
        _tag: 'CapabilityUnavailable',
        capability: 'booking-confirmation'
      })
    } finally {
      await test.d1.prepare('DROP TRIGGER reject_group_settlement').run()
    }
    const rolledBack = await test.d1
      .prepare(
        "SELECT (SELECT count(*) FROM appointments WHERE booking_party_id = 'bpt_group') appointments, (SELECT count(*) FROM time_slot_holds WHERE booking_session_id = 'bsn_group') holds, (SELECT count(*) FROM settlement_allocations WHERE booking_party_id = 'bpt_group') settlement"
      )
      .first<{ appointments: number; holds: number; settlement: number }>()
    expect(rolledBack).toEqual({ appointments: 0, holds: 2, settlement: 0 })

    await test.d1
      .prepare(
        "INSERT INTO gift_card_sales (id, shop_id, status, amount_minor, currency, recipient_json, purchaser_json, created_at, updated_at) VALUES ('gcs_group', 'shp_confirm', 'issued', 4000, 'USD', 'null', '{}', ?, ?)"
      )
      .bind(now, now)
      .run()
    for (const statement of [
      "INSERT INTO gift_cards (id, gift_card_sale_id, code_hash, status, currency, scope, scope_id, initial_value_minor, created_at, updated_at) VALUES ('gcd_group', 'gcs_group', 'group-code', 'active', 'USD', 'merchant', 'mer_confirm', 4000, ?, ?)",
      "INSERT INTO gift_card_ledger_entries (id, gift_card_id, kind, amount_minor, idempotency_key, occurred_at, created_at) VALUES ('gcl_group_issue', 'gcd_group', 'issuance', 4000, 'issuance:gcd_group', ?, ?)",
      "INSERT INTO gift_card_reservations (id, gift_card_id, booking_party_id, amount_minor, currency, status, expires_at, created_at, updated_at) VALUES ('gcr_group', 'gcd_group', 'bpt_group', 4000, 'USD', 'active', '2026-07-10T09:40:00.000Z', ?, ?)",
      "INSERT INTO gift_card_ledger_entries (id, gift_card_id, kind, amount_minor, booking_party_id, idempotency_key, occurred_at, created_at) VALUES ('gcl_group_reserve', 'gcd_group', 'reservation', -4000, 'bpt_group', 'reservation:gcr_group', ?, ?)",
      "INSERT INTO payments (id, booking_party_id, pricing_quote_id, amount_minor, status, currency, captured_minor, created_at, updated_at) VALUES ('pay_group', 'bpt_group', 'pqt_group', 11000, 'captured', 'USD', 11000, ?, ?)"
    ])
      await test.d1.prepare(statement).bind(now, now).run()
    await test.d1
      .prepare(
        `UPDATE pricing_quotes SET facts_json = '{"giftCardReservationIds":["gcr_group"]}' WHERE id = 'pqt_group'`
      )
      .run()
    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const db = yield* Database
          yield* db.insert(pricingAdjustments).values([
            {
              id: 'pad_group_tax',
              pricingQuoteId: 'pqt_group',
              kind: 'tax',
              label: 'Tax',
              amountMinor: 1000,
              allocationJson: '{}',
              createdAt: now
            },
            {
              id: 'pad_group_fee',
              pricingQuoteId: 'pqt_group',
              kind: 'fee',
              label: 'Fee',
              amountMinor: 500,
              allocationJson: '{}',
              createdAt: now
            },
            {
              id: 'pad_group_discount',
              pricingQuoteId: 'pqt_group',
              kind: 'discount',
              label: 'Private promotion',
              amountMinor: -500,
              allocationJson: '{}',
              createdAt: now
            }
          ])
        }),
        layerFromD1(test.d1)
      )
    )

    const first = await confirm('bsn_group')
    const replay = await confirm('bsn_group', 'consumed')
    expect(first.appointments).toHaveLength(2)
    expect(first.accesses).toHaveLength(2)
    expect(replay).toEqual({ ...first, replayed: true })

    const stored = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const db = yield* Database
          return {
            appointments: yield* db
              .select()
              .from(appointments)
              .where(eq(appointments.bookingPartyId, 'bpt_group')),
            holds: yield* db
              .select()
              .from(timeSlotHolds)
              .where(eq(timeSlotHolds.bookingSessionId, 'bsn_group')),
            settlement: yield* db
              .select()
              .from(settlementAllocations)
              .where(eq(settlementAllocations.bookingPartyId, 'bpt_group')),
            access: yield* db
              .select()
              .from(confirmationAccess)
              .where(eq(confirmationAccess.bookingPartyId, 'bpt_group'))
          }
        }),
        layerFromD1(test.d1)
      )
    )
    expect(stored.appointments).toHaveLength(2)
    expect(stored.holds).toHaveLength(0)
    expect(
      stored.settlement.map(({ tender, referenceId, amountMinor }) => ({
        tender,
        referenceId,
        amountMinor
      }))
    ).toEqual([
      { tender: 'gift_card', referenceId: 'gcd_group', amountMinor: 4000 },
      { tender: 'external_payment', referenceId: 'pay_group', amountMinor: 11000 }
    ])
    const giftCardCommit = await test.d1
      .prepare(
        "SELECT status, (SELECT coalesce(sum(amount_minor), 0) FROM gift_card_ledger_entries WHERE gift_card_id = 'gcd_group') balance FROM gift_card_reservations WHERE id = 'gcr_group'"
      )
      .first<{ status: string; balance: number }>()
    expect(giftCardCommit).toEqual({ status: 'committed', balance: 0 })
    expect(stored.appointments[0]?.snapshot?.checkoutPath).toBe('online_payment')
    expect(stored.access.map((access) => access.purpose).sort()).toEqual([
      'appointment_confirmation',
      'party_confirmation'
    ])
    const cookieCredential = await deriveConfirmationCookieCredential(
      first.access,
      keyring
    )
    const confirmationRead = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingConfirmation, (service) =>
          service.read({
            routeId: first.access.routeId,
            merchantSlug: 'confirm-live',
            credential: cookieCredential,
            credentialKind: 'cookie',
            now
          })
        ),
        layer()
      )
    )
    expect(confirmationRead).toMatchObject({
      kind: 'found',
      confirmation: {
        appointments: [
          {
            adjustments: [
              { kind: 'tax', amountMinor: 1000 },
              { kind: 'fee', amountMinor: 500 }
            ]
          },
          {
            adjustments: [
              { kind: 'tax', amountMinor: 1000 },
              { kind: 'fee', amountMinor: 500 }
            ]
          }
        ]
      }
    })
  })

  it('verifies retained keys and rejects expired, revoked, and wrong-version access', async () => {
    const metadata = {
      routeId: 'cnf_rotated',
      tokenVersion: 2,
      signingKeyId: 'old',
      expiresAt: '2026-08-10T09:30:00.000Z'
    }
    const token = await deriveConfirmationToken(metadata, keyring)
    await expect(verifyConfirmationToken(metadata, token, keyring, now)).resolves.toBe(
      true
    )
    await expect(
      verifyConfirmationToken({ ...metadata, revokedAt: now }, token, keyring, now)
    ).resolves.toBe(false)
    await expect(
      verifyConfirmationToken({ ...metadata, expiresAt: now }, token, keyring, now)
    ).resolves.toBe(false)
    await expect(
      verifyConfirmationToken({ ...metadata, tokenVersion: 3 }, token, keyring, now)
    ).resolves.toBe(false)
  })

  it('reads only the matching Appointment snapshot and revalidates expiry, revocation, status, and retained keys', async () => {
    const confirmed = await confirm('bsn_confirm', 'consumed')
    const read = (
      token: string,
      at = now,
      keyringOverride: ConfirmationSigningKeyring = keyring,
      credentialKind: 'bearer' | 'cookie' = 'bearer'
    ) =>
      Effect.runPromise(
        Effect.provide(
          Effect.flatMap(BookingConfirmation, (service) =>
            service.read({
              routeId: confirmed.access.routeId,
              merchantSlug: 'confirm-live',
              credential: token,
              credentialKind,
              now: at
            })
          ),
          LiveBookingConfirmation(keyringOverride, destinationSecrets).pipe(
            Layer.provide(LivePaymentSettlement),
            Layer.provide(layerFromD1(test.d1))
          )
        )
      )

    await expect(read(confirmed.access.token)).resolves.toMatchObject({
      kind: 'found',
      confirmation: {
        routeId: confirmed.access.routeId,
        status: 'scheduled',
        shop: { publicName: 'Confirm Live' },
        snapshot: {
          customerDetails: { email: 'mia@example.com' },
          checkoutPath: 'pay_in_person'
        }
      }
    })
    await expect(read(confirmed.access.token)).resolves.toEqual({ kind: 'not_found' })
    const cookieCredential = await deriveConfirmationCookieCredential(
      {
        routeId: confirmed.access.routeId,
        tokenVersion: confirmed.access.tokenVersion,
        signingKeyId: confirmed.access.signingKeyId,
        expiresAt: confirmed.access.expiresAt
      },
      keyring
    )
    await expect(read('0'.repeat(64))).resolves.toEqual({ kind: 'not_found' })
    await expect(
      Effect.runPromise(
        Effect.provide(
          Effect.flatMap(BookingConfirmation, (service) =>
            service.read({
              routeId: confirmed.access.routeId,
              merchantSlug: 'another-merchant',
              credential: confirmed.access.token,
              credentialKind: 'bearer',
              now
            })
          ),
          layer()
        )
      )
    ).resolves.toEqual({ kind: 'not_found' })

    await test.d1
      .prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?")
      .bind(confirmed.appointment.id)
      .run()
    await expect(read(cookieCredential, now, keyring, 'cookie')).resolves.toMatchObject(
      {
        kind: 'found',
        confirmation: { status: 'cancelled' }
      }
    )

    await expect(
      read(cookieCredential, confirmed.access.expiresAt, keyring, 'cookie')
    ).resolves.toEqual({ kind: 'expired', locale: 'en' })
    await test.d1
      .prepare(
        'UPDATE confirmation_access SET token_version = token_version + 1 WHERE route_id = ?'
      )
      .bind(confirmed.access.routeId)
      .run()
    await expect(read(cookieCredential, now, keyring, 'cookie')).resolves.toEqual({
      kind: 'not_found'
    })

    await test.d1
      .prepare('UPDATE confirmation_access SET token_version = 1 WHERE route_id = ?')
      .bind(confirmed.access.routeId)
      .run()
    await expect(
      read(
        cookieCredential,
        now,
        {
          currentKeyId: 'next',
          keys: { ...keyring.keys, next: 'test-next-key' }
        },
        'cookie'
      )
    ).resolves.toMatchObject({ kind: 'found' })
    await expect(
      read(
        cookieCredential,
        now,
        {
          currentKeyId: 'next',
          keys: { next: 'test-next-key' }
        },
        'cookie'
      )
    ).resolves.toEqual({ kind: 'not_found' })
  })
})
