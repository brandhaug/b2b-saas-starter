import { auditEvents, webhookDeliveries } from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { Effect } from 'effect'
import { describe, expect, layer } from '@effect/vitest'
import { and, count, eq } from 'drizzle-orm'

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
    })
  }
)
