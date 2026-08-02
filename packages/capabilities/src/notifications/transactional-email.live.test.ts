import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Effect, Layer } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  TransactionalEmail,
  makeConfiguredTransactionalEmailProvider,
  makeLiveTransactionalEmailLayer
} from './transactional-email.ts'

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
  it('persists provider acceptance and replays it after rebuilding the capability layer', async () => {
    const send = vi.fn(async () => ({
      providerSubmissionId: 'provider-reference-one',
      acceptedAt: now
    }))
    const provider = makeConfiguredTransactionalEmailProvider({
      sender: 'booking@beesolo.example',
      callbackSecret: 'callback-secret',
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
      submit: () =>
        Effect.succeed({ _tag: 'failed' as const, code: 'rejected', retryable: false }),
      verifyCallback: () => Effect.succeed({ _tag: 'ignored' as const })
    }
    await Effect.runPromise(
      Effect.flatMap(TransactionalEmail, (email) =>
        email.sendOwnerActivationTest({
          merchantId: 'mrc_email',
          ownerUserId: 'usr_email_owner',
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
    const merchant = await test.d1
      .prepare('SELECT public_name, status FROM merchants WHERE id = ?')
      .bind('mrc_email')
      .first()
    const evidence = await test.d1
      .prepare(
        'SELECT status, failure_code FROM transactional_email_evidence WHERE idempotency_key = ?'
      )
      .bind('live-activation-failed')
      .first()

    expect(merchant).toEqual({ public_name: 'Email Shop', status: 'enabled' })
    expect(evidence).toEqual({ status: 'failed', failure_code: 'rejected' })
  })
})
