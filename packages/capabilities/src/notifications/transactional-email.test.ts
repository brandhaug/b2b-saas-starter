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
        submit: () =>
          Effect.succeed({
            _tag: 'accepted' as const,
            providerSubmissionId: 'provider-secret-reference',
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

  it('does not blind-retry a timed-out submission and replays the same evidence', async () => {
    let submissions = 0
    const layer = makeSeedTransactionalEmailLayer({
      runtime: 'production',
      provider: makeConfiguredTransactionalEmailProvider({
        sender: 'booking@beesolo.example',
        callbackSecret: 'callback-secret',
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
  })

  it('retries only an explicitly safe transient failure with the stable key', async () => {
    let submissions = 0
    const layer = makeSeedTransactionalEmailLayer({
      runtime: 'production',
      provider: {
        state: 'configured',
        sender: 'booking@beesolo.example',
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
                  providerSubmissionId: 'submission-after-retry',
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
    expect(await send()).toMatchObject({
      status: 'accepted',
      retryable: false,
      attemptCount: 2
    })
    expect(submissions).toBe(2)
  })

  it('verifies callback signatures and ignores duplicate callback events', async () => {
    const provider = makeConfiguredTransactionalEmailProvider({
      sender: 'booking@beesolo.example',
      callbackSecret: 'callback-secret',
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
      providerSubmissionId: 'submission-one',
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

    expect(await callback('invalid')).toBe('ignored')
    expect(await callback(signature)).toBe('applied')
    expect(await callback(signature)).toBe('duplicate')
  })
})
