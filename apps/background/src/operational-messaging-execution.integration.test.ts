import { Effect, Redacted } from 'effect'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  deriveNotificationDestinationProtection,
  protectRomanianDestination
} from '@b2b-saas-starter/capabilities/notifications'
import worker from './index.ts'

const now = '2026-07-29T12:00:00.000Z'
const encryptionSecret = 'background-execution-encryption-secret'
const fingerprintSecret = 'background-execution-fingerprint-secret'
const shopId = 'shp_background_execution'

const facts = {
  merchantLabel: 'BeeSolo Studio',
  merchantSmsLabel: 'BeeSolo',
  localizedDate: '31 iulie 2026',
  smsDate: '31.07.2026',
  time: '15:00',
  locationLabel: 'Strada Florilor 10, București',
  locationSmsLabel: 'Str Florilor 10',
  reference: 'APT-WORKER',
  confirmationUrl: 'https://bsolo.ro/c/APT-WORKER'
}

type WorkerEnv = {
  readonly DB: D1Database
  readonly ENVIRONMENT: string
  readonly OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY: string
  readonly OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY: string
  readonly OPERATIONAL_MESSAGING_DESTINATION_KEY_VERSION: string
  readonly WAITING_LIST_DELIVERY_CURRENT_KEY_ID: string
  readonly WAITING_LIST_DELIVERY_LEGACY_KEY_ID: string
  readonly WAITING_LIST_DELIVERY_KEYS: string
}

type ProtectedDestination = {
  readonly ciphertext: Redacted.Redacted<string>
  readonly fingerprint: string
  readonly maskedValue: string
  readonly countryCode: 'RO'
  readonly keyVersion: number
}

describe('Background operational messaging execution', () => {
  let test: TestD1
  let env: WorkerEnv
  let protectedDestination: ProtectedDestination

  beforeAll(async () => {
    test = await provisionTestD1()
    env = {
      DB: test.d1,
      ENVIRONMENT: 'test',
      OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY: encryptionSecret,
      OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY: fingerprintSecret,
      OPERATIONAL_MESSAGING_DESTINATION_KEY_VERSION: '1',
      WAITING_LIST_DELIVERY_CURRENT_KEY_ID: 'test-current',
      WAITING_LIST_DELIVERY_LEGACY_KEY_ID: 'test-legacy',
      WAITING_LIST_DELIVERY_KEYS: JSON.stringify({
        'test-current': 'background-waiting-list-delivery-secret',
        'test-legacy': 'background-waiting-list-delivery-secret'
      })
    }
    const protection = await Effect.runPromise(
      deriveNotificationDestinationProtection({
        encryption: encryptionSecret,
        fingerprint: fingerprintSecret,
        keyVersion: 1
      })
    )
    protectedDestination = await Effect.runPromise(
      protectRomanianDestination({
        rawDestination: Redacted.make('+40722123456'),
        countryCode: 'RO',
        ...protection
      })
    )

    for (const statement of [
      `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
       VALUES ('mer_background_execution', 'Worker', 'worker', 'Europe/Bucharest',
         'EUR', 'solo', '${now}', '${now}')`,
      `INSERT INTO brands (id, merchant_id, name, created_at, updated_at)
       VALUES ('brd_background_execution', 'mer_background_execution', 'Worker',
         '${now}', '${now}')`,
      `INSERT INTO shops
       (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at)
       VALUES ('${shopId}', 'brd_background_execution', 'mer_background_execution',
         'worker', 'Worker', 'Europe/Bucharest', 'EUR', '${now}', '${now}')`,
      `INSERT INTO messaging_balances (shop_id, currency, financially_frozen, created_at, updated_at)
       VALUES ('${shopId}', 'EUR', 0, '${now}', '${now}')`,
      `INSERT INTO merchant_messaging_controls
       (shop_id, enabled, confirmation_enabled, reminder_enabled, cancellation_enabled,
        reschedule_enabled, frozen, created_at, updated_at)
       VALUES ('${shopId}', 1, 1, 1, 1, 1, 0, '${now}', '${now}')`,
      `INSERT INTO messaging_channel_controls
       (id, environment, channel, provider, enabled, created_at, updated_at)
       VALUES
         ('mcc_background_meta', 'test', 'whatsapp', 'meta', 1, '${now}', '${now}'),
         ('mcc_background_smso', 'test', 'sms', 'smso', 1, '${now}', '${now}')`,
      `UPDATE messaging_template_versions
       SET enabled = 1, provider_observed_category = 'utility',
           provider_approval_status = 'approved', provider_approved_at = '${now}',
           provider_approval_evidence_reference = 'test:background-worker'
       WHERE locale = 'ro' AND channel = 'whatsapp'`,
      `INSERT INTO messaging_financial_external_facts
       (id, shop_id, kind, provider, source_id, status, amount_milli_euro, currency,
        reference, observed_at, created_at)
       VALUES ('mff_background_funding', '${shopId}', 'provider_payment', 'stripe',
        'pi_background', 'confirmed', 10000, 'EUR', 'invoice:background', '${now}', '${now}')`,
      `INSERT INTO messaging_balance_ledger_entries
       (id, shop_id, direction, kind, amount_milli_euro, currency, source_type,
        source_id, idempotency_key, fiscal_reference, external_fact_id, occurred_at, created_at)
       VALUES ('mle_background_funding', '${shopId}', 'credit', 'top_up', 10000, 'EUR',
        'stripe_payment', 'pi_background', 'stripe:pi_background', 'invoice:background',
        'mff_background_funding', '${now}', '${now}')`
    ])
      await test.d1.prepare(statement).run()
  }, 60_000)

  afterAll(async () => test.dispose())

  const insertIntent = async (
    id: string,
    purpose: 'appointment_confirmation' | 'appointment_reminder'
  ) => {
    const topic = purpose.replace('_', '.')
    const sourceId = `apt_${id}`
    const ciphertext = Redacted.value(protectedDestination.ciphertext)
    const lifecycle = {
      id,
      shopId,
      topic,
      sourceType: 'appointment',
      sourceId,
      sourceVersion: 1,
      recipientRole: 'customer',
      deduplicationKey: `${purpose}:${sourceId}:1`,
      purpose,
      locale: 'ro',
      availableAt: now,
      createdAt: now,
      phase: purpose === 'appointment_reminder' ? 'scheduled' : 'ready',
      supersededAfterSubmission: false,
      routes: [
        {
          id: `drt_${id}_wa`,
          ordinal: 0,
          channel: 'whatsapp',
          provider: 'meta',
          state: 'planned',
          attempts: [],
          submissionOutcomes: [],
          evidence: []
        },
        {
          id: `drt_${id}_sms`,
          ordinal: 1,
          channel: 'sms',
          provider: 'smso',
          state: 'planned',
          attempts: [],
          submissionOutcomes: [],
          evidence: []
        }
      ],
      reconciliationCases: []
    }
    const recipient = {
      role: 'customer',
      destination: {
        ciphertext,
        fingerprint: protectedDestination.fingerprint,
        maskedValue: protectedDestination.maskedValue,
        countryCode: protectedDestination.countryCode,
        keyVersion: protectedDestination.keyVersion
      }
    }
    const payload = {
      operationalMessagingLifecycle: lifecycle,
      permission: {
        granted: true,
        destinationFingerprint: protectedDestination.fingerprint
      },
      appointmentStartsAt: '2026-07-31T12:00:00.000Z'
    }
    const controlledFacts =
      purpose === 'appointment_reminder' ? { ...facts, confirmationUrl: '' } : facts
    await test.d1.batch([
      test.d1
        .prepare(
          `INSERT INTO notification_intents
           (id, shop_id, topic, recipient_json, payload_json, source_type, source_id,
            source_version, deduplication_key, purpose, phase, locale, status, available_at,
            created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'appointment', ?, 1, ?, ?, ?, 'ro', 'pending', ?, ?, ?)`
        )
        .bind(
          id,
          shopId,
          topic,
          JSON.stringify(recipient),
          JSON.stringify(payload),
          sourceId,
          lifecycle.deduplicationKey,
          purpose,
          lifecycle.phase,
          now,
          now,
          now
        ),
      test.d1
        .prepare(
          `INSERT INTO protected_messaging_destinations
           (id, shop_id, intent_id, ciphertext, key_version, fingerprint, masked_value,
            country_code, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          `pmd_${id}`,
          shopId,
          id,
          ciphertext,
          protectedDestination.keyVersion,
          protectedDestination.fingerprint,
          protectedDestination.maskedValue,
          protectedDestination.countryCode,
          now
        ),
      test.d1
        .prepare(
          `INSERT INTO notification_intent_controlled_facts
           (intent_id, shop_id, template_version_id, facts_json, facts_fingerprint,
            created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          shopId,
          `mtv_ro_${purpose}_whatsapp_v1`,
          JSON.stringify(controlledFacts),
          `sha256:${'f'.repeat(64)}`,
          now,
          '2026-08-31T12:00:00.000Z'
        ),
      ...lifecycle.routes.map((route) =>
        test.d1
          .prepare(
            `INSERT INTO delivery_routes
             (id, shop_id, intent_id, ordinal, channel, provider, state, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?)`
          )
          .bind(
            route.id,
            shopId,
            id,
            route.ordinal,
            route.channel,
            route.provider,
            now,
            now
          )
      )
    ])
  }

  const durableResult = (id: string) =>
    test.d1
      .prepare(
        `SELECT ni.phase, ni.status, ni.result, ni.result_reason,
          (SELECT COUNT(*) FROM submission_attempts WHERE intent_id = ni.id) AS attempts,
          (SELECT COUNT(*) FROM submission_outcomes WHERE intent_id = ni.id) AS outcomes,
          (SELECT group_concat(channel || ':' || state || ':' || coalesce(ineligible_reason, ''))
             FROM delivery_routes WHERE intent_id = ni.id ORDER BY ordinal) AS routes,
          (SELECT source_event_key FROM provider_evidence WHERE intent_id = ni.id LIMIT 1) AS source_event_key
         FROM notification_intents ni WHERE ni.id = ?`
      )
      .bind(id)
      .first<{
        phase: string
        status: string
        result: string | null
        result_reason: string | null
        attempts: number
        outcomes: number
        routes: string
        source_event_key: string | null
      }>()

  it('acks Queue wakeups only after deterministic capture is durable, alongside legacy wakeups', async () => {
    const intentId = 'nti_background_queue'
    await insertIntent(intentId, 'appointment_confirmation')
    const intentAck = vi.fn()
    const intentRetry = vi.fn()
    const legacyAck = vi.fn()
    const legacyRetry = vi.fn()
    const batch = {
      queue: 'b2b-saas-starter-booking-events',
      messages: [
        {
          body: { version: 1, kind: 'notification-intent', intentId },
          ack: intentAck,
          retry: intentRetry
        },
        {
          body: { version: 1, kind: 'booking-outbox', outboxId: 'bout_missing' },
          ack: legacyAck,
          retry: legacyRetry
        }
      ]
    } as unknown as MessageBatch<unknown>

    await worker.queue(batch, env)

    expect(intentAck).toHaveBeenCalledOnce()
    expect(intentRetry).not.toHaveBeenCalled()
    expect(legacyAck).toHaveBeenCalledOnce()
    expect(legacyRetry).not.toHaveBeenCalled()
    expect(await durableResult(intentId)).toEqual({
      phase: 'terminal',
      status: 'cancelled',
      result: 'not_sent',
      result_reason: 'captured_local',
      attempts: 1,
      outcomes: 1,
      routes: 'whatsapp:ineligible:captured_local,sms:planned:',
      source_event_key: 'capture:pcap_pat_drt_nti_background_queue_wa_0_0001'
    })
  }, 60_000)

  it('recovers due intents on the five-minute scheduled sweep', async () => {
    const intentId = 'nti_background_recovery'
    await insertIntent(intentId, 'appointment_reminder')

    await worker.scheduled({ scheduledTime: Date.parse(now) } as ScheduledEvent, env)

    expect(await durableResult(intentId)).toEqual({
      phase: 'terminal',
      status: 'cancelled',
      result: 'not_sent',
      result_reason: 'captured_local',
      attempts: 1,
      outcomes: 1,
      routes: 'whatsapp:ineligible:captured_local,sms:planned:',
      source_event_key: 'capture:pcap_pat_drt_nti_background_recovery_wa_0_0001'
    })
  }, 60_000)
})
