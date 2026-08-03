import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  NotificationIntentLifecycle,
  type PrepareNotificationIntentInput
} from './notification-intent-lifecycle.ts'
import { LiveNotificationIntentLifecycle } from './notification-intent-lifecycle.live.ts'
import { LiveMessagingFinance } from './messaging-finance.ts'
import {
  controlledTemplateCatalog,
  SeedControlledTemplateEligibilityEngine,
  type OperationalMessageEligibilityInput
} from './controlled-template-eligibility.ts'

const now = '2026-07-29T12:00:00.000Z'
const base: PrepareNotificationIntentInput = {
  id: 'nti_live_lifecycle',
  shopId: 'shp_live_lifecycle',
  topic: 'appointment.confirmation',
  sourceType: 'appointment',
  sourceId: 'apt_live_lifecycle',
  sourceVersion: 1,
  recipientRole: 'customer',
  recipientSnapshot: {
    ciphertext: 'ciphertext:test-customer',
    fingerprint: `sha256:${'1'.repeat(64)}`,
    maskedValue: '+40•••••••456',
    countryCode: 'RO',
    keyVersion: 1
  },
  deduplicationKey: 'confirmation:apt_live_lifecycle:1',
  purpose: 'appointment_confirmation',
  locale: 'ro',
  availableAt: now,
  createdAt: now
}

const eligibilityFor = (
  channel: 'whatsapp' | 'sms',
  at = now
): OperationalMessageEligibilityInput => ({
  shopId: base.shopId,
  purpose: base.purpose,
  locale: base.locale,
  channel,
  provider: channel === 'whatsapp' ? 'meta' : 'smso',
  templateVersion: channel === 'whatsapp' ? 1 : 2,
  destinationFingerprint: base.recipientSnapshot.fingerprint,
  permission: {
    granted: true,
    destinationFingerprint: base.recipientSnapshot.fingerprint
  },
  suppressions: [],
  controls: {
    globalEnabled: true,
    merchantEnabled: true,
    merchantFrozen: false,
    purposeEnabled: true,
    channelEnabled: true,
    providerConfigured: true
  },
  now: at,
  appointmentStartsAt: '2026-07-30T12:00:00.000Z',
  shopTimeZone: 'Europe/Bucharest',
  facts: {
    merchantLabel: 'BeeSolo Studio',
    merchantSmsLabel: 'BeeSolo',
    localizedDate: '30 iulie 2026',
    smsDate: '30.07.2026',
    time: '15:00',
    locationLabel: 'Strada Florilor 10, București',
    locationSmsLabel: 'Str Florilor 10',
    reference: 'APT-123',
    confirmationUrl: 'https://bsolo.ro/c/APT123'
  }
})

const routingEligibility = (at = now) => ({
  whatsapp: eligibilityFor('whatsapp', at),
  sms: eligibilityFor('sms', at)
})

let test: TestD1

beforeAll(async () => {
  test = await provisionTestD1()
  for (const statement of [
    `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
     VALUES ('mer_live_lifecycle', 'Lifecycle', 'lifecycle', 'Europe/Bucharest', 'EUR',
       'solo', '${now}', '${now}')`,
    `INSERT INTO brands (id, merchant_id, name, created_at, updated_at)
     VALUES ('brd_live_lifecycle', 'mer_live_lifecycle', 'Lifecycle', '${now}', '${now}')`,
    `INSERT INTO shops
     (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at)
     VALUES ('shp_live_lifecycle', 'brd_live_lifecycle', 'mer_live_lifecycle', 'lifecycle',
       'Lifecycle', 'Europe/Bucharest', 'EUR', '${now}', '${now}')`,
    `INSERT INTO messaging_balances (shop_id, currency, financially_frozen, created_at, updated_at)
     VALUES ('shp_live_lifecycle', 'EUR', 0, '${now}', '${now}')`,
    `INSERT INTO merchant_messaging_controls
     (shop_id, enabled, confirmation_enabled, reminder_enabled, cancellation_enabled,
      reschedule_enabled, frozen, created_at, updated_at)
     VALUES ('shp_live_lifecycle', 1, 1, 1, 1, 1, 0, '${now}', '${now}')`,
    `INSERT INTO messaging_channel_controls
     (id, environment, channel, provider, enabled, created_at, updated_at)
     VALUES
       ('mcc_live_meta', 'test', 'whatsapp', 'meta', 1, '${now}', '${now}'),
       ('mcc_live_smso', 'test', 'sms', 'smso', 1, '${now}', '${now}')`,
    `INSERT INTO messaging_financial_external_facts
     (id, shop_id, kind, provider, source_id, status, amount_milli_euro, currency,
      reference, observed_at, created_at)
     VALUES ('mff_live_lifecycle_funding', 'shp_live_lifecycle', 'provider_payment',
      'stripe', 'pi_live_lifecycle', 'confirmed', 10000, 'EUR',
      'invoice:live-lifecycle', '${now}', '${now}')`,
    `INSERT INTO messaging_balance_ledger_entries
     (id, shop_id, direction, kind, amount_milli_euro, currency, source_type,
      source_id, idempotency_key, fiscal_reference, external_fact_id, occurred_at, created_at)
     VALUES ('mle_live_lifecycle_funding', 'shp_live_lifecycle', 'credit',
      'top_up', 10000, 'EUR', 'stripe_payment', 'pi_live_lifecycle',
      'stripe:pi_live_lifecycle', 'invoice:live-lifecycle',
      'mff_live_lifecycle_funding', '${now}', '${now}')`
  ])
    await test.d1.prepare(statement).run()
}, 60_000)

afterAll(async () => test.dispose())

const live = () =>
  LiveNotificationIntentLifecycle.pipe(
    Layer.provide(LiveMessagingFinance),
    Layer.provide(
      SeedControlledTemplateEligibilityEngine(
        controlledTemplateCatalog.map((template) =>
          template.channel === 'whatsapp'
            ? {
                ...template,
                enabled: true,
                providerApproval: {
                  ...template.providerApproval!,
                  observedCategory: 'utility' as const,
                  status: 'approved' as const,
                  approvedAt: now,
                  evidenceReference: `test:${template.id}`
                }
              }
            : template
        )
      )
    ),
    Layer.provide(layerFromD1(test.d1))
  )

const run = <A, E>(effect: Effect.Effect<A, E, NotificationIntentLifecycle>) =>
  Effect.runPromise(effect.pipe(Effect.provide(live())))

describe('Live Notification Intent lifecycle', () => {
  it('atomically deduplicates concurrent semantic preparation', async () => {
    const create = (input: PrepareNotificationIntentInput) =>
      run(
        Effect.flatMap(NotificationIntentLifecycle, (service) => service.prepare(input))
      )
    const results = await Promise.all([
      create(base),
      create({ ...base, id: 'nti_live_lifecycle_racer' })
    ])

    expect(new Set(results.map((intent) => intent.id))).toEqual(
      new Set(['nti_live_lifecycle'])
    )
    const row = await test.d1
      .prepare(
        `SELECT COUNT(*) AS count FROM notification_intents
         WHERE deduplication_key = ?`
      )
      .bind(base.deduplicationKey)
      .first<{ count: number }>()
    expect(row?.count).toBe(1)
  })

  it('persists write-ahead attempts and idempotent evidence through the Effect seam', async () => {
    const result = await run(
      Effect.gen(function* () {
        const service = yield* NotificationIntentLifecycle
        yield* service.beginRouting({
          intentId: base.id,
          environment: 'test',
          eligibility: routingEligibility(),
          reservationId: 'mbr_live_lifecycle',
          rateCardId: 'mrcard_launch_v1',
          chargeMilliEuro: 45,
          now
        })
        const prepared = yield* service.prepareSubmission({
          intentId: base.id,
          channel: 'whatsapp',
          environment: 'test',
          eligibility: eligibilityFor('whatsapp'),
          requestFingerprint: `sha256:${'a'.repeat(64)}`,
          now
        })
        yield* service.recordSubmissionOutcome({
          intentId: base.id,
          attemptId: prepared.attempt.id,
          outcome: 'accepted',
          environment: 'test',
          providerAccountKey: 'test-provider-account',
          sourceEventKey: 'response:test',
          now
        })
        const evidence = {
          id: 'pevd_live_delivered',
          intentId: base.id,
          attemptId: prepared.attempt.id,
          environment: 'test',
          providerAccountKey: 'meta_test',
          source: 'callback' as const,
          sourceEventKey: 'meta:live:delivered',
          providerReferenceFingerprint: `sha256:${'b'.repeat(64)}`,
          pricingPolicyVersion: 'meta-pricing-2026-07-29',
          providerBillable: true,
          providerPricingCategory: 'utility',
          providerPricingModel: 'PMP',
          providerOccurredAt: '2026-07-29T12:00:58.000Z',
          status: 'delivered' as const,
          trusted: true,
          observedAt: '2026-07-29T12:01:00.000Z'
        }
        yield* service.ingestEvidence(evidence)
        yield* service.ingestEvidence({ ...evidence, id: 'pevd_live_duplicate' })
        return yield* service.findById(base.id)
      })
    )

    expect(result).toMatchObject({
      phase: 'terminal',
      result: 'delivered',
      reservation: { status: 'converted' },
      chargeableDelivery: { chargeMilliEuro: 45 }
    })
    const counts = await test.d1
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM submission_attempts WHERE intent_id = ?) AS attempts,
           (SELECT COUNT(*) FROM submission_outcomes WHERE intent_id = ?) AS outcomes,
           (SELECT COUNT(*) FROM provider_evidence WHERE intent_id = ?) AS evidence`
      )
      .bind(base.id, base.id, base.id)
      .first<{ attempts: number; outcomes: number; evidence: number }>()
    expect(counts).toEqual({ attempts: 1, outcomes: 1, evidence: 2 })
    const callbackEvidence = await test.d1
      .prepare(
        `SELECT pricing_policy_version, provider_billable,
                provider_pricing_category, provider_pricing_model, provider_occurred_at
         FROM provider_evidence WHERE id = 'pevd_live_delivered'`
      )
      .first<{
        pricing_policy_version: string
        provider_billable: number
        provider_pricing_category: string
        provider_pricing_model: string
        provider_occurred_at: string
      }>()
    expect(callbackEvidence).toEqual({
      pricing_policy_version: 'meta-pricing-2026-07-29',
      provider_billable: 1,
      provider_pricing_category: 'utility',
      provider_pricing_model: 'PMP',
      provider_occurred_at: '2026-07-29T12:00:58.000Z'
    })
    const finance = await test.d1
      .prepare(
        `SELECT
           (SELECT status FROM messaging_balance_reservations WHERE intent_id = ?) AS reservation_status,
           (SELECT COUNT(*) FROM chargeable_deliveries WHERE intent_id = ?) AS deliveries,
           (SELECT COUNT(*) FROM messaging_balance_ledger_entries
             WHERE intent_id = ? AND kind = 'delivery_charge') AS charges`
      )
      .bind(base.id, base.id, base.id)
      .first<{
        reservation_status: string
        deliveries: number
        charges: number
      }>()
    expect(finance).toEqual({
      reservation_status: 'converted',
      deliveries: 1,
      charges: 1
    })
  })

  it('enforces fresh manual command idempotency and concurrent five-minute limits', async () => {
    const manual = (commandKey: string, id: string) =>
      ({
        ...base,
        id,
        sourceId: 'apt_live_manual',
        sourceVersion: 2,
        deduplicationKey: `caller-value:${commandKey}`,
        manual: { commandKey, actorId: 'usr_owner' },
        createdAt: '2026-07-29T14:00:00.000Z',
        availableAt: '2026-07-29T14:00:00.000Z'
      }) as const
    const create = (input: ReturnType<typeof manual>) =>
      run(
        Effect.flatMap(NotificationIntentLifecycle, (service) =>
          service.createManual(input)
        )
      )
    const first = await create(manual('command-one', 'nti_live_manual_one'))
    const duplicate = await create(manual('command-one', 'nti_live_manual_ignored'))
    expect(duplicate.id).toBe(first.id)

    const raced = await Promise.allSettled([
      create(manual('command-two', 'nti_live_manual_two')),
      create(manual('command-three', 'nti_live_manual_three'))
    ])
    expect(raced.every((entry) => entry.status === 'rejected')).toBe(true)
    const row = await test.d1
      .prepare(
        `SELECT COUNT(*) AS count FROM notification_intents
         WHERE shop_id = ? AND source_id = ?
           AND json_extract(payload_json, '$.operationalMessagingLifecycle.manual.commandKey') IS NOT NULL`
      )
      .bind(base.shopId, 'apt_live_manual')
      .first<{ count: number }>()
    expect(row?.count).toBe(1)
  })

  it('recovers a monotonic projection from a callback and worker-query race', async () => {
    const input = {
      ...base,
      id: 'nti_live_evidence_race',
      sourceId: 'apt_live_evidence_race',
      deduplicationKey: 'confirmation:apt_live_evidence_race:1'
    }
    const prepared = await run(
      Effect.gen(function* () {
        const service = yield* NotificationIntentLifecycle
        yield* service.prepare(input)
        yield* service.beginRouting({
          intentId: input.id,
          environment: 'test',
          eligibility: routingEligibility(),
          reservationId: 'mbr_live_evidence_race',
          rateCardId: 'mrcard_launch_v1',
          chargeMilliEuro: 45,
          now
        })
        return yield* service.prepareSubmission({
          intentId: input.id,
          channel: 'whatsapp',
          environment: 'test',
          eligibility: eligibilityFor('whatsapp'),
          requestFingerprint: `sha256:${'c'.repeat(64)}`,
          now
        })
      })
    )
    const ingest = (
      id: string,
      status: 'accepted' | 'delivered',
      observedAt: string,
      source: 'callback' | 'query'
    ) =>
      run(
        Effect.flatMap(NotificationIntentLifecycle, (service) =>
          service.ingestEvidence({
            id,
            intentId: input.id,
            attemptId: prepared.attempt.id,
            environment: 'test',
            providerAccountKey: 'meta_test',
            source,
            sourceEventKey: id,
            providerReferenceFingerprint: `sha256:${id.padEnd(64, 'd').slice(0, 64)}`,
            status,
            trusted: true,
            observedAt
          })
        )
      )

    await Promise.all([
      ingest(
        'pevd_race_old_accepted',
        'accepted',
        '2026-07-29T12:00:30.000Z',
        'callback'
      ),
      ingest('pevd_race_delivered', 'delivered', '2026-07-29T12:01:00.000Z', 'query')
    ])
    const intent = await run(
      Effect.flatMap(NotificationIntentLifecycle, (service) =>
        service.findById(input.id)
      )
    )
    expect(intent).toMatchObject({ phase: 'terminal', result: 'delivered' })
    expect(intent.routes[0]?.evidence).toHaveLength(2)
    const row = await test.d1
      .prepare('SELECT COUNT(*) AS count FROM provider_evidence WHERE intent_id = ?')
      .bind(input.id)
      .first<{ count: number }>()
    expect(row?.count).toBe(2)
  })

  it('serializes concurrent write-ahead preparation to one active attempt', async () => {
    const input = {
      ...base,
      id: 'nti_live_attempt_race',
      sourceId: 'apt_live_attempt_race',
      deduplicationKey: 'confirmation:apt_live_attempt_race:1'
    }
    await run(
      Effect.gen(function* () {
        const service = yield* NotificationIntentLifecycle
        yield* service.prepare(input)
        yield* service.beginRouting({
          intentId: input.id,
          environment: 'test',
          eligibility: routingEligibility(),
          now
        })
      })
    )
    const prepare = (fingerprint: string) =>
      run(
        Effect.flatMap(NotificationIntentLifecycle, (service) =>
          service.prepareSubmission({
            intentId: input.id,
            channel: 'whatsapp',
            environment: 'test',
            eligibility: eligibilityFor('whatsapp'),
            requestFingerprint: fingerprint,
            now
          })
        )
      )
    const raced = await Promise.allSettled([
      prepare(`sha256:${'e'.repeat(64)}`),
      prepare(`sha256:${'f'.repeat(64)}`)
    ])
    expect(raced.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1)
    const intent = await run(
      Effect.flatMap(NotificationIntentLifecycle, (service) =>
        service.findById(input.id)
      )
    )
    expect(intent.routes[0]?.attempts).toHaveLength(1)
    const row = await test.d1
      .prepare('SELECT COUNT(*) AS count FROM submission_attempts WHERE intent_id = ?')
      .bind(input.id)
      .first<{ count: number }>()
    expect(row?.count).toBe(1)
  })
})
