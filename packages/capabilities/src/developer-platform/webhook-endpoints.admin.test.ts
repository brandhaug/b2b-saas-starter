import { describe, expect, it, layer } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { Database } from '@b2b-saas-starter/db/service'
import {
  auditEvents,
  webhookDeliveries,
  webhookEndpoints
} from '@b2b-saas-starter/db/schema'
import { TestDatabase, LIVE_SUITE_TIMEOUT } from '../testing/live-harness.ts'
import { SeedLayer, makeLiveCapabilitiesLayer } from '../layers.ts'
import { AuditEventLog, SeedAuditEventLog } from '../governance/audit-event-log.ts'
import { planAdminReplay, WebhookEndpoints } from './webhook-endpoints.ts'
import { failureTag } from '../internal/failure-tag.ts'
import { SeedWebhookEndpoints } from './webhook-endpoints.seed.ts'
import { WebhookPublisher, type WebhookQueueMessage } from './webhook-publisher.ts'
import {
  adminDeliveryFixtures,
  adminWebhookContract
} from './webhook-endpoints.admin.contract.ts'

const endpoints = [
  {
    id: 'wh_admin_a',
    workspaceId: 'wrk_live',
    url: 'https://example.com/a',
    enabled: true,
    events: ['demo.event']
  },
  {
    id: 'wh_admin_b',
    workspaceId: 'wrk_other',
    url: 'https://example.com/b',
    enabled: true,
    events: ['demo.event']
  }
]
const workspaces = [
  { id: 'wrk_live', slug: 'live-lab', name: 'Live Lab', planId: 'team' },
  { id: 'wrk_other', slug: 'other-lab', name: 'Other Lab', planId: 'team' }
]

describe('admin replay payload evidence', () => {
  const source = {
    id: 'whd_payload',
    endpointId: 'wh_admin_a',
    workspaceId: 'wrk_live',
    enabled: true,
    eventType: 'demo.event',
    status: 'dead_lettered',
    payload: undefined
  } satisfies Parameters<typeof planAdminReplay>[0]

  it.effect('refuses absent evidence rather than fabricating a payload', () =>
    Effect.gen(function* () {
      const outcome = yield* Effect.exit(planAdminReplay(source, 'usr_sysadmin'))
      expect(failureTag(outcome)).toBe('WebhookDispatchRejected')
    })
  )

  it.effect('preserves JSON null as a valid payload', () =>
    Effect.gen(function* () {
      const replay = yield* planAdminReplay(
        { ...source, payload: null },
        'usr_sysadmin'
      )
      expect(replay.plan.payload).toBe(null)
    })
  )
})

describe('Seed admin webhooks without WorkspaceContext', () => {
  it.effect('pages globally and replays with an explicit admin actor', () => {
    const messages: Array<
      Omit<WebhookQueueMessage, 'deliveryId'> & {
        readonly deliveryId?: string | undefined
      }
    > = []
    const publisher = Layer.succeed(WebhookPublisher)({
      publish: () => Effect.void,
      enqueue: (input) =>
        Effect.sync(() => {
          messages.push(input)
        })
    })
    const audit = SeedAuditEventLog([], [{ id: 'usr_sysadmin', name: 'Sys Admin' }])
    const seed = SeedWebhookEndpoints(
      endpoints,
      adminDeliveryFixtures,
      workspaces
    ).pipe(Layer.provideMerge(Layer.mergeAll(SeedLayer, publisher, audit)))
    return Effect.gen(function* () {
      const replay = yield* adminWebhookContract(expect)
      const log = yield* AuditEventLog
      expect(
        (yield* log.listGlobal).find(
          (row) => row.eventType === 'webhook.delivery_replayed'
        )
      ).toMatchObject({ actor: 'Sys Admin' })
      expect(messages).toEqual([
        {
          deliveryId: replay.deliveryId,
          workspaceId: 'wrk_live',
          endpointId: 'wh_admin_a',
          eventType: 'demo.event',
          payload: { nested: { original: ['verbatim', 42] } }
        }
      ])
    }).pipe(Effect.provide(seed))
  })
})

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'Live admin webhooks without WorkspaceContext',
  // oxlint-disable-next-line no-shadow -- the Effect layer supplies its own fixture-bound test API
  (it) => {
    it.effect(
      'pages globally, preserves replay evidence, and attributes the audit to a nonmember admin',
      () =>
        Effect.gen(function* () {
          const db = yield* Database
          for (const endpoint of endpoints) {
            yield* db.insert(webhookEndpoints).values({
              ...endpoint,
              signingSecret: 'whsec_admin_test',
              createdAt: '2026-09-01T00:00:00.000Z'
            })
          }
          yield* db.insert(webhookDeliveries).values(adminDeliveryFixtures)
          const messages: Array<WebhookQueueMessage> = []
          const replay = yield* adminWebhookContract(expect).pipe(
            Effect.provide(
              makeLiveCapabilitiesLayer({
                webhookQueue: {
                  send: (message) => {
                    messages.push(message)
                    return Promise.resolve()
                  },
                  sendBatch: () => Promise.resolve()
                }
              })
            )
          )
          expect(messages).toHaveLength(1)
          expect(messages).toMatchObject([
            {
              deliveryId: replay.deliveryId,
              workspaceId: 'wrk_live',
              endpointId: 'wh_admin_a',
              eventType: 'demo.event',
              payload: { nested: { original: ['verbatim', 42] } }
            }
          ])
          const copies = yield* db
            .select()
            .from(webhookDeliveries)
            .where(eq(webhookDeliveries.id, replay.deliveryId))
          expect(copies[0]).toMatchObject({
            status: 'pending',
            attempts: 0,
            replayedFrom: 'whd_admin_z',
            payload: { nested: { original: ['verbatim', 42] } },
            requestHeaders: null,
            responseBody: null
          })
          const audits = yield* db
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.eventType, 'webhook.delivery_replayed'))
          expect(audits).toHaveLength(1)
          expect(audits[0]).toMatchObject({
            actorUserId: 'usr_sysadmin',
            actorType: 'user',
            workspaceId: 'wrk_live',
            metadata: {
              scope: 'system_admin',
              replayedFrom: 'whd_admin_z',
              deliveryId: replay.deliveryId
            }
          })
          // Deleting an endpoint cascades its history. A stale admin page must
          // refuse replay, not create another copy or enqueue to the gone target.
          yield* db
            .delete(webhookEndpoints)
            .where(eq(webhookEndpoints.id, 'wh_admin_a'))
          const gone = yield* Effect.exit(
            Effect.flatMap(WebhookEndpoints, (webhooks) =>
              webhooks.replayDeliveryAsAdmin({
                deliveryId: 'whd_admin_z',
                actorUserId: 'usr_sysadmin'
              })
            ).pipe(Effect.provide(makeLiveCapabilitiesLayer()))
          )
          expect(failureTag(gone)).toBe('WebhookDispatchRejected')
          const after = yield* db
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.eventType, 'webhook.delivery_replayed'))
          expect(after).toHaveLength(1)
        })
    )

    it.effect('reports queue failure without losing the audited pending copy', () =>
      Effect.gen(function* () {
        const db = yield* Database
        yield* db.insert(webhookEndpoints).values({
          id: 'wh_outage',
          workspaceId: 'wrk_live',
          url: 'https://example.com/outage',
          signingSecret: 'whsec_test',
          enabled: true,
          events: [],
          createdAt: '2026-09-01T00:00:00.000Z'
        })
        yield* db.insert(webhookDeliveries).values({
          id: 'whd_outage',
          endpointId: 'wh_outage',
          eventType: 'demo.event',
          status: 'dead_lettered',
          attempts: 6,
          payload: { outage: true }
        })
        const outcome = yield* Effect.exit(
          Effect.flatMap(WebhookEndpoints, (webhooks) =>
            webhooks.replayDeliveryAsAdmin({
              deliveryId: 'whd_outage',
              actorUserId: 'usr_sysadmin'
            })
          ).pipe(
            Effect.provide(
              makeLiveCapabilitiesLayer({
                webhookQueue: {
                  send: () => Promise.reject(new Error('queue unavailable')),
                  sendBatch: () => Promise.resolve()
                }
              })
            )
          )
        )
        expect(failureTag(outcome)).toBe('CapabilityUnavailable')
        const copies = yield* db
          .select()
          .from(webhookDeliveries)
          .where(eq(webhookDeliveries.replayedFrom, 'whd_outage'))
        expect(copies).toHaveLength(1)
        expect(copies[0]).toMatchObject({
          status: 'pending',
          attempts: 0,
          payload: { outage: true }
        })
        const audits = yield* db
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.targetId, 'wh_outage'))
        expect(audits).toHaveLength(1)
        expect(audits[0]).toMatchObject({
          actorUserId: 'usr_sysadmin',
          actorType: 'user',
          eventType: 'webhook.delivery_replayed'
        })
      })
    )
  }
)
