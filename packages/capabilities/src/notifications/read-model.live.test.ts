import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { LiveMessagingReadModel, SeedMessagingReadModel } from './adapters.ts'
import { MessagingReadModel } from './index.ts'

const now = '2026-07-29T12:00:00.000Z'
const delivery = {
  intentId: 'nti_read_model',
  shopId: 'shp_read_model',
  sourceType: 'appointment',
  sourceId: 'apt_read_model',
  sourceVersion: 1,
  purpose: 'appointment_confirmation',
  phase: 'awaiting_provider',
  availableAt: now,
  maskedDestination: '+40•••••••456',
  underReview: true
} as const
const balance = {
  shopId: 'shp_read_model',
  currency: 'EUR',
  postedMilliEuro: 9_955,
  reservedMilliEuro: 0,
  availableMilliEuro: 9_955,
  financiallyFrozen: false
} as const
const reconciliationCase = {
  caseId: 'mrcase_read_model',
  shopId: 'shp_read_model',
  intentId: 'nti_read_model',
  kind: 'contradictory_evidence',
  status: 'open',
  severity: 'high',
  safeSummary: 'Delivery evidence needs review',
  openedAt: now,
  purpose: 'appointment_confirmation',
  intentPhase: 'awaiting_provider',
  maskedDestination: '+40•••••••456'
} as const
const route = {
  routeId: 'drt_read_model',
  shopId: 'shp_read_model',
  intentId: 'nti_read_model',
  ordinal: 0,
  channel: 'whatsapp',
  provider: 'meta',
  state: 'delivered',
  acceptedAt: now,
  deliveredAt: now,
  latestEvidenceStatus: 'delivered',
  latestEvidenceObservedAt: now,
  attemptCount: 1
} as const
const charge = {
  chargeId: 'mcd_read_model',
  shopId: 'shp_read_model',
  intentId: 'nti_read_model',
  routeId: 'drt_read_model',
  chargeMilliEuro: 45,
  verifiedAt: now,
  ledgerEntryId: 'mle_delivery_read_model'
} as const
const providerCost = {
  costId: 'pmc_read_model',
  shopId: 'shp_read_model',
  intentId: 'nti_read_model',
  attemptId: 'pat_read_model',
  provider: 'meta',
  amountMinorUnits: 239,
  currency: 'EUR',
  currencyScale: 4,
  units: 1,
  source: 'invoice',
  recordedAt: now
} as const
const incident = {
  incidentId: 'minc_read_model',
  shopId: 'shp_read_model',
  provider: 'meta',
  channel: 'whatsapp',
  kind: 'contradictory_evidence',
  status: 'contained',
  severity: 'high',
  safeSummary: 'Fallback is contained',
  containmentScope: 'provider_channel',
  openedAt: now
} as const
const channelControl = {
  controlId: 'mcc_read_model',
  environment: 'test',
  channel: 'whatsapp',
  provider: 'meta',
  enabled: false,
  reason: 'Incident containment',
  updatedAt: now
} as const

const seedOptions = {
  deliveries: [delivery],
  balances: [balance],
  reconciliationCases: [reconciliationCase],
  routes: [route],
  charges: [charge],
  providerCosts: [providerCost],
  incidents: [incident],
  channelControls: [channelControl]
} as const

let test: TestD1

beforeAll(async () => {
  test = await provisionTestD1()
  const statements = [
    `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
     VALUES ('mer_read_model', 'Read Model', 'read-model', 'UTC', 'EUR', 'solo', '${now}', '${now}')`,
    `INSERT INTO brands (id, merchant_id, name, created_at, updated_at)
     VALUES ('brd_read_model', 'mer_read_model', 'Read Model', '${now}', '${now}')`,
    `INSERT INTO shops (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at)
     VALUES ('shp_read_model', 'brd_read_model', 'mer_read_model', 'read-model', 'Read Model', 'UTC', 'EUR', '${now}', '${now}')`,
    `INSERT INTO notification_intents
     (id, shop_id, topic, recipient_json, payload_json, source_type, source_id, source_version,
      deduplication_key, status, available_at, purpose, phase, created_at, updated_at)
     VALUES ('nti_read_model', 'shp_read_model', 'appointment.confirmation', '{}', '{}',
      'appointment', 'apt_read_model', 1, 'confirmation:apt_read_model:1', 'processing',
      '${now}', 'appointment_confirmation', 'awaiting_provider', '${now}', '${now}')`,
    `INSERT INTO protected_messaging_destinations
     (id, shop_id, intent_id, ciphertext, key_version, fingerprint, masked_value, country_code, created_at)
     VALUES ('pmd_read_model', 'shp_read_model', 'nti_read_model', 'ciphertext-never-projected',
      1, 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '+40•••••••456', 'RO', '${now}')`,
    `INSERT INTO messaging_balances (shop_id, currency, created_at, updated_at)
     VALUES ('shp_read_model', 'EUR', '${now}', '${now}')`,
    `INSERT INTO messaging_balance_ledger_entries
     (id, shop_id, direction, kind, amount_milli_euro, currency, source_type, source_id,
      idempotency_key, occurred_at, created_at)
     VALUES ('mle_read_model', 'shp_read_model', 'credit', 'top_up', 10000, 'EUR',
      'stripe_payment', 'pi_read_model', 'stripe:pi_read_model', '${now}', '${now}')`,
    `INSERT INTO messaging_balance_reservations
     (id, shop_id, intent_id, rate_card_id, amount_milli_euro, status, expires_at,
      converted_at, created_at, updated_at)
     VALUES ('mbr_read_model', 'shp_read_model', 'nti_read_model', 'mrcard_launch_v1',
      45, 'converted', '2026-08-05T12:00:00.000Z', '${now}', '${now}', '${now}')`,
    `INSERT INTO delivery_routes
     (id, shop_id, intent_id, ordinal, channel, provider, state, accepted_at, delivered_at,
      created_at, updated_at)
     VALUES ('drt_read_model', 'shp_read_model', 'nti_read_model', 0, 'whatsapp', 'meta',
      'delivered', '${now}', '${now}', '${now}', '${now}')`,
    `INSERT INTO submission_attempts
     (id, shop_id, intent_id, route_id, ordinal, idempotency_key, request_fingerprint,
      state, started_at, completed_at, created_at)
     VALUES ('pat_read_model', 'shp_read_model', 'nti_read_model', 'drt_read_model', 0,
      'idem_read_model',
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'accepted', '${now}', '${now}', '${now}')`,
    `INSERT INTO provider_evidence
     (id, shop_id, intent_id, route_id, attempt_id, environment, provider,
      provider_account_key, source, source_event_key, provider_reference_fingerprint,
      status, trusted, observed_at, created_at)
     VALUES ('pevd_read_model', 'shp_read_model', 'nti_read_model', 'drt_read_model',
      'pat_read_model', 'test', 'meta', 'meta_test', 'callback', 'callback:delivery',
      'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'delivered', 1, '${now}', '${now}')`,
    `INSERT INTO messaging_balance_ledger_entries
     (id, shop_id, direction, kind, amount_milli_euro, currency, source_type, source_id,
      idempotency_key, rate_card_id, intent_id, occurred_at, created_at)
     VALUES ('mle_delivery_read_model', 'shp_read_model', 'debit', 'delivery_charge', 45,
      'EUR', 'notification_intent', 'nti_read_model', 'delivery:nti_read_model',
      'mrcard_launch_v1', 'nti_read_model', '${now}', '${now}')`,
    `INSERT INTO chargeable_deliveries
     (id, shop_id, intent_id, reservation_id, rate_card_id, route_id, charge_milli_euro,
      verified_at, created_at)
     VALUES ('mcd_read_model', 'shp_read_model', 'nti_read_model', 'mbr_read_model',
      'mrcard_launch_v1', 'drt_read_model', 45, '${now}', '${now}')`,
    `INSERT INTO provider_messaging_costs
     (id, shop_id, intent_id, attempt_id, environment, provider, provider_account_key,
      billing_identity_fingerprint, unit_ordinal, amount_minor_units, currency,
      currency_scale, units, source, recorded_at, created_at)
     VALUES ('pmc_read_model', 'shp_read_model', 'nti_read_model', 'pat_read_model', 'test',
      'meta', 'meta_test',
      'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      0, 239, 'EUR', 4, 1, 'invoice', '${now}', '${now}')`,
    `INSERT INTO messaging_incidents
     (id, shop_id, provider, channel, kind, status, severity, safe_summary,
      containment_scope, opened_by_actor_type, opened_by_actor_id, opened_at,
      created_at, updated_at)
     VALUES ('minc_read_model', 'shp_read_model', 'meta', 'whatsapp',
      'contradictory_evidence', 'contained', 'high', 'Fallback is contained',
      'provider_channel', 'system_operator', 'opr_read_model', '${now}', '${now}', '${now}')`,
    `INSERT INTO messaging_channel_controls
     (id, environment, channel, provider, enabled, reason, created_at, updated_at)
     VALUES ('mcc_read_model', 'test', 'whatsapp', 'meta', 0, 'Incident containment',
      '${now}', '${now}')`,
    `INSERT INTO messaging_reconciliation_cases
     (id, shop_id, intent_id, kind, source_identity, status, severity, safe_summary,
      opened_at, created_at, updated_at)
     VALUES ('mrcase_read_model', 'shp_read_model', 'nti_read_model',
      'contradictory_evidence', 'intent:nti_read_model', 'open', 'high',
      'Delivery evidence needs review', '${now}', '${now}', '${now}')`
  ]
  for (const statement of statements) await test.d1.prepare(statement).run()
}, 60_000)

afterAll(async () => test.dispose())

const read = <A, E>(
  effect: Effect.Effect<A, E, MessagingReadModel>,
  layer: Layer.Layer<MessagingReadModel>
) => Effect.runPromise(effect.pipe(Effect.provide(layer)))

const readLive = <A, E>(effect: Effect.Effect<A, E, MessagingReadModel>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(LiveMessagingReadModel.pipe(Layer.provide(layerFromD1(test.d1))))
    )
  )

describe('Operational Messaging safe read model', () => {
  it('keeps Seed and Live tenant-scoped delivery projections in parity', async () => {
    const seed = SeedMessagingReadModel(seedOptions)
    const effect = Effect.flatMap(MessagingReadModel, (model) =>
      model.delivery({ shopId: 'shp_read_model', intentId: 'nti_read_model' })
    )

    await expect(read(effect, seed)).resolves.toEqual(delivery)
    await expect(readLive(effect)).resolves.toEqual(delivery)

    const serialized = JSON.stringify(await readLive(effect))
    expect(serialized).not.toContain('ciphertext-never-projected')
    expect(serialized).not.toContain('sha256:')
  })

  it('keeps exact balance and safe case projections in Seed and Live parity', async () => {
    const seed = SeedMessagingReadModel(seedOptions)
    const effect = Effect.flatMap(MessagingReadModel, (model) =>
      Effect.all({
        balance: model.balance('shp_read_model'),
        cases: model.reconciliationCases({ shopId: 'shp_read_model' })
      })
    )

    const expected = { balance, cases: [reconciliationCase] }
    await expect(read(effect, seed)).resolves.toEqual(expected)
    await expect(readLive(effect)).resolves.toEqual(expected)
  })

  it('does not reveal another Shop through the Merchant delivery lookup', async () => {
    const effect = Effect.flatMap(MessagingReadModel, (model) =>
      model.delivery({ shopId: 'shp_other', intentId: 'nti_read_model' })
    )

    await expect(readLive(effect)).rejects.toMatchObject({
      _tag: 'MessagingProjectionNotFound',
      projection: 'delivery'
    })
  })

  it('keeps safe Operations routing, finance, incident, and control projections in parity', async () => {
    const seed = SeedMessagingReadModel(seedOptions)
    const effect = Effect.flatMap(MessagingReadModel, (model) =>
      model.operationsSnapshot({
        shopId: 'shp_read_model',
        intentId: 'nti_read_model'
      })
    )
    const expected = {
      cases: [reconciliationCase],
      routes: [route],
      charges: [charge],
      providerCosts: [providerCost],
      incidents: [incident],
      channelControls: [channelControl]
    }

    await expect(read(effect, seed)).resolves.toEqual(expected)
    await expect(readLive(effect)).resolves.toEqual(expected)
    const serialized = JSON.stringify(await readLive(effect))
    expect(serialized).not.toContain('sha256:')
    expect(serialized).not.toContain('ciphertext-never-projected')
  })

  it('removes destination display data from safe projections after crypto-erasure', async () => {
    await test.d1
      .prepare(
        `UPDATE protected_messaging_destinations
         SET ciphertext = NULL, fingerprint = NULL, masked_value = NULL, erased_at = ?
         WHERE id = 'pmd_read_model'`
      )
      .bind(now)
      .run()
    const effect = Effect.flatMap(MessagingReadModel, (model) =>
      model.delivery({ shopId: 'shp_read_model', intentId: 'nti_read_model' })
    )
    const { maskedDestination: _removed, ...erasedDelivery } = delivery

    await expect(readLive(effect)).resolves.toEqual(erasedDelivery)
  })
})
