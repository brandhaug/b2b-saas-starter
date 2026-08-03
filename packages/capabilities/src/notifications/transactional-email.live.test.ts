import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Effect, Layer } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  TransactionalEmail,
  makeConfiguredTransactionalEmailProvider,
  makeLiveTransactionalEmailLayer,
  ownerActivationTestIdempotencyKey
} from './transactional-email.ts'
import { makeTransactionalEmailCapabilityLayer } from '../runtime.ts'
import { CapabilityUnavailable } from '../errors.ts'

const now = '2026-08-02T10:00:00.000Z'
let test: TestD1

beforeAll(async () => {
  test = await provisionTestD1()
  await test.d1
    .prepare(
      `INSERT INTO user (id, email, name, emailVerified, identityClass, createdAt, updatedAt)
       VALUES ('usr_email_owner', 'owner@example.test', 'Owner', 1, 'merchant_member', 0, 0)`
    )
    .run()
  await test.d1
    .prepare(
      `INSERT INTO user (id, email, name, emailVerified, identityClass, createdAt, updatedAt)
       VALUES ('usr_email_failure', 'failure@example.test', 'Failure Owner', 1, 'merchant_member', 0, 0)`
    )
    .run()
  await test.d1
    .prepare(
      `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
       VALUES ('mrc_email_failure', 'Failure Shop', 'failure-shop', 'Europe/Bucharest', 'RON', 'solo', ?, ?)`
    )
    .bind(now, now)
    .run()
  await test.d1
    .prepare(
      `INSERT INTO merchant_memberships (merchant_id, user_id, role, created_at)
       VALUES ('mrc_email_failure', 'usr_email_failure', 'owner', ?)`
    )
    .bind(now)
    .run()
  await test.d1
    .prepare(
      `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
       VALUES ('mrc_email', 'Email Shop', 'email-shop', 'Europe/Bucharest', 'RON', 'solo', ?, ?)`
    )
    .bind(now, now)
    .run()
  await test.d1
    .prepare(
      `INSERT INTO merchant_memberships (merchant_id, user_id, role, created_at)
       VALUES ('mrc_email', 'usr_email_owner', 'owner', ?)`
    )
    .bind(now)
    .run()
})

afterAll(async () => test.dispose())

describe('Live Transactional Email', () => {
  it('uses the Cloudflare message ID and an idempotency header for acceptance', async () => {
    const send = vi.fn(async () => ({ messageId: 'cloudflare-message-one' }))
    const layer = makeTransactionalEmailCapabilityLayer({
      DB: test.d1,
      ENVIRONMENT: 'production',
      EMAIL: { send },
      CLOUDFLARE_EMAIL_FROM: 'booking@beesolo.example',
      TRANSACTIONAL_EMAIL_SENDER_VERIFIED: 'true',
      TRANSACTIONAL_EMAIL_CALLBACK_SECRET: 'callback-secret',
      TRANSACTIONAL_EMAIL_PROVIDER_REFERENCE_FINGERPRINT_KEY: 'provider-reference-key'
    })
    const evidence = await Effect.runPromise(
      Effect.flatMap(TransactionalEmail, (email) =>
        email.sendOwnerActivationTest({
          merchantId: 'mrc_email',
          ownerUserId: 'usr_email_owner',
          verifiedOwnerEmail: null,
          locale: 'en',
          idempotencyKey: 'live-cloudflare-message-id',
          now: '2026-08-02T09:00:00.000Z'
        })
      ).pipe(Effect.provide(layer))
    )

    expect(evidence.status).toBe('accepted')
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          'X-BeeSolo-Idempotency-Key': 'live-cloudflare-message-id'
        }
      })
    )
    expect(JSON.stringify(evidence)).not.toContain('cloudflare-message-one')
  })

  it('persists provider acceptance and replays it after rebuilding the capability layer', async () => {
    const send = vi.fn(async () => ({
      providerSubmissionId: 'provider-reference-one',
      acceptedAt: now
    }))
    const provider = makeConfiguredTransactionalEmailProvider({
      sender: 'booking@beesolo.example',
      callbackSecret: 'callback-secret',
      providerReferenceFingerprintKey: 'provider-reference-key',
      send
    })
    const run = <A, E>(effect: Effect.Effect<A, E, TransactionalEmail>) =>
      Effect.runPromise(
        effect.pipe(
          Effect.provide(
            makeLiveTransactionalEmailLayer(provider).pipe(
              Layer.provide(layerFromD1(test.d1))
            )
          )
        )
      )
    const command = {
      merchantId: 'mrc_email',
      ownerUserId: 'usr_email_owner',
      verifiedOwnerEmail: 'attacker@example.test',
      locale: 'ro' as const,
      idempotencyKey: 'live-activation-one',
      now
    }
    const first = await run(
      Effect.flatMap(TransactionalEmail, (email) =>
        email.sendOwnerActivationTest(command)
      )
    )
    const replay = await run(
      Effect.flatMap(TransactionalEmail, (email) =>
        email.sendOwnerActivationTest(command)
      )
    )

    expect(first).toEqual(replay)
    expect(first).toMatchObject({
      status: 'accepted',
      maskedDestination: 'o••••@example.test'
    })
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'owner@example.test' })
    )
    expect(JSON.stringify(first)).not.toContain('provider-reference-one')
    expect(
      await run(
        Effect.flatMap(TransactionalEmail, (email) => email.readiness('mrc_email'))
      )
    ).toMatchObject({ state: 'ready', acceptedEvidenceId: first.evidenceId })
  })

  it('records terminal failure without mutating the Merchant', async () => {
    const provider = {
      state: 'configured' as const,
      sender: 'booking@beesolo.example',
      fingerprintDestination: () => Effect.succeed('destination-fingerprint'),
      submit: () =>
        Effect.succeed({ _tag: 'failed' as const, code: 'rejected', retryable: false }),
      verifyCallback: () => Effect.succeed({ _tag: 'ignored' as const })
    }
    await Effect.runPromise(
      Effect.flatMap(TransactionalEmail, (email) =>
        email.sendOwnerActivationTest({
          merchantId: 'mrc_email_failure',
          ownerUserId: 'usr_email_failure',
          verifiedOwnerEmail: 'owner@example.test',
          locale: 'en',
          idempotencyKey: 'live-activation-failed',
          now
        })
      ).pipe(
        Effect.provide(
          makeLiveTransactionalEmailLayer(provider).pipe(
            Layer.provide(layerFromD1(test.d1))
          )
        )
      )
    )
    const layer = makeLiveTransactionalEmailLayer(provider).pipe(
      Layer.provide(layerFromD1(test.d1))
    )
    const readiness = await Effect.runPromise(
      Effect.flatMap(TransactionalEmail, (email) =>
        email.readiness('mrc_email_failure')
      ).pipe(Effect.provide(layer))
    )
    const merchant = await test.d1
      .prepare('SELECT public_name, status FROM merchants WHERE id = ?')
      .bind('mrc_email_failure')
      .first()
    const evidence = await test.d1
      .prepare(
        'SELECT status, failure_code FROM transactional_email_evidence WHERE idempotency_key = ?'
      )
      .bind('live-activation-failed')
      .first()

    expect(merchant).toEqual({ public_name: 'Failure Shop', status: 'enabled' })
    expect(evidence).toEqual({ status: 'failed', failure_code: 'rejected' })
    expect(readiness).toEqual({
      merchantId: 'mrc_email_failure',
      state: 'failed',
      reason: 'rejected'
    })
  })

  it('claims one provider submission for concurrent requests with the same key', async () => {
    let release!: () => void
    let signalStarted!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve
    })
    const send = vi.fn(async () => {
      signalStarted()
      await blocked
      return { providerSubmissionId: 'provider-concurrent', acceptedAt: now }
    })
    const provider = makeConfiguredTransactionalEmailProvider({
      sender: 'booking@beesolo.example',
      callbackSecret: 'callback-secret',
      providerReferenceFingerprintKey: 'provider-reference-key',
      send
    })
    const layer = makeLiveTransactionalEmailLayer(provider).pipe(
      Layer.provide(layerFromD1(test.d1))
    )
    const command = {
      merchantId: 'mrc_email',
      ownerUserId: 'usr_email_owner',
      verifiedOwnerEmail: null,
      locale: 'en' as const,
      idempotencyKey: 'live-activation-concurrent',
      now
    }
    const invoke = () =>
      Effect.runPromise(
        Effect.flatMap(TransactionalEmail, (email) =>
          email.sendOwnerActivationTest(command)
        ).pipe(Effect.provide(layer))
      )
    const first = invoke()
    await started
    const second = await invoke()
    release()
    const evidence = [await first, second]

    expect(send).toHaveBeenCalledOnce()
    expect(new Set(evidence.map((item) => item.evidenceId)).size).toBe(1)
    expect(evidence.map((item) => item.status)).toEqual(['accepted', 'submitting'])
  })

  it('claims one provider submission when concurrent callers retry a safe failure', async () => {
    let submissions = 0
    let release!: () => void
    let signalStarted!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve
    })
    const provider = {
      state: 'configured' as const,
      sender: 'booking@beesolo.example',
      fingerprintDestination: () => Effect.succeed('destination-fingerprint'),
      submit: () =>
        Effect.promise(async () => {
          submissions += 1
          if (submissions === 1)
            return {
              _tag: 'failed' as const,
              code: 'provider_unavailable',
              retryable: true
            }
          signalStarted()
          await blocked
          return {
            _tag: 'accepted' as const,
            providerReferenceFingerprint:
              'hmac-sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
            acceptedAt: now
          }
        }),
      verifyCallback: () => Effect.succeed({ _tag: 'ignored' as const })
    }
    const layer = makeLiveTransactionalEmailLayer(provider).pipe(
      Layer.provide(layerFromD1(test.d1))
    )
    const command = {
      merchantId: 'mrc_email',
      ownerUserId: 'usr_email_owner',
      verifiedOwnerEmail: null,
      locale: 'en' as const,
      idempotencyKey: ownerActivationTestIdempotencyKey(
        'mrc_email',
        'live-activation-concurrent-retry'
      ),
      now: '2026-08-02T11:00:00.000Z'
    }
    const invoke = () =>
      Effect.runPromise(
        Effect.flatMap(TransactionalEmail, (email) =>
          email.sendOwnerActivationTest(command)
        ).pipe(Effect.provide(layer))
      )
    const recover = () =>
      Effect.runPromise(
        Effect.flatMap(TransactionalEmail, (email) =>
          email.ownerActivationTestAttempt({
            merchantId: command.merchantId,
            now: command.now
          })
        ).pipe(Effect.provide(layer))
      )
    expect(await invoke()).toMatchObject({ status: 'failed', retryable: true })
    expect(await recover()).toMatchObject({
      commandId: 'live-activation-concurrent-retry',
      evidence: { status: 'failed', retryable: true }
    })
    const firstRetry = invoke()
    await started
    expect(await recover()).toMatchObject({
      commandId: 'live-activation-concurrent-retry',
      evidence: { status: 'submitting', retryable: false }
    })
    const secondRetry = invoke()
    release()
    const evidence = await Promise.all([firstRetry, secondRetry])

    expect(submissions).toBe(2)
    expect(new Set(evidence.map((item) => item.evidenceId)).size).toBe(1)
  })

  it('recovers the later command when two attempts share a timestamp', async () => {
    let submissions = 0
    let release!: () => void
    let signalStarted!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve
    })
    const provider = makeConfiguredTransactionalEmailProvider({
      sender: 'booking@beesolo.example',
      callbackSecret: 'callback-secret',
      providerReferenceFingerprintKey: 'provider-reference-key',
      send: async () => {
        submissions += 1
        if (submissions === 2) {
          signalStarted()
          await blocked
        }
        return {
          providerSubmissionId: `provider-same-time-${submissions}`,
          acceptedAt: '2026-08-02T12:00:00.000Z'
        }
      }
    })
    const layer = makeLiveTransactionalEmailLayer(provider).pipe(
      Layer.provide(layerFromD1(test.d1))
    )
    const send = (commandId: string) =>
      Effect.runPromise(
        Effect.flatMap(TransactionalEmail, (email) =>
          email.sendOwnerActivationTest({
            merchantId: 'mrc_email',
            ownerUserId: 'usr_email_owner',
            verifiedOwnerEmail: null,
            locale: 'ro',
            idempotencyKey: ownerActivationTestIdempotencyKey('mrc_email', commandId),
            now: '2026-08-02T12:00:00.000Z'
          })
        ).pipe(Effect.provide(layer))
      )

    expect(await send('same-time-one')).toMatchObject({ status: 'accepted' })
    const second = send('same-time-two')
    await started
    const recovered = await Effect.runPromise(
      Effect.flatMap(TransactionalEmail, (email) =>
        email.ownerActivationTestAttempt({
          merchantId: 'mrc_email',
          now: '2026-08-02T12:00:00.000Z'
        })
      ).pipe(Effect.provide(layer))
    )
    release()
    await second

    expect(recovered).toMatchObject({
      commandId: 'same-time-two',
      evidence: { status: 'submitting', locale: 'ro' }
    })
  })

  it('orders a retry after a newer terminal command in the same millisecond', async () => {
    let submissions = 0
    let release!: () => void
    let signalStarted!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve
    })
    const provider = {
      state: 'configured' as const,
      sender: 'booking@beesolo.example',
      fingerprintDestination: () => Effect.succeed('destination-fingerprint'),
      submit: () =>
        Effect.promise(async () => {
          submissions += 1
          if (submissions === 1)
            return {
              _tag: 'failed' as const,
              code: 'provider_unavailable',
              retryable: true
            }
          if (submissions === 3) {
            signalStarted()
            await blocked
          }
          return {
            _tag: 'accepted' as const,
            providerReferenceFingerprint: `hmac-sha256:${String(submissions).repeat(64)}`,
            acceptedAt: '2026-08-02T13:00:00.000Z'
          }
        }),
      verifyCallback: () => Effect.succeed({ _tag: 'ignored' as const })
    }
    const layer = makeLiveTransactionalEmailLayer(provider).pipe(
      Layer.provide(layerFromD1(test.d1))
    )
    const send = (commandId: string, commandNow: string) =>
      Effect.runPromise(
        Effect.flatMap(TransactionalEmail, (email) =>
          email.sendOwnerActivationTest({
            merchantId: 'mrc_email',
            ownerUserId: 'usr_email_owner',
            verifiedOwnerEmail: null,
            locale: 'en',
            idempotencyKey: ownerActivationTestIdempotencyKey('mrc_email', commandId),
            now: commandNow
          })
        ).pipe(Effect.provide(layer))
      )

    expect(await send('retry-order-old', '2026-08-02T12:59:00.000Z')).toMatchObject({
      status: 'failed',
      retryable: true
    })
    expect(await send('retry-order-new', '2026-08-02T13:00:00.000Z')).toMatchObject({
      status: 'accepted'
    })
    const retry = send('retry-order-old', '2026-08-02T13:00:00.000Z')
    await started
    const recovered = await Effect.runPromise(
      Effect.flatMap(TransactionalEmail, (email) =>
        email.ownerActivationTestAttempt({
          merchantId: 'mrc_email',
          now: '2026-08-02T13:00:00.000Z'
        })
      ).pipe(Effect.provide(layer))
    )
    release()
    await retry

    expect(recovered).toMatchObject({
      commandId: 'retry-order-old',
      evidence: { status: 'submitting' }
    })
  })

  it('expires an interrupted submission without resubmitting it', async () => {
    const provider = {
      state: 'configured' as const,
      sender: 'booking@beesolo.example',
      fingerprintDestination: () => Effect.succeed('destination-fingerprint'),
      submit: () =>
        Effect.fail(
          new CapabilityUnavailable({
            capability: 'transactional-email-provider',
            reason: 'worker_interrupted'
          })
        ),
      verifyCallback: () => Effect.succeed({ _tag: 'ignored' as const })
    }
    const layer = makeLiveTransactionalEmailLayer(provider).pipe(
      Layer.provide(layerFromD1(test.d1))
    )
    const send = Effect.runPromise(
      Effect.flatMap(TransactionalEmail, (email) =>
        email.sendOwnerActivationTest({
          merchantId: 'mrc_email',
          ownerUserId: 'usr_email_owner',
          verifiedOwnerEmail: null,
          locale: 'en',
          idempotencyKey: ownerActivationTestIdempotencyKey(
            'mrc_email',
            'interrupted-submission'
          ),
          now: '2026-08-02T14:00:00.000Z'
        })
      ).pipe(Effect.provide(layer))
    )

    await expect(send).rejects.toMatchObject({
      _tag: 'CapabilityUnavailable',
      reason: 'worker_interrupted'
    })
    const readiness = await Effect.runPromise(
      Effect.flatMap(TransactionalEmail, (email) => email.readiness('mrc_email')).pipe(
        Effect.provide(layer)
      )
    )
    const latest = await Effect.runPromise(
      Effect.flatMap(TransactionalEmail, (email) =>
        email.ownerActivationTestAttempt({
          merchantId: 'mrc_email',
          now: '2026-08-02T14:02:00.000Z'
        })
      ).pipe(Effect.provide(layer))
    )

    expect(readiness).toEqual({
      merchantId: 'mrc_email',
      state: 'failed',
      reason: 'submission_interrupted'
    })
    expect(latest).toMatchObject({
      commandId: 'interrupted-submission',
      evidence: {
        status: 'submission_unknown',
        failureCode: 'submission_interrupted',
        retryable: false
      }
    })
  })

  it('rejects retrying the same key after the verified destination changes', async () => {
    let submissions = 0
    const provider = {
      state: 'configured' as const,
      sender: 'booking@beesolo.example',
      fingerprintDestination: (destination: string) =>
        Effect.succeed(
          destination === 'owner@example.test'
            ? 'hmac-sha256:destination-one'
            : 'hmac-sha256:destination-two'
        ),
      submit: () => {
        submissions += 1
        return Effect.succeed({
          _tag: 'failed' as const,
          code: 'provider_unavailable',
          retryable: true
        })
      },
      verifyCallback: () => Effect.succeed({ _tag: 'ignored' as const })
    }
    const layer = makeLiveTransactionalEmailLayer(provider).pipe(
      Layer.provide(layerFromD1(test.d1))
    )
    const command = {
      merchantId: 'mrc_email',
      ownerUserId: 'usr_email_owner',
      verifiedOwnerEmail: null,
      locale: 'en' as const,
      idempotencyKey: 'live-destination-conflict',
      now
    }
    const invoke = () =>
      Effect.runPromise(
        Effect.flatMap(TransactionalEmail, (email) =>
          email.sendOwnerActivationTest(command)
        ).pipe(Effect.provide(layer))
      )

    expect(await invoke()).toMatchObject({ status: 'failed', retryable: true })
    await test.d1
      .prepare('UPDATE user SET email = ? WHERE id = ?')
      .bind('other@example.test', 'usr_email_owner')
      .run()
    await expect(invoke()).rejects.toMatchObject({
      _tag: 'TransactionalEmailRejected',
      reason: 'idempotency_key_conflict'
    })
    await test.d1
      .prepare('UPDATE user SET email = ? WHERE id = ?')
      .bind('owner@example.test', 'usr_email_owner')
      .run()
    expect(submissions).toBe(1)
  })

  it('replays legacy terminal evidence but refuses an unverifiable legacy retry', async () => {
    await test.d1
      .prepare(
        `INSERT INTO transactional_email_evidence
         (id, merchant_id, owner_user_id, idempotency_key, purpose, locale,
          template_key, masked_destination, sender_identity, status, attempted_at,
          attempt_count, attempt_order, retryable, accepted_at, updated_at)
         VALUES (?, 'mrc_email', 'usr_email_owner', ?, 'owner_activation_test', 'en',
          'owner_activation_test_en_v1', 'o••••@example.test',
          'booking@beesolo.example', ?, ?, 1, -2, ?, ?, ?)`
      )
      .bind('eml_legacy_terminal', 'live-legacy-terminal', 'accepted', now, 0, now, now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO transactional_email_evidence
         (id, merchant_id, owner_user_id, idempotency_key, purpose, locale,
          template_key, masked_destination, sender_identity, status, failure_code,
          attempted_at, attempt_count, attempt_order, retryable, updated_at)
         VALUES (?, 'mrc_email', 'usr_email_owner', ?, 'owner_activation_test', 'en',
          'owner_activation_test_en_v1', 'o••••@example.test',
          'booking@beesolo.example', 'failed', 'provider_unavailable', ?, 1, -1, 1, ?)`
      )
      .bind('eml_legacy_retry', 'live-legacy-retry', now, now)
      .run()
    let submissions = 0
    const provider = {
      state: 'configured' as const,
      sender: 'booking@beesolo.example',
      fingerprintDestination: () => Effect.succeed('hmac-sha256:current-destination'),
      submit: () => {
        submissions += 1
        return Effect.succeed({ _tag: 'captured' as const, capturedAt: now })
      },
      verifyCallback: () => Effect.succeed({ _tag: 'ignored' as const })
    }
    const layer = makeLiveTransactionalEmailLayer(provider).pipe(
      Layer.provide(layerFromD1(test.d1))
    )
    const invoke = (idempotencyKey: string) =>
      Effect.runPromise(
        Effect.flatMap(TransactionalEmail, (email) =>
          email.sendOwnerActivationTest({
            merchantId: 'mrc_email',
            ownerUserId: 'usr_email_owner',
            verifiedOwnerEmail: null,
            locale: 'en',
            idempotencyKey,
            now
          })
        ).pipe(Effect.provide(layer))
      )

    expect(await invoke('live-legacy-terminal')).toMatchObject({
      evidenceId: 'eml_legacy_terminal',
      status: 'accepted'
    })
    await expect(invoke('live-legacy-retry')).rejects.toMatchObject({
      _tag: 'TransactionalEmailRejected',
      reason: 'idempotency_key_conflict'
    })
    expect(submissions).toBe(0)
  })

  it('reconciles an authenticated callback that arrives before acceptance is stored', async () => {
    const provider = makeConfiguredTransactionalEmailProvider({
      sender: 'booking@beesolo.example',
      callbackSecret: 'callback-secret',
      providerReferenceFingerprintKey: 'provider-reference-key',
      send: async () => ({
        providerSubmissionId: 'provider-callback-before-acceptance',
        acceptedAt: now
      })
    })
    const layer = makeLiveTransactionalEmailLayer(provider).pipe(
      Layer.provide(layerFromD1(test.d1))
    )
    const rawBody = JSON.stringify({
      eventId: 'evt_before_acceptance',
      messageId: 'provider-callback-before-acceptance',
      status: 'delivered',
      occurredAt: '2026-08-02T10:01:00.000Z'
    })
    const signature = await provider.signCallbackForTest!(now, rawBody)
    const before = await Effect.runPromise(
      Effect.flatMap(TransactionalEmail, (email) =>
        email.receiveCallback({ rawBody, signature, timestamp: now, now })
      ).pipe(Effect.provide(layer))
    )
    const evidence = await Effect.runPromise(
      Effect.flatMap(TransactionalEmail, (email) =>
        email.sendOwnerActivationTest({
          merchantId: 'mrc_email',
          ownerUserId: 'usr_email_owner',
          verifiedOwnerEmail: null,
          locale: 'en',
          idempotencyKey: 'live-callback-before-acceptance',
          now
        })
      ).pipe(Effect.provide(layer))
    )

    expect(before).toBe('pending')
    expect(evidence).toMatchObject({
      status: 'delivered',
      deliveredAt: '2026-08-02T10:01:00.000Z'
    })
  })

  it('does not let an older callback regress terminal delivery evidence', async () => {
    const provider = makeConfiguredTransactionalEmailProvider({
      sender: 'booking@beesolo.example',
      callbackSecret: 'callback-secret',
      providerReferenceFingerprintKey: 'provider-reference-key',
      send: async () => ({
        providerSubmissionId: 'provider-terminal-order',
        acceptedAt: now
      })
    })
    const layer = makeLiveTransactionalEmailLayer(provider).pipe(
      Layer.provide(layerFromD1(test.d1))
    )
    await Effect.runPromise(
      Effect.flatMap(TransactionalEmail, (email) =>
        email.sendOwnerActivationTest({
          merchantId: 'mrc_email',
          ownerUserId: 'usr_email_owner',
          verifiedOwnerEmail: null,
          locale: 'en',
          idempotencyKey: 'live-terminal-order',
          now
        })
      ).pipe(Effect.provide(layer))
    )
    const callback = async (
      eventId: string,
      status: 'delivered' | 'failed',
      occurredAt: string
    ) => {
      const rawBody = JSON.stringify({
        eventId,
        messageId: 'provider-terminal-order',
        status,
        occurredAt,
        ...(status === 'failed' ? { code: 'hard_bounce' } : {})
      })
      const signature = await provider.signCallbackForTest!(now, rawBody)
      return Effect.runPromise(
        Effect.flatMap(TransactionalEmail, (email) =>
          email.receiveCallback({ rawBody, signature, timestamp: now, now })
        ).pipe(Effect.provide(layer))
      )
    }

    expect(
      await callback('evt_delivered_newer', 'delivered', '2026-08-02T10:02:00.000Z')
    ).toBe('applied')
    expect(
      await callback('evt_delivered_newer', 'delivered', '2026-08-02T10:02:00.000Z')
    ).toBe('duplicate')
    expect(
      await callback('evt_failed_older', 'failed', '2026-08-02T10:01:00.000Z')
    ).toBe('out_of_order')
    const stored = await test.d1
      .prepare(
        `SELECT status, delivered_at, failure_code
         FROM transactional_email_evidence WHERE idempotency_key = ?`
      )
      .bind('live-terminal-order')
      .first()
    expect(stored).toEqual({
      status: 'delivered',
      delivered_at: '2026-08-02T10:02:00.000Z',
      failure_code: null
    })
  })
})
