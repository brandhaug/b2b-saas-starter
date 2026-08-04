import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Effect, Layer } from 'effect'
import { batch, Database, layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  type AppointmentEmailPurpose,
  AppointmentEmailWorkflows,
  appointmentEmailMutationStatements,
  makeLiveAppointmentEmailWorkflows,
  prepareAppointmentEmailMutation,
  supersedeAppointmentEmailMutations
} from './appointment-email.ts'
import {
  makeConfiguredTransactionalEmailProvider,
  makeLiveTransactionalEmailLayer,
  TransactionalEmail
} from './transactional-email.ts'

const now = '2026-08-03T10:00:00.000Z'
const protection = {
  encryption: 'appointment-email-encryption-test-key',
  fingerprint: 'appointment-email-fingerprint-test-key',
  keyVersion: 1
} as const
let test: TestD1

beforeAll(async () => {
  test = await provisionTestD1()
  await test.d1
    .prepare(
      `INSERT INTO merchants
       (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
       VALUES ('mer_aemail', 'Email Studio', 'email-studio', 'Europe/Bucharest',
               'RON', 'solo', ?, ?)`
    )
    .bind(now, now)
    .run()
  await test.d1
    .prepare(
      `INSERT INTO brands (id, merchant_id, name, created_at, updated_at)
       VALUES ('brd_aemail', 'mer_aemail', 'Email Studio', ?, ?)`
    )
    .bind(now, now)
    .run()
  await test.d1
    .prepare(
      `INSERT INTO shops
       (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at)
       VALUES ('shp_aemail', 'brd_aemail', 'mer_aemail', 'email-studio',
               'Email Studio', 'Europe/Bucharest', 'RON', ?, ?)`
    )
    .bind(now, now)
    .run()
})

afterAll(async () => test.dispose())

const prepare = async (
  sourceId: string,
  purpose: AppointmentEmailPurpose = 'appointment_confirmation',
  withConfirmationAccess = false
) => {
  const database = layerFromD1(test.d1)
  const prepared = await Effect.runPromise(
    Effect.provide(
      Effect.flatMap(Database, (db) =>
        prepareAppointmentEmailMutation(
          db,
          {
            merchantId: 'mer_aemail',
            shopId: 'shp_aemail',
            sourceType: 'appointment',
            sourceId,
            sourceRevision: 1,
            appointmentIds: [sourceId],
            purpose,
            destination: `${sourceId}@example.test`,
            locale: 'en',
            facts: {
              merchantLabel: 'Email Studio',
              startsAt: '2026-08-04T10:00:00.000Z',
              timeZone: 'Europe/Bucharest',
              ...(withConfirmationAccess
                ? {
                    confirmationAccess: {
                      merchantSlug: 'email-studio',
                      routeId: 'cnf_aemail',
                      purpose: 'appointment_confirmation' as const,
                      tokenVersion: 2,
                      signingKeyId: 'email-current',
                      expiresAt: '2026-09-04T10:00:00.000Z'
                    }
                  }
                : {})
            },
            availableAt: now,
            ...(purpose === 'appointment_reminder'
              ? { usefulUntil: '2026-08-04T10:00:00.000Z' }
              : {}),
            createdAt: now
          },
          protection
        )
      ),
      database
    )
  )
  await Effect.runPromise(
    Effect.provide(
      Effect.flatMap(Database, (db) =>
        batch(db, appointmentEmailMutationStatements(prepared))
      ),
      database
    )
  )
  return prepared.intentId
}

describe('Appointment Email workflows', () => {
  it('writes one attempt before I/O and refines verified delivery with later adverse evidence', async () => {
    const intentId = await prepare(
      'apt_aemail_accept',
      'appointment_confirmation',
      true
    )
    const send = vi.fn(async (_message: { readonly text: string }) => ({
      providerSubmissionId: 'provider-message-aemail',
      acceptedAt: now
    }))
    const provider = makeConfiguredTransactionalEmailProvider({
      sender: 'booking@beesolo.example',
      callbackSecret: 'callback-secret',
      providerReferenceFingerprintKey: 'provider-reference-key',
      send
    })
    const database = layerFromD1(test.d1)
    const workflowLayer = makeLiveAppointmentEmailWorkflows({
      provider,
      destinationEncryptionSecret: protection.encryption,
      confirmationSigningKeys: { 'email-current': 'confirmation-test-key' },
      publicOrigin: 'https://booking.example.test'
    }).pipe(Layer.provide(database))

    await Promise.all(
      Array.from({ length: 25 }, () =>
        Effect.runPromise(
          Effect.provide(
            Effect.flatMap(AppointmentEmailWorkflows, (service) =>
              service.execute({ intentId, now })
            ),
            workflowLayer
          )
        )
      )
    )
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0].text).toContain(
      'https://booking.example.test/email-studio/booking/confirmations/cnf_aemail?token='
    )
    expect(
      JSON.stringify(
        await test.d1
          .prepare(
            'SELECT facts_json factsJson FROM appointment_email_intents WHERE id = ?'
          )
          .bind(intentId)
          .first()
      )
    ).not.toContain('confirmation-test-key')
    const accepted = await test.d1
      .prepare(
        `SELECT status, attempt_count attemptCount FROM appointment_email_intents WHERE id = ?`
      )
      .bind(intentId)
      .first<{ status: string; attemptCount: number }>()
    expect(accepted).toEqual({ status: 'accepted', attemptCount: 1 })
    expect(
      await test.d1
        .prepare(
          `SELECT count(*) count FROM appointment_email_attempts WHERE intent_id = ?`
        )
        .bind(intentId)
        .first<{ count: number }>()
    ).toEqual({ count: 1 })

    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(Database, (db) =>
          batch(
            db,
            supersedeAppointmentEmailMutations(db, {
              appointmentId: 'apt_aemail_accept',
              beforeRevision: 2,
              now: '2026-08-03T10:00:30.000Z'
            })
          )
        ),
        database
      )
    )
    expect(
      await test.d1
        .prepare(
          `SELECT status, status_reason reason FROM appointment_email_intents WHERE id = ?`
        )
        .bind(intentId)
        .first()
    ).toEqual({
      status: 'superseded_after_submission',
      reason: 'source_revision_superseded_after_submission'
    })

    const rawBody = JSON.stringify({
      eventId: 'provider-event-aemail-delivered',
      messageId: 'provider-message-aemail',
      status: 'delivered',
      occurredAt: '2026-08-03T10:01:00.000Z'
    })
    const timestamp = '2026-08-03T10:01:01.000Z'
    const signature = await provider.signCallbackForTest!(timestamp, rawBody)
    const callbackLayer = makeLiveTransactionalEmailLayer(provider).pipe(
      Layer.provide(database)
    )
    const receive = () =>
      Effect.runPromise(
        Effect.provide(
          Effect.flatMap(TransactionalEmail, (email) =>
            email.receiveCallback({
              rawBody,
              signature,
              timestamp,
              now: timestamp
            })
          ),
          callbackLayer
        )
      )
    expect(await receive()).toBe('applied')
    expect(await receive()).toBe('duplicate')
    const summaries = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(AppointmentEmailWorkflows, (service) =>
          service.summaries({
            merchantId: 'mer_aemail',
            appointmentId: 'apt_aemail_accept'
          })
        ),
        workflowLayer
      )
    )
    expect(summaries).toEqual([
      expect.objectContaining({
        intentId,
        status: 'superseded_after_submission',
        attemptCount: 1,
        maskedDestination: 'a••••@example.test',
        deliveredAt: '2026-08-03T10:01:00.000Z'
      })
    ])
    expect(JSON.stringify(summaries)).not.toContain('provider-message-aemail')

    const failedBody = JSON.stringify({
      eventId: 'provider-event-aemail-hard-bounce',
      messageId: 'provider-message-aemail',
      status: 'failed',
      code: 'hard_bounce',
      occurredAt: '2026-08-03T10:02:00.000Z'
    })
    const failedTimestamp = '2026-08-03T10:02:01.000Z'
    const failedSignature = await provider.signCallbackForTest!(
      failedTimestamp,
      failedBody
    )
    const failedOutcome = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(TransactionalEmail, (email) =>
          email.receiveCallback({
            rawBody: failedBody,
            signature: failedSignature,
            timestamp: failedTimestamp,
            now: failedTimestamp
          })
        ),
        callbackLayer
      )
    )
    expect(failedOutcome).toBe('applied')
    expect(
      await test.d1
        .prepare(
          `SELECT status, status_reason reason FROM appointment_email_intents WHERE id = ?`
        )
        .bind(intentId)
        .first()
    ).toEqual({
      status: 'superseded_after_submission',
      reason: 'source_revision_superseded_after_submission'
    })
    expect(
      await test.d1
        .prepare(
          `SELECT kind, status FROM appointment_email_attention WHERE intent_id = ?`
        )
        .bind(intentId)
        .first()
    ).toEqual({ kind: 'hard_bounce', status: 'open' })
  })

  it('durably records unavailable work when destination protection is absent', async () => {
    const database = layerFromD1(test.d1)
    const prepared = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(Database, (db) =>
          prepareAppointmentEmailMutation(db, {
            merchantId: 'mer_aemail',
            shopId: 'shp_aemail',
            sourceType: 'appointment',
            sourceId: 'apt_aemail_unconfigured',
            sourceRevision: 1,
            appointmentIds: ['apt_aemail_unconfigured'],
            purpose: 'appointment_confirmation',
            destination: 'customer@example.test',
            locale: 'ro',
            facts: {
              merchantLabel: 'Email Studio',
              startsAt: '2026-08-04T10:00:00.000Z',
              timeZone: 'Europe/Bucharest'
            },
            availableAt: now,
            createdAt: now
          })
        ),
        database
      )
    )
    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(Database, (db) =>
          batch(db, appointmentEmailMutationStatements(prepared))
        ),
        database
      )
    )
    expect(
      await test.d1
        .prepare(
          `SELECT status, status_reason reason, destination_ciphertext ciphertext
           FROM appointment_email_intents WHERE id = ?`
        )
        .bind(prepared.intentId)
        .first()
    ).toEqual({
      status: 'unavailable',
      reason: 'destination_protection_unavailable',
      ciphertext: null
    })
  })

  it('turns a stale post-write-ahead claim into reconciliation-only ambiguity', async () => {
    const intentId = await prepare('apt_aemail_stale', 'appointment_reminder')
    await test.d1
      .prepare(
        `UPDATE appointment_email_intents SET status = 'claimed', claimed_at = ?, claim_token = 'lost-worker'
         WHERE id = ?`
      )
      .bind('2026-08-03T09:00:00.000Z', intentId)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO appointment_email_attempts
         (id, intent_id, ordinal, idempotency_key, state, started_at, created_at)
         VALUES ('aep_stale', ?, 1, 'stale-attempt', 'submitting', ?, ?)`
      )
      .bind(intentId, '2026-08-03T09:00:00.000Z', '2026-08-03T09:00:00.000Z')
      .run()
    const provider = makeConfiguredTransactionalEmailProvider({
      sender: 'booking@beesolo.example',
      callbackSecret: 'callback-secret',
      providerReferenceFingerprintKey: 'provider-reference-key',
      send: vi.fn()
    })
    const layer = makeLiveAppointmentEmailWorkflows({
      provider,
      destinationEncryptionSecret: protection.encryption
    }).pipe(Layer.provide(layerFromD1(test.d1)))
    const due = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(AppointmentEmailWorkflows, (service) =>
          service.discoverDue({ now, limit: 1000 })
        ),
        layer
      )
    )
    expect(due).not.toContain(intentId)
    expect(
      await test.d1
        .prepare(
          `SELECT status, status_reason reason FROM appointment_email_intents WHERE id = ?`
        )
        .bind(intentId)
        .first()
    ).toEqual({ status: 'submission_unknown', reason: 'stale_submission_claim' })
  })

  it('recovers a full 1,000-intent sweep without creating semantic duplicates', async () => {
    await test.d1
      .prepare(
        `WITH RECURSIVE sequence(value) AS (
           SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < 1000
         )
         INSERT INTO appointment_email_intents
           (id, merchant_id, shop_id, source_type, source_id, source_revision,
            appointment_ids_json, purpose, semantic_key, locale, template_key,
            template_version, destination_key_version, facts_json, facts_fingerprint,
            available_at, status, created_at, updated_at)
         SELECT printf('aem_recovery_%04d', value), 'mer_aemail', 'shp_aemail',
                'appointment', printf('apt_recovery_%04d', value), 1,
                json_array(printf('apt_recovery_%04d', value)),
                'appointment_confirmation', printf('recovery-semantic-%04d', value),
                'en', 'beesolo_appointment_confirmation_en_v1', 1, 1,
                '{}', printf('facts-%04d', value), ?, 'pending', ?, ?
         FROM sequence`
      )
      .bind(now, now, now)
      .run()
    const provider = makeConfiguredTransactionalEmailProvider({
      sender: 'booking@beesolo.example',
      callbackSecret: 'callback-secret',
      providerReferenceFingerprintKey: 'provider-reference-key',
      send: vi.fn()
    })
    const layer = makeLiveAppointmentEmailWorkflows({ provider }).pipe(
      Layer.provide(layerFromD1(test.d1))
    )
    const discover = () =>
      Effect.runPromise(
        Effect.provide(
          Effect.flatMap(AppointmentEmailWorkflows, (service) =>
            service.discoverDue({ now, limit: 1000 })
          ),
          layer
        )
      )
    const first = await discover()
    const second = await discover()
    expect(first).toHaveLength(1000)
    expect(new Set(first).size).toBe(1000)
    expect(second).toEqual(first)
    expect(
      await test.d1
        .prepare(
          `SELECT count(*) count, count(DISTINCT semantic_key) semanticCount
           FROM appointment_email_intents WHERE id LIKE 'aem_recovery_%'`
        )
        .first()
    ).toEqual({ count: 1000, semanticCount: 1000 })
  })

  it('exhausts bounded retries into durable dead-letter and attention evidence', async () => {
    const intentId = await prepare('apt_aemail_retry')
    const provider = {
      state: 'configured' as const,
      sender: 'booking@beesolo.example',
      fingerprintDestination: () => Effect.succeed('destination-fingerprint'),
      submit: () =>
        Effect.succeed({
          _tag: 'failed' as const,
          code: 'provider_busy',
          retryable: true
        }),
      verifyCallback: () => Effect.succeed({ _tag: 'ignored' as const })
    }
    const layer = makeLiveAppointmentEmailWorkflows({
      provider,
      destinationEncryptionSecret: protection.encryption
    }).pipe(Layer.provide(layerFromD1(test.d1)))
    const attemptTimes = [0, 1, 6, 21, 81, 321, 1041].map((minutes) =>
      new Date(Date.parse(now) + minutes * 60_000).toISOString()
    )
    for (const attemptAt of attemptTimes)
      await Effect.runPromise(
        Effect.provide(
          Effect.flatMap(AppointmentEmailWorkflows, (service) =>
            service.execute({ intentId, now: attemptAt })
          ),
          layer
        )
      )
    expect(
      await test.d1
        .prepare(
          `SELECT status, status_reason reason, attempt_count attemptCount
           FROM appointment_email_intents WHERE id = ?`
        )
        .bind(intentId)
        .first()
    ).toEqual({ status: 'failed', reason: 'provider_busy', attemptCount: 7 })
    expect(
      await test.d1
        .prepare(
          `SELECT count(*) count FROM appointment_email_dead_letters WHERE intent_id = ?`
        )
        .bind(intentId)
        .first()
    ).toEqual({ count: 1 })
    expect(
      await test.d1
        .prepare(
          `SELECT kind, status FROM appointment_email_attention WHERE intent_id = ?`
        )
        .bind(intentId)
        .first()
    ).toEqual({ kind: 'delivery_failed', status: 'open' })
  })
})
