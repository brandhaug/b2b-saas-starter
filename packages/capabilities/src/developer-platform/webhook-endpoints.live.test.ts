import {
  auditEvents,
  webhookDeliveries,
  webhookEndpoints
} from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { Effect } from 'effect'
import { describe, expect, layer } from '@effect/vitest'
import { and, count, eq } from 'drizzle-orm'

import { NotificationFeed } from '../notifications/notification-feed.ts'
import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import {
  developerPlatformContractCases,
  planLimitContractCases
} from './developer-platform.contract.ts'
import { type WebhookDeliveryAttemptInput } from './webhook-delivery-plan.ts'
import { WebhookEndpoints } from './webhook-endpoints.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'live developer platform',
  (it) => {
    // The Seed half of this same list runs in index.test.ts.
    describe('live developer-platform contract', () => {
      for (const contractCase of developerPlatformContractCases(expect)) {
        // Retention exercises more than one cleanup batch against real D1.
        it.effect(
          contractCase.name,
          () =>
            inWorkspace(
              'dev-contract-lab',
              contractCase.assert,
              { userId: 'usr_owner' },
              {
                webhookQueue: {
                  send: () => Promise.resolve(),
                  sendBatch: () => Promise.resolve()
                }
              }
            ),
          30_000
        )
      }
    })

    // Runs against a capped-plan workspace (see the live harness fixture) so the
    // create loop actually reaches the gate. The Seed half runs in index.test.ts.
    describe('live developer-platform plan-limit contract', () => {
      for (const contractCase of planLimitContractCases(expect)) {
        it.effect(contractCase.name, () =>
          inWorkspace('capped-lab', contractCase.assert, { userId: 'usr_owner' })
        )
      }
    })

    // Real-D1 coverage for the terminal-outcome audit contract: LiveWebhookEndpoints
    // batches the audit insert with the delivery row, so these assert the actual
    // audit_events rows rather than a stub's recorded inputs.
    describe('live webhook delivery attempts', () => {
      function recordAttempt(input: WebhookDeliveryAttemptInput) {
        return inWorkspace(
          'live-lab',
          Effect.flatMap(WebhookEndpoints, (webhooks) =>
            webhooks.recordDeliveryAttempt(input)
          )
        )
      }

      function auditRowsFor(eventType: string) {
        return Effect.gen(function* () {
          const db = yield* Database
          // Scoped to this suite's workspace: the developer-platform contract
          // dead-letters its own endpoints in a sibling workspace.
          return yield* db
            .select()
            .from(auditEvents)
            .where(
              and(
                eq(auditEvents.eventType, eventType),
                eq(auditEvents.workspaceId, 'wrk_live')
              )
            )
        })
      }

      const auditEventCount = Effect.gen(function* () {
        const db = yield* Database
        const rows = yield* db.select({ total: count() }).from(auditEvents)
        return rows[0]?.total ?? 0
      })

      function deliveryRow(deliveryId: string) {
        return Effect.gen(function* () {
          const db = yield* Database
          return yield* db
            .select()
            .from(webhookDeliveries)
            .where(eq(webhookDeliveries.id, deliveryId))
        })
      }

      it.effect(
        'batches a webhook.delivery_failed audit event with the terminal attempt row',
        () =>
          Effect.gen(function* () {
            yield* recordAttempt({
              id: 'whd_live_perm',
              endpointId: 'wh_live',
              workspaceId: 'wrk_live',
              eventType: 'demo.event',
              status: 'failed_permanent',
              attempts: 1,
              responseStatus: 410,
              nextAttemptAt: null,
              payload: { event: 'demo' }
            })

            const deliveries = yield* deliveryRow('whd_live_perm')
            expect(deliveries).toHaveLength(1)
            expect(deliveries[0]?.status).toBe('failed_permanent')

            const rows = yield* auditRowsFor('webhook.delivery_failed')
            expect(rows).toHaveLength(1)
            expect(rows[0]).toMatchObject({
              workspaceId: 'wrk_live',
              actorUserId: null,
              targetType: 'webhook_endpoint',
              targetId: 'wh_live'
            })
            // The audit metadata points back at the delivery row it committed with.
            expect(rows[0]?.metadata).toMatchObject({
              deliveryId: 'whd_live_perm',
              eventType: 'demo.event',
              responseStatus: 410
            })
          })
      )

      it.effect(
        'batches a webhook.delivery_dead_lettered audit event with the DLQ attempt row',
        () =>
          Effect.gen(function* () {
            yield* recordAttempt({
              endpointId: 'wh_live',
              workspaceId: 'wrk_live',
              eventType: 'demo.event',
              status: 'dead_lettered',
              attempts: 5,
              responseStatus: null,
              nextAttemptAt: null,
              payload: { event: 'demo' }
            })

            const rows = yield* auditRowsFor('webhook.delivery_dead_lettered')
            expect(rows).toHaveLength(1)
            expect(rows[0]).toMatchObject({
              workspaceId: 'wrk_live',
              actorUserId: null,
              targetType: 'webhook_endpoint',
              targetId: 'wh_live'
            })
            expect(rows[0]?.metadata).toMatchObject({ queueAttempts: 5 })
          })
      )

      it.effect('writes a non-terminal delivered row without an audit event', () =>
        Effect.gen(function* () {
          const before = yield* auditEventCount
          yield* recordAttempt({
            id: 'whd_live_ok',
            endpointId: 'wh_live',
            workspaceId: 'wrk_live',
            eventType: 'demo.event',
            status: 'delivered',
            attempts: 1,
            responseStatus: 200,
            nextAttemptAt: null,
            payload: { event: 'demo' }
          })
          const after = yield* auditEventCount
          expect(after).toBe(before)

          const deliveries = yield* deliveryRow('whd_live_ok')
          expect(deliveries[0]?.status).toBe('delivered')
        })
      )

      it.effect(
        'a dead-lettered attempt records a broadcast notification for the workspace',
        () =>
          inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const webhooks = yield* WebhookEndpoints
              const feed = yield* NotificationFeed
              const sent = yield* webhooks.sendTestEvent({ endpointId: 'wh_live' })
              yield* webhooks.recordTerminalDeliveryAttempt({
                deliveryId: sent.deliveryId,
                endpointId: 'wh_live',
                workspaceId: 'wrk_live',
                eventType: 'demo.dead_letter',
                attempts: 5,
                status: 'dead_lettered',
                payload: { event: 'demo.dead_letter' }
              })
              const notifications = yield* feed.list
              const deadLetter = notifications.find(
                (notification) =>
                  notification.title === 'Webhook delivery dead-lettered' &&
                  notification.message.startsWith('webhook.test_event ')
              )
              expect(deadLetter).toBeDefined()
              // The message names the endpoint URL so it is actionable...
              expect(deadLetter?.message).toContain('https://example.com/hook')
              // ...and it is a broadcast row (unread, no target user).
              expect(deadLetter?.read).toBe(false)
            }),
            undefined,
            {
              webhookQueue: {
                send: () => Promise.resolve(),
                sendBatch: () => Promise.resolve()
              }
            }
          )
      )

      it.effect('a redelivered queue message upserts the same delivery row', () =>
        inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const webhooks = yield* WebhookEndpoints
            // First attempt of the message: retryable failure...
            yield* webhooks.recordDeliveryAttempt({
              id: 'whd_live_same_id',
              endpointId: 'wh_live',
              workspaceId: 'wrk_live',
              eventType: 'demo.redelivery',
              status: 'failed',
              attempts: 1,
              responseStatus: 500,
              payload: { event: 'demo.redelivery' }
            })
            // ...the platform redelivers the same message id: the row must
            // resolve, not fork (and not die on the primary key).
            yield* webhooks.recordDeliveryAttempt({
              id: 'whd_live_same_id',
              endpointId: 'wh_live',
              workspaceId: 'wrk_live',
              eventType: 'demo.redelivery',
              status: 'delivered',
              attempts: 2,
              responseStatus: 200,
              payload: { event: 'demo.redelivery' }
            })
          })
        )
          .pipe(Effect.andThen(deliveryRow('whd_live_same_id')))
          .pipe(
            Effect.tap((rows) =>
              Effect.sync(() => {
                expect(rows).toHaveLength(1)
                expect(rows[0]).toMatchObject({
                  status: 'delivered',
                  attempts: 2,
                  responseStatus: 200
                })
              })
            )
          )
      )

      it.effect(
        'a failed attempt climbs the endpoint streak and a delivered attempt resets it',
        () =>
          Effect.gen(function* () {
            const db = yield* Database
            // Reset first so the case is independent of the attempts the
            // sibling cases already recorded against this shared endpoint.
            yield* recordAttempt({
              id: 'whd_live_ladder_reset',
              endpointId: 'wh_live',
              workspaceId: 'wrk_live',
              eventType: 'demo.ladder',
              status: 'delivered',
              attempts: 1,
              responseStatus: 200,
              nextAttemptAt: null,
              payload: { event: 'demo.ladder' }
            })
            const climb = yield* recordAttempt({
              id: 'whd_live_ladder_climb',
              endpointId: 'wh_live',
              workspaceId: 'wrk_live',
              eventType: 'demo.ladder',
              status: 'failed',
              attempts: 1,
              responseStatus: 500,
              nextAttemptAt: null,
              payload: { event: 'demo.ladder' }
            })
            expect(climb.consecutiveFailures).toBe(1)
            const endpointRows = yield* db
              .select()
              .from(webhookEndpoints)
              .where(eq(webhookEndpoints.id, 'wh_live'))
            // The counter column moved in the same batch as the delivery row.
            expect(endpointRows[0]?.consecutiveFailures).toBe(1)
            const reset = yield* recordAttempt({
              id: 'whd_live_ladder_delivered',
              endpointId: 'wh_live',
              workspaceId: 'wrk_live',
              eventType: 'demo.ladder',
              status: 'delivered',
              attempts: 1,
              responseStatus: 200,
              nextAttemptAt: null,
              payload: { event: 'demo.ladder' }
            })
            expect(reset.consecutiveFailures).toBe(0)
            const afterReset = yield* db
              .select()
              .from(webhookEndpoints)
              .where(eq(webhookEndpoints.id, 'wh_live'))
            expect(afterReset[0]?.consecutiveFailures).toBe(0)
          })
      )

      it.effect(
        'rotation keeps the replaced secret signing through the grace window',
        () =>
          inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const webhooks = yield* WebhookEndpoints
              const first = yield* webhooks.rotateSecret({ endpointId: 'wh_live' })
              const firstSecret = first.signingSecret
              const sent = yield* webhooks.sendTestEvent({ endpointId: 'wh_live' })

              // While the grace window is open, a dispatch signs with the new
              // secret AND the one it replaced.
              const during = yield* webhooks.getDispatchTarget(
                'wh_live',
                'wrk_live',
                sent.deliveryId
              )
              expect(during?.signingSecrets).toHaveLength(2)
              expect(during?.signingSecrets[0]).toBe(firstSecret)

              // A second rotation shifts the window: the middle secret becomes
              // the replaced one, and the original is dropped entirely.
              const second = yield* webhooks.rotateSecret({ endpointId: 'wh_live' })
              const secondSecret = second.signingSecret
              const afterSecond = yield* webhooks.getDispatchTarget(
                'wh_live',
                'wrk_live',
                sent.deliveryId
              )
              expect(afterSecond?.signingSecrets).toEqual([secondSecret, firstSecret])
            }),
            undefined,
            {
              webhookQueue: {
                send: () => Promise.resolve(),
                sendBatch: () => Promise.resolve()
              }
            }
          )
      )
    })
  }
)
