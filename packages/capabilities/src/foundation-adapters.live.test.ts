import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  LiveBookingParties,
  SeedBookingParties
} from './booking/foundation-adapters.ts'
import { BookingParties } from './booking/foundations.ts'
import {
  LiveCustomerEngagement,
  SeedCustomerEngagement
} from './customer-engagement/adapters.ts'
import { CustomerEngagement } from './customer-engagement/index.ts'
import {
  LiveNotificationIntents,
  SeedNotificationIntents
} from './notifications/adapters.ts'
import { NotificationIntents } from './notifications/index.ts'
import { LivePaymentLedger, SeedPaymentLedger } from './payments/adapters.ts'
import { PaymentLedger } from './payments/index.ts'
import { LivePricingQuotes, SeedPricingQuotes } from './pricing/adapters.ts'
import { PricingQuotes } from './pricing/index.ts'
import {
  LiveScheduledWorkQueue,
  SeedScheduledWorkQueue
} from './scheduled-work/adapters.ts'
import { ScheduledWorkQueue } from './scheduled-work/index.ts'
import { LiveGiftCards, SeedGiftCards } from './gift-cards/adapters.ts'
import { GiftCards } from './gift-cards/index.ts'
import { LiveWalkIns, SeedWalkIns } from './walk-ins/adapters.ts'
import { WalkIns } from './walk-ins/index.ts'
import {
  LiveCustomerIdentity,
  SeedCustomerIdentity
} from './customer-identity/adapters.ts'
import { CustomerIdentity } from './customer-identity/index.ts'

let test: TestD1
const now = '2026-07-11T12:00:00.000Z'
const party = {
  id: 'bpt_contract',
  bookingSessionId: 'bsn_contract',
  shopId: 'shp_contract',
  lifecycle: 'active',
  currency: 'EUR',
  locale: 'en',
  version: 1,
  requests: []
} as const
const quote = {
  id: 'pqt_contract',
  bookingPartyId: party.id,
  version: 1,
  currency: 'EUR',
  subtotalMinor: 5000,
  adjustmentMinor: 0,
  tipMinor: 0,
  totalMinor: 5000,
  facts: {
    partyVersion: 1,
    lines: [],
    policyVersions: [],
    promotionReservationIds: [],
    giftCardReservationIds: []
  },
  acceptedAt: null,
  expiresAt: '2026-07-11T12:10:00.000Z',
  adjustments: []
} as const
const payment = {
  id: 'pay_contract',
  bookingPartyId: party.id,
  status: 'pending',
  currency: 'EUR',
  authorizedMinor: 0,
  capturedMinor: 0,
  refundedMinor: 0
} as const
const application = {
  id: 'wla_contract',
  shopId: party.shopId,
  status: 'active',
  expiresAt: '2026-07-12T12:00:00.000Z'
} as const
const intent = {
  id: 'nti_contract',
  shopId: party.shopId,
  topic: 'appointment.created',
  sourceType: 'appointment',
  sourceId: 'apt_contract',
  deduplicationKey: 'appointment.created:apt_contract',
  status: 'pending',
  availableAt: now
} as const
const work = {
  id: 'swk_contract',
  shopId: party.shopId,
  kind: 'expire-hold',
  idempotencyKey: 'expire-hold:contract',
  status: 'pending',
  runAt: now,
  attempts: 0
} as const
const giftCard = {
  id: 'gcd_contract',
  status: 'active',
  currency: 'EUR',
  scope: 'shop',
  scopeId: party.shopId,
  initialValueMinor: 5000
} as const
const walkIn = {
  id: 'wie_contract',
  shopId: party.shopId,
  status: 'waiting',
  position: 1
} as const
const customerAccount = {
  id: 'cua_contract',
  merchantId: 'mrc_contract',
  email: 'customer@example.test',
  displayName: 'Customer',
  phone: null
} as const

beforeAll(async () => {
  test = await provisionTestD1()
  const statements = [
    `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at) VALUES ('mrc_contract', 'Contract', 'contract', 'UTC', 'EUR', 'solo', '${now}', '${now}')`,
    `INSERT INTO brands (id, merchant_id, name, created_at, updated_at) VALUES ('brd_contract', 'mrc_contract', 'Contract', '${now}', '${now}')`,
    `INSERT INTO shops (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at) VALUES ('shp_contract', 'brd_contract', 'mrc_contract', 'contract', 'Contract', 'UTC', 'EUR', '${now}', '${now}')`,
    `INSERT INTO booking_sessions (id, merchant_id, capability_hash, checkout_path, lifecycle, created_at, last_activity_at, idle_expires_at, absolute_expires_at) VALUES ('bsn_contract', 'mrc_contract', 'contract_hash', 'pay_in_person', 'active', '${now}', '${now}', '${now}', '${now}')`,
    `INSERT INTO booking_parties (id, booking_session_id, shop_id, lifecycle, currency, locale, version, created_at, updated_at) VALUES ('bpt_contract', 'bsn_contract', 'shp_contract', 'active', 'EUR', 'en', 1, '${now}', '${now}')`,
    `INSERT INTO pricing_quotes (id, booking_party_id, version, currency, subtotal_minor, adjustment_minor, tip_minor, total_minor, facts_json, accepted_at, expires_at, created_at) VALUES ('pqt_contract', 'bpt_contract', 1, 'EUR', 5000, 0, 0, 5000, '${JSON.stringify(quote.facts)}', NULL, '${quote.expiresAt}', '${now}')`,
    `INSERT INTO payments (id, booking_party_id, status, currency, authorized_minor, captured_minor, refunded_minor, created_at, updated_at) VALUES ('pay_contract', 'bpt_contract', 'pending', 'EUR', 0, 0, 0, '${now}', '${now}')`,
    `INSERT INTO waiting_list_applications (id, shop_id, status, request_json, customer_snapshot_json, created_at, updated_at, expires_at) VALUES ('wla_contract', 'shp_contract', 'active', '{}', '{}', '${now}', '${now}', '${application.expiresAt}')`,
    `INSERT INTO notification_intents (id, shop_id, topic, recipient_json, payload_json, source_type, source_id, deduplication_key, status, available_at, created_at, updated_at) VALUES ('nti_contract', 'shp_contract', 'appointment.created', '{}', '{}', 'appointment', 'apt_contract', 'appointment.created:apt_contract', 'pending', '${now}', '${now}', '${now}')`,
    `INSERT INTO scheduled_work (id, shop_id, kind, payload_json, idempotency_key, status, run_at, attempts, created_at, updated_at) VALUES ('swk_contract', 'shp_contract', 'expire-hold', '{}', 'expire-hold:contract', 'pending', '${now}', 0, '${now}', '${now}')`,
    `INSERT INTO gift_card_products (id, merchant_id, name, currency, scope, scope_id, preset_amounts_json, allows_custom_amount, active, created_at, updated_at) VALUES ('gcp_contract', 'mrc_contract', 'Gift', 'EUR', 'shop', 'shp_contract', '[5000]', 0, 1, '${now}', '${now}')`,
    `INSERT INTO gift_card_sales (id, shop_id, gift_card_product_id, status, amount_minor, currency, recipient_json, purchaser_json, created_at, updated_at) VALUES ('gcs_contract', 'shp_contract', 'gcp_contract', 'issued', 5000, 'EUR', '{}', '{}', '${now}', '${now}')`,
    `INSERT INTO gift_cards (id, gift_card_sale_id, code_hash, status, currency, scope, scope_id, initial_value_minor, created_at, updated_at) VALUES ('gcd_contract', 'gcs_contract', 'gift_hash', 'active', 'EUR', 'shop', 'shp_contract', 5000, '${now}', '${now}')`,
    `INSERT INTO walk_in_entries (id, shop_id, status, position, request_json, customer_snapshot_json, created_at, updated_at) VALUES ('wie_contract', 'shp_contract', 'waiting', 1, '{}', '{}', '${now}', '${now}')`,
    `INSERT INTO customer_accounts (id, merchant_id, email, display_name, phone, created_at, updated_at) VALUES ('cua_contract', 'mrc_contract', 'customer@example.test', 'Customer', NULL, '${now}', '${now}')`
  ]
  for (const statement of statements) await test.d1.prepare(statement).run()
}, 60_000)
afterAll(async () => test.dispose())

const live = <Service>(
  layer: Layer.Layer<Service, never, import('@b2b-saas-starter/db').Database>
) => layer.pipe(Layer.provide(layerFromD1(test.d1)))

describe('foundation Seed and Live contracts', () => {
  it('return identical persisted records', async () => {
    const pairs = await Promise.all([
      Promise.all([
        Effect.runPromise(
          Effect.provide(
            Effect.flatMap(BookingParties, (service) => service.findById(party.id)),
            SeedBookingParties([party])
          )
        ),
        Effect.runPromise(
          Effect.provide(
            Effect.flatMap(BookingParties, (service) => service.findById(party.id)),
            live(LiveBookingParties)
          )
        )
      ]),
      Promise.all([
        Effect.runPromise(
          Effect.provide(
            Effect.flatMap(PricingQuotes, (service) => service.findLatest(party.id)),
            SeedPricingQuotes([quote])
          )
        ),
        Effect.runPromise(
          Effect.provide(
            Effect.flatMap(PricingQuotes, (service) => service.findLatest(party.id)),
            live(LivePricingQuotes)
          )
        )
      ]),
      Promise.all([
        Effect.runPromise(
          Effect.provide(
            Effect.flatMap(PaymentLedger, (service) => service.findById(payment.id)),
            SeedPaymentLedger([payment])
          )
        ),
        Effect.runPromise(
          Effect.provide(
            Effect.flatMap(PaymentLedger, (service) => service.findById(payment.id)),
            live(LivePaymentLedger)
          )
        )
      ]),
      Promise.all([
        Effect.runPromise(
          Effect.provide(
            Effect.flatMap(CustomerEngagement, (service) =>
              service.findWaitingListApplication(application.id)
            ),
            SeedCustomerEngagement([application])
          )
        ),
        Effect.runPromise(
          Effect.provide(
            Effect.flatMap(CustomerEngagement, (service) =>
              service.findWaitingListApplication(application.id)
            ),
            live(LiveCustomerEngagement)
          )
        )
      ]),
      Promise.all([
        Effect.runPromise(
          Effect.provide(
            Effect.flatMap(NotificationIntents, (service) =>
              service.findById(intent.id)
            ),
            SeedNotificationIntents([intent])
          )
        ),
        Effect.runPromise(
          Effect.provide(
            Effect.flatMap(NotificationIntents, (service) =>
              service.findById(intent.id)
            ),
            live(LiveNotificationIntents)
          )
        )
      ]),
      Promise.all([
        Effect.runPromise(
          Effect.provide(
            Effect.flatMap(ScheduledWorkQueue, (service) => service.findById(work.id)),
            SeedScheduledWorkQueue([work])
          )
        ),
        Effect.runPromise(
          Effect.provide(
            Effect.flatMap(ScheduledWorkQueue, (service) => service.findById(work.id)),
            live(LiveScheduledWorkQueue)
          )
        )
      ]),
      Promise.all([
        Effect.runPromise(
          Effect.provide(
            Effect.flatMap(GiftCards, (service) => service.findById(giftCard.id)),
            SeedGiftCards([giftCard])
          )
        ),
        Effect.runPromise(
          Effect.provide(
            Effect.flatMap(GiftCards, (service) => service.findById(giftCard.id)),
            live(LiveGiftCards)
          )
        )
      ]),
      Promise.all([
        Effect.runPromise(
          Effect.provide(
            Effect.flatMap(WalkIns, (service) => service.findById(walkIn.id)),
            SeedWalkIns([walkIn])
          )
        ),
        Effect.runPromise(
          Effect.provide(
            Effect.flatMap(WalkIns, (service) => service.findById(walkIn.id)),
            live(LiveWalkIns)
          )
        )
      ]),
      Promise.all([
        Effect.runPromise(
          Effect.provide(
            Effect.flatMap(CustomerIdentity, (service) =>
              service.findById(customerAccount.id)
            ),
            SeedCustomerIdentity([customerAccount])
          )
        ),
        Effect.runPromise(
          Effect.provide(
            Effect.flatMap(CustomerIdentity, (service) =>
              service.findById(customerAccount.id)
            ),
            live(LiveCustomerIdentity)
          )
        )
      ])
    ])
    for (const [seedResult, liveResult] of pairs) expect(liveResult).toEqual(seedResult)
  })

  it('return identical typed not-found results', async () => {
    const results = await Promise.all([
      Effect.runPromise(
        Effect.provide(
          Effect.result(
            Effect.flatMap(BookingParties, (service) => service.findById('bpt_missing'))
          ),
          live(LiveBookingParties)
        )
      ),
      Effect.runPromise(
        Effect.provide(
          Effect.result(
            Effect.flatMap(PricingQuotes, (service) =>
              service.findLatest('bpt_missing')
            )
          ),
          live(LivePricingQuotes)
        )
      ),
      Effect.runPromise(
        Effect.provide(
          Effect.result(
            Effect.flatMap(PaymentLedger, (service) => service.findById('pay_missing'))
          ),
          live(LivePaymentLedger)
        )
      ),
      Effect.runPromise(
        Effect.provide(
          Effect.result(
            Effect.flatMap(CustomerEngagement, (service) =>
              service.findWaitingListApplication('wla_missing')
            )
          ),
          live(LiveCustomerEngagement)
        )
      ),
      Effect.runPromise(
        Effect.provide(
          Effect.result(
            Effect.flatMap(NotificationIntents, (service) =>
              service.findById('nti_missing')
            )
          ),
          live(LiveNotificationIntents)
        )
      ),
      Effect.runPromise(
        Effect.provide(
          Effect.result(
            Effect.flatMap(ScheduledWorkQueue, (service) =>
              service.findById('swk_missing')
            )
          ),
          live(LiveScheduledWorkQueue)
        )
      ),
      Effect.runPromise(
        Effect.provide(
          Effect.result(
            Effect.flatMap(GiftCards, (service) => service.findById('gcd_missing'))
          ),
          live(LiveGiftCards)
        )
      ),
      Effect.runPromise(
        Effect.provide(
          Effect.result(
            Effect.flatMap(WalkIns, (service) => service.findById('wie_missing'))
          ),
          live(LiveWalkIns)
        )
      ),
      Effect.runPromise(
        Effect.provide(
          Effect.result(
            Effect.flatMap(CustomerIdentity, (service) =>
              service.findById('cua_missing')
            )
          ),
          live(LiveCustomerIdentity)
        )
      )
    ])
    expect(results.every((result) => result._tag === 'Failure')).toBe(true)
  })
})
