import { auditEvents, webhookDeliveries } from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { Effect, Option } from 'effect'
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
        it.effect(contractCase.name, () =>
          inWorkspace('dev-contract-lab', contractCase.assert, {
            userId: 'usr_owner'
          })
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
              nextAttemptAt: null
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
              nextAttemptAt: null
            })

            const rows = yield* auditRowsFor('webhook.delivery_dead_lettered')
            expect(rows).toHaveLength(1)
            expect(rows[0]).toMatchObject({
              workspaceId: 'wrk_live',
              actorUserId: null,
              targetType: 'webhook_endpoint',
              targetId: 'wh_live'
            })
            expect(rows[0]?.metadata).toMatchObject({ attempts: 5 })
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
            nextAttemptAt: null
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
              yield* webhooks.recordTerminalDeliveryAttempt({
                endpointId: 'wh_live',
                workspaceId: 'wrk_live',
                eventType: 'demo.dead_letter',
                attempts: 5,
                status: 'dead_lettered'
              })
              const notifications = yield* feed.list
              const deadLetter = notifications.find(
                (notification) =>
                  notification.title === 'Webhook delivery dead-lettered' &&
                  notification.message.startsWith('demo.dead_letter ')
              )
              expect(deadLetter).toBeDefined()
              // The message names the endpoint URL so it is actionable...
              expect(deadLetter?.message).toContain('https://example.com/hook')
              // ...and it is a broadcast row (unread, no target user).
              expect(deadLetter?.read).toBe(false)
            })
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
              responseStatus: 500
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
              responseStatus: 200
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
        'rotation keeps the replaced secret signing through the grace window',
        () =>
          inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const webhooks = yield* WebhookEndpoints
              const first = yield* webhooks.rotateSecret({ endpointId: 'wh_live' })
              const firstSecret = Option.getOrThrow(first).signingSecret

              // While the grace window is open, a dispatch signs with the new
              // secret AND the one it replaced.
              const during = yield* webhooks.getDispatchTarget('wh_live', 'wrk_live')
              expect(during?.signingSecrets).toHaveLength(2)
              expect(during?.signingSecrets[0]).toBe(firstSecret)

              // A second rotation shifts the window: the middle secret becomes
              // the replaced one, and the original is dropped entirely.
              const second = yield* webhooks.rotateSecret({ endpointId: 'wh_live' })
              const secondSecret = Option.getOrThrow(second).signingSecret
              const afterSecond = yield* webhooks.getDispatchTarget(
                'wh_live',
                'wrk_live'
              )
              expect(afterSecond?.signingSecrets).toEqual([secondSecret, firstSecret])
            })
          )
      )
    })
  }
)
