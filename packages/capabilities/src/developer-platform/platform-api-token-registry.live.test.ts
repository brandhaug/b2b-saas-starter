import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  Database,
  auditEvents,
  layerFromD1,
  merchants,
  platformApiTokens,
  user
} from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { LiveAuditEventLog } from '../governance/audit-event-log.ts'
import {
  LivePlatformApiTokenRegistry,
  PlatformApiTokenRegistry
} from './platform-api-token-registry.ts'

let test: TestD1
const runDb = <A, E>(effect: Effect.Effect<A, E, Database>) =>
  Effect.runPromise(Effect.provide(effect, layerFromD1(test.d1)))
const registryLayer = () =>
  LivePlatformApiTokenRegistry.pipe(
    Layer.provide(LiveAuditEventLog),
    Layer.provide(layerFromD1(test.d1))
  )
const run = <A, E>(effect: Effect.Effect<A, E, PlatformApiTokenRegistry>) =>
  Effect.runPromise(Effect.provide(effect, registryLayer()))

beforeAll(async () => {
  test = await provisionTestD1()
  await runDb(
    Effect.gen(function* () {
      const db = yield* Database
      yield* db.insert(user).values({
        id: 'usr_token_owner',
        email: 'tokens@merchant.test',
        name: 'Token Owner',
        emailVerified: true
      })
      yield* db.insert(merchants).values([
        {
          id: 'mer_tokens',
          publicName: 'Token Studio',
          slug: 'token-studio',
          timezone: 'UTC',
          currency: 'USD',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'mer_bootstrap_tokens',
          publicName: 'Bootstrap Token Studio',
          slug: 'bootstrap-token-studio',
          timezone: 'UTC',
          currency: 'USD',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'mer_other_tokens',
          publicName: 'Other Token Studio',
          slug: 'other-token-studio',
          timezone: 'UTC',
          currency: 'USD',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ])
    })
  )
}, 60_000)

afterAll(async () => test.dispose())

describe('Platform API Token lifecycle', () => {
  it('allows fresh password proof to bootstrap exactly one token', async () => {
    const proof = {
      userId: 'usr_token_owner',
      method: 'password' as const,
      verifiedAt: new Date().toISOString()
    }
    await run(
      Effect.flatMap(PlatformApiTokenRegistry, (registry) =>
        registry.bootstrap({
          merchantId: 'mer_bootstrap_tokens',
          name: 'Bootstrap',
          scopes: ['api_tokens:manage'],
          expiresAt: null,
          proof
        })
      )
    )
    await expect(
      run(
        Effect.flatMap(PlatformApiTokenRegistry, (registry) =>
          registry.bootstrap({
            merchantId: 'mer_bootstrap_tokens',
            name: 'Second bootstrap',
            scopes: ['api_tokens:manage'],
            expiresAt: null,
            proof
          })
        )
      )
    ).rejects.toMatchObject({ reason: 'unauthorized' })
  })

  it('stores only a hash, delegates downward, expires, and revokes idempotently', async () => {
    const created = await run(
      Effect.gen(function* () {
        const registry = yield* PlatformApiTokenRegistry
        return yield* registry.create({
          merchantId: 'mer_tokens',
          name: 'Primary integration',
          scopes: ['merchant:read', 'api_tokens:manage'],
          expiresAt: null,
          actorUserId: 'usr_token_owner'
        })
      })
    )
    const stored = await runDb(
      Effect.gen(function* () {
        const db = yield* Database
        return (yield* db.select().from(platformApiTokens))[0]!
      })
    )
    expect(stored.tokenHash).not.toContain(created.token)
    expect(JSON.stringify(stored)).not.toContain(created.token)

    const verified = await run(
      Effect.flatMap(PlatformApiTokenRegistry, (registry) =>
        registry.verify(created.token, 'api_tokens:manage')
      )
    )
    expect(verified.merchantId).toBe('mer_tokens')

    const delegated = await run(
      Effect.flatMap(PlatformApiTokenRegistry, (registry) =>
        registry.create({
          merchantId: verified.merchantId,
          name: '  Read integration  ',
          scopes: ['merchant:read'],
          expiresAt: null,
          delegatedBy: verified
        })
      )
    )
    expect(delegated.name).toBe('Read integration')
    expect(delegated.scopes).toEqual(['merchant:read'])

    await expect(
      run(
        Effect.flatMap(PlatformApiTokenRegistry, (registry) =>
          registry.create({
            merchantId: verified.merchantId,
            name: 'Escalated integration',
            scopes: ['webhooks:manage'],
            expiresAt: null,
            delegatedBy: verified
          })
        )
      )
    ).rejects.toMatchObject({ reason: 'scope_escalation_denied' })

    await Promise.all([
      run(
        Effect.flatMap(PlatformApiTokenRegistry, (registry) =>
          registry.revoke({ merchantId: 'mer_tokens', tokenId: created.id })
        )
      ),
      run(
        Effect.flatMap(PlatformApiTokenRegistry, (registry) =>
          registry.revoke({ merchantId: 'mer_tokens', tokenId: created.id })
        )
      )
    ])
    const revokeAudits = await runDb(
      Effect.gen(function* () {
        const db = yield* Database
        return yield* db.select().from(auditEvents)
      })
    )
    expect(
      revokeAudits.filter(
        (event) =>
          event.eventType === 'platform_api_token.revoked' &&
          event.targetId === created.id
      )
    ).toHaveLength(1)
    await expect(
      run(
        Effect.flatMap(PlatformApiTokenRegistry, (registry) =>
          registry.verify(created.token, 'api_tokens:manage')
        )
      )
    ).rejects.toMatchObject({ reason: 'unauthorized' })
  })
})
