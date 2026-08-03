import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  TransactionalEmail,
  makeConfiguredTransactionalEmailProvider,
  makeSeedTransactionalEmailLayer,
  selectTransactionalEmailProvider
} from './transactional-email.ts'

const now = '2026-08-02T10:00:00.000Z'

const run = <A, E>(
  effect: Effect.Effect<A, E, TransactionalEmail>,
  layer = makeSeedTransactionalEmailLayer({ runtime: 'test' })
) => Effect.runPromise(effect.pipe(Effect.provide(layer)))

describe('Transactional Email readiness', () => {
  it.each(['ro', 'en'] as const)(
    'binds the controlled %s activation template',
    async (locale) => {
      const evidence = await run(
        Effect.flatMap(TransactionalEmail, (email) =>
          email.sendOwnerActivationTest({
            merchantId: 'mrc_one',
            ownerUserId: 'usr_owner',
            verifiedOwnerEmail: 'owner@example.test',
            locale,
            idempotencyKey: `activation-${locale}`,
            now
          })
        )
      )

      expect(evidence).toMatchObject({
        status: 'captured',
        locale,
        templateKey: `owner_activation_test_${locale}_v1`,
        maskedDestination: 'o••••@example.test'
      })
      expect(JSON.stringify(evidence)).not.toContain('owner@example.test')
    }
  )

  it('records provider acceptance without claiming delivery', async () => {
    const layer = makeSeedTransactionalEmailLayer({
      runtime: 'production',
      provider: {
        state: 'configured',
        sender: 'booking@beesolo.example',
        fingerprintDestination: () => Effect.succeed('destination-fingerprint'),
        submit: () =>
          Effect.succeed({
            _tag: 'accepted' as const,
            providerReferenceFingerprint:
              'hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            acceptedAt: now
          }),
        verifyCallback: () => Effect.succeed({ _tag: 'ignored' as const })
      }
    })
    const evidence = await run(
      Effect.flatMap(TransactionalEmail, (email) =>
        email.sendOwnerActivationTest({
          merchantId: 'mrc_one',
          ownerUserId: 'usr_owner',
          verifiedOwnerEmail: 'owner@example.test',
          locale: 'en',
          idempotencyKey: 'activation-live',
          now
        })
      ),
      layer
    )

    expect(evidence.status).toBe('accepted')
    expect(evidence).not.toHaveProperty('providerSubmissionId')
    expect(
      await run(
        Effect.flatMap(TransactionalEmail, (email) => email.readiness('mrc_one')),
        layer
      )
    ).toMatchObject({
      state: 'ready',
      acceptedEvidenceId: evidence.evidenceId
    })
  })

  it('fails closed in production but captures explicitly in local development', async () => {
    const production = selectTransactionalEmailProvider({ runtime: 'production' })
    const local = selectTransactionalEmailProvider({ runtime: 'local' })

    expect(production.state).toBe('needs_configuration')
    expect(local.state).toBe('capture')
  })

  it('contains raw provider references inside the configured adapter', async () => {
    const provider = makeConfiguredTransactionalEmailProvider({
      sender: 'booking@beesolo.example',
      callbackSecret: 'callback-secret',
      providerReferenceFingerprintKey: 'provider-reference-key',
      send: async () => ({
        providerSubmissionId: 'raw-provider-secret',
        acceptedAt: now
      })
    })
    const result = await Effect.runPromise(
      provider.submit({
        idempotencyKey: 'provider-boundary',
        from: 'booking@beesolo.example',
        to: 'owner@example.test',
        subject: 'Subject',
        text: 'Body',
        locale: 'en',
        templateKey: 'test'
      })
    )

    expect(result).toMatchObject({
      _tag: 'accepted',
      providerReferenceFingerprint: expect.stringMatching(/^hmac-sha256:[a-f0-9]{64}$/)
    })
    expect(JSON.stringify(result)).not.toContain('raw-provider-secret')
  })

  it('does not blind-retry a timed-out submission and replays the same evidence', async () => {
    let submissions = 0
    const layer = makeSeedTransactionalEmailLayer({
      runtime: 'production',
      provider: makeConfiguredTransactionalEmailProvider({
        sender: 'booking@beesolo.example',
        callbackSecret: 'callback-secret',
        providerReferenceFingerprintKey: 'provider-reference-key',
        timeoutMs: 1,
        send: async () => {
          submissions += 1
          await new Promise((resolve) => setTimeout(resolve, 10))
          return { providerSubmissionId: 'late-reference', acceptedAt: now }
        }
      })
    })
    const command = {
      merchantId: 'mrc_one',
      ownerUserId: 'usr_owner',
      verifiedOwnerEmail: 'owner@example.test',
      locale: 'ro' as const,
      idempotencyKey: 'activation-timeout',
      now
    }
    const first = await run(
      Effect.flatMap(TransactionalEmail, (email) =>
        email.sendOwnerActivationTest(command)
      ),
      layer
    )
    const replay = await run(
      Effect.flatMap(TransactionalEmail, (email) =>
        email.sendOwnerActivationTest(command)
      ),
      layer
    )

    expect(first.status).toBe('submission_unknown')
    expect(replay).toEqual(first)
    expect(submissions).toBe(1)
    expect(
      await run(
        Effect.flatMap(TransactionalEmail, (email) => email.readiness('mrc_one')),
        layer
      )
    ).toMatchObject({ state: 'failed', reason: 'provider_timeout' })
  })

  it('retries only an explicitly safe transient failure with the stable key', async () => {
    let submissions = 0
    const layer = makeSeedTransactionalEmailLayer({
      runtime: 'production',
      provider: {
        state: 'configured',
        sender: 'booking@beesolo.example',
        fingerprintDestination: () => Effect.succeed('destination-fingerprint'),
        submit: () => {
          submissions += 1
          return Effect.succeed(
            submissions === 1
              ? {
                  _tag: 'failed' as const,
                  code: 'provider_unavailable',
                  retryable: true
                }
              : {
                  _tag: 'accepted' as const,
                  providerReferenceFingerprint:
                    'hmac-sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                  acceptedAt: now
                }
          )
        },
        verifyCallback: () => Effect.succeed({ _tag: 'ignored' as const })
      }
    })
    const command = {
      merchantId: 'mrc_one',
      ownerUserId: 'usr_owner',
      verifiedOwnerEmail: 'owner@example.test',
      locale: 'en' as const,
      idempotencyKey: 'activation-safe-retry',
      now
    }
    const send = () =>
      run(
        Effect.flatMap(TransactionalEmail, (email) =>
          email.sendOwnerActivationTest(command)
        ),
        layer
      )

    expect(await send()).toMatchObject({
      status: 'failed',
      retryable: true,
      attemptCount: 1
    })
    expect(
      await run(
        Effect.flatMap(TransactionalEmail, (email) =>
          email.recoverableOwnerActivationTest(command.merchantId)
        ),
        layer
      )
    ).toMatchObject({
      idempotencyKey: command.idempotencyKey,
      evidence: { status: 'failed', retryable: true }
    })
    expect(await send()).toMatchObject({
      status: 'accepted',
      retryable: false,
      attemptCount: 2
    })
    expect(submissions).toBe(2)
  })

  it('rejects changed command payload under an existing idempotency key', async () => {
    const layer = makeSeedTransactionalEmailLayer({ runtime: 'test' })
    const send = (locale: 'ro' | 'en') =>
      run(
        Effect.flatMap(TransactionalEmail, (email) =>
          email.sendOwnerActivationTest({
            merchantId: 'mrc_one',
            ownerUserId: 'usr_owner',
            verifiedOwnerEmail: 'owner@example.test',
            locale,
            idempotencyKey: 'activation-payload-conflict',
            now
          })
        ),
        layer
      )

    await send('en')
    await expect(send('ro')).rejects.toMatchObject({
      _tag: 'TransactionalEmailRejected',
      reason: 'idempotency_key_conflict'
    })
  })

  it('verifies callback signatures and ignores duplicate callback events', async () => {
    const provider = makeConfiguredTransactionalEmailProvider({
      sender: 'booking@beesolo.example',
      callbackSecret: 'callback-secret',
      providerReferenceFingerprintKey: 'provider-reference-key',
      send: async () => ({ providerSubmissionId: 'submission-one', acceptedAt: now })
    })
    const layer = makeSeedTransactionalEmailLayer({ runtime: 'production', provider })
    await run(
      Effect.flatMap(TransactionalEmail, (email) =>
        email.sendOwnerActivationTest({
          merchantId: 'mrc_one',
          ownerUserId: 'usr_owner',
          verifiedOwnerEmail: 'owner@example.test',
          locale: 'en',
          idempotencyKey: 'activation-callback',
          now
        })
      ),
      layer
    )
    const rawBody = JSON.stringify({
      eventId: 'evt_one',
      messageId: 'submission-one',
      status: 'delivered',
      occurredAt: now
    })
    const signature = await provider.signCallbackForTest!(now, rawBody)
    const callback = (signatureValue: string) =>
      run(
        Effect.flatMap(TransactionalEmail, (email) =>
          email.receiveCallback({
            rawBody,
            signature: signatureValue,
            timestamp: now,
            now
          })
        ),
        layer
      )

    await expect(callback('invalid')).rejects.toMatchObject({
      _tag: 'TransactionalEmailCallbackRejected',
      code: 'invalid_signature'
    })
    expect(await callback(signature)).toBe('applied')
    expect(await callback(signature)).toBe('duplicate')
  })

  it('keeps failed readiness when a failure callback precedes acceptance', async () => {
    const provider = makeConfiguredTransactionalEmailProvider({
      sender: 'booking@beesolo.example',
      callbackSecret: 'callback-secret',
      providerReferenceFingerprintKey: 'provider-reference-key',
      send: async () => ({
        providerSubmissionId: 'submission-early-failure',
        acceptedAt: now
      })
    })
    const layer = makeSeedTransactionalEmailLayer({ runtime: 'production', provider })
    const rawBody = JSON.stringify({
      eventId: 'evt_early_failure',
      messageId: 'submission-early-failure',
      status: 'failed',
      occurredAt: now,
      code: 'hard_bounce'
    })
    const signature = await provider.signCallbackForTest!(now, rawBody)
    expect(
      await run(
        Effect.flatMap(TransactionalEmail, (email) =>
          email.receiveCallback({ rawBody, signature, timestamp: now, now })
        ),
        layer
      )
    ).toBe('pending')
    const evidence = await run(
      Effect.flatMap(TransactionalEmail, (email) =>
        email.sendOwnerActivationTest({
          merchantId: 'mrc_early_failure',
          ownerUserId: 'usr_owner',
          verifiedOwnerEmail: 'owner@example.test',
          locale: 'en',
          idempotencyKey: 'activation-early-failure',
          now
        })
      ),
      layer
    )

    expect(evidence).toMatchObject({ status: 'failed', failureCode: 'hard_bounce' })
    expect(
      await run(
        Effect.flatMap(TransactionalEmail, (email) =>
          email.readiness('mrc_early_failure')
        ),
        layer
      )
    ).toMatchObject({ state: 'failed', reason: 'hard_bounce' })
  })
})
