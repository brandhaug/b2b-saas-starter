import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  auditEvents,
  Database,
  layerFromD1,
  merchants,
  platformWebhookDeliveries,
  user
} from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { LiveAuditEventLog } from '../governance/audit-event-log.ts'
import {
  LivePlatformWebhookEndpoints,
  PlatformWebhookEndpoints
} from './platform-webhook-endpoints.ts'

let test: TestD1
const dbLayer = () => layerFromD1(test.d1)
const layer = () =>
  LivePlatformWebhookEndpoints('webhook-test-cursor-secret').pipe(
    Layer.provide(LiveAuditEventLog),
    Layer.provide(dbLayer())
  )
const run = <A, E>(effect: Effect.Effect<A, E, PlatformWebhookEndpoints>) =>
  Effect.runPromise(Effect.provide(effect, layer()))
const runDb = <A, E>(effect: Effect.Effect<A, E, Database>) =>
  Effect.runPromise(Effect.provide(effect, dbLayer()))

beforeAll(async () => {
  test = await provisionTestD1()
  await runDb(
    Effect.gen(function* () {
      const db = yield* Database
      yield* db.insert(user).values({
        id: 'usr_webhook_owner',
        email: 'webhooks@merchant.test',
        name: 'Webhook Owner',
        emailVerified: true
      })
      yield* db.insert(merchants).values([
        {
          id: 'mer_webhooks_a',
          publicName: 'Webhook A',
          slug: 'webhook-a',
          timezone: 'UTC',
          currency: 'USD',
          createdAt: '2026-07-11T00:00:00.000Z',
          updatedAt: '2026-07-11T00:00:00.000Z'
        },
        {
          id: 'mer_webhooks_b',
          publicName: 'Webhook B',
          slug: 'webhook-b',
          timezone: 'UTC',
          currency: 'USD',
          createdAt: '2026-07-11T00:00:00.000Z',
          updatedAt: '2026-07-11T00:00:00.000Z'
        }
      ])
    })
  )
}, 60_000)

afterAll(async () => test.dispose())

describe('Platform Webhook Endpoints live D1', () => {
  it('scopes lifecycle, discloses secrets once, and audits sanitized events', async () => {
    const created = await run(
      Effect.flatMap(PlatformWebhookEndpoints, (webhooks) =>
        webhooks.create({
          merchantId: 'mer_webhooks_a',
          url: 'https://hooks.example.com/appointments',
          eventTypes: ['appointment.created'],
          actorTokenId: 'pat_webhook_test'
        })
      )
    )
    expect(created.signingSecret).toMatch(/^whsec_/)
    expect(JSON.stringify(created.data)).not.toContain(created.signingSecret)

    await expect(
      run(
        Effect.flatMap(PlatformWebhookEndpoints, (webhooks) =>
          webhooks.rotateSecret({
            merchantId: 'mer_webhooks_b',
            endpointId: created.data.id
          })
        )
      )
    ).rejects.toMatchObject({ _tag: 'PlatformWebhookNotFound' })
    await expect(
      run(
        Effect.flatMap(PlatformWebhookEndpoints, (webhooks) =>
          webhooks.disable({
            merchantId: 'mer_webhooks_b',
            endpointId: created.data.id
          })
        )
      )
    ).rejects.toMatchObject({ _tag: 'PlatformWebhookNotFound' })

    const rotated = await run(
      Effect.flatMap(PlatformWebhookEndpoints, (webhooks) =>
        webhooks.rotateSecretFromMerchantSettings({
          merchantId: 'mer_webhooks_a',
          endpointId: created.data.id,
          proof: {
            userId: 'usr_webhook_owner',
            method: 'password',
            verifiedAt: new Date().toISOString()
          }
        })
      )
    )
    expect(rotated.signingSecret).not.toBe(created.signingSecret)
    await expect(
      run(
        Effect.flatMap(PlatformWebhookEndpoints, (webhooks) =>
          webhooks.rotateSecretFromMerchantSettings({
            merchantId: 'mer_webhooks_a',
            endpointId: created.data.id,
            proof: {
              userId: 'usr_webhook_owner',
              method: 'password',
              verifiedAt: new Date(Date.now() - 15 * 60_000 - 1).toISOString()
            }
          })
        )
      )
    ).rejects.toMatchObject({ reason: 'reauthentication_required' })

    await run(
      Effect.flatMap(PlatformWebhookEndpoints, (webhooks) =>
        webhooks.disable({
          merchantId: 'mer_webhooks_a',
          endpointId: created.data.id
        })
      )
    )
    await run(
      Effect.flatMap(PlatformWebhookEndpoints, (webhooks) =>
        webhooks.disable({
          merchantId: 'mer_webhooks_a',
          endpointId: created.data.id
        })
      )
    )
    await expect(
      run(
        Effect.flatMap(PlatformWebhookEndpoints, (webhooks) =>
          webhooks.rotateSecret({
            merchantId: 'mer_webhooks_a',
            endpointId: created.data.id
          })
        )
      )
    ).rejects.toMatchObject({ _tag: 'PlatformWebhookDisabled' })

    const audits = await runDb(
      Effect.flatMap(Database, (db) => db.select().from(auditEvents))
    )
    expect(audits.map((event) => event.eventType)).toEqual([
      'webhook_endpoint.created',
      'webhook_endpoint.secret_rotated',
      'webhook_endpoint.disabled'
    ])
    expect(JSON.stringify(audits)).not.toContain('whsec_')
  })

  it('uses signed filter-bound cursors and exposes safe ordered delivery history', async () => {
    const created = []
    for (const suffix of ['one', 'two', 'three']) {
      created.push(
        await run(
          Effect.flatMap(PlatformWebhookEndpoints, (webhooks) =>
            webhooks.create({
              merchantId: 'mer_webhooks_a',
              url: `https://${suffix}.example.com/hook`,
              eventTypes: ['appointment.created']
            })
          )
        )
      )
    }
    const first = await run(
      Effect.flatMap(PlatformWebhookEndpoints, (webhooks) =>
        webhooks.list({ merchantId: 'mer_webhooks_a', limit: 1 })
      )
    )
    expect(first.page.nextCursor).toContain('.')
    await expect(
      run(
        Effect.flatMap(PlatformWebhookEndpoints, (webhooks) =>
          webhooks.list({
            merchantId: 'mer_webhooks_a',
            statuses: ['active'],
            cursor: first.page.nextCursor!
          })
        )
      )
    ).rejects.toMatchObject({ _tag: 'PlatformWebhookInvalidCursor' })
    await expect(
      run(
        Effect.flatMap(PlatformWebhookEndpoints, (webhooks) =>
          webhooks.list({
            merchantId: 'mer_webhooks_a',
            cursor: `${first.page.nextCursor}tampered`
          })
        )
      )
    ).rejects.toMatchObject({ _tag: 'PlatformWebhookInvalidCursor' })

    const endpointId = created[0]!.data.id
    await runDb(
      Effect.flatMap(Database, (db) =>
        db.insert(platformWebhookDeliveries).values([
          {
            id: 'wha_old',
            endpointId,
            eventId: 'evt_old',
            eventType: 'appointment.created',
            status: 'failed_retryable',
            failureCode: 'timeout',
            attemptNumber: 1,
            responseStatus: null,
            durationMs: 10_000,
            attemptedAt: '2026-07-11T01:00:00.000Z',
            nextAttemptAt: '2026-07-11T01:01:00.000Z'
          },
          {
            id: 'wha_new',
            endpointId,
            eventId: 'evt_new',
            eventType: 'appointment.updated',
            status: 'delivered',
            failureCode: null,
            attemptNumber: 1,
            responseStatus: 204,
            durationMs: 25,
            attemptedAt: '2026-07-11T02:00:00.000Z',
            nextAttemptAt: null
          }
        ])
      )
    )
    const history = await run(
      Effect.flatMap(PlatformWebhookEndpoints, (webhooks) =>
        webhooks.deliveries({
          merchantId: 'mer_webhooks_a',
          endpointId,
          eventIds: ['evt_old'],
          attemptedAtFrom: '2026-07-11T01:00:00.000Z'
        })
      )
    )
    expect(history.data).toEqual([
      {
        id: 'wha_old',
        eventId: 'evt_old',
        eventType: 'appointment.created',
        status: 'failed_retryable',
        failureCode: 'timeout',
        attemptNumber: 1,
        responseStatus: null,
        durationMs: 10_000,
        attemptedAt: '2026-07-11T01:00:00.000Z',
        nextAttemptAt: '2026-07-11T01:01:00.000Z'
      }
    ])
    expect(JSON.stringify(history)).not.toMatch(/body|customer|secret|exception/i)
  })
})
