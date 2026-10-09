import {
  billingDeadLetterQueueName,
  billingQueueName,
  emailEventsQueueName,
  notificationEmailQueueName,
  webhookDeadLetterQueueName,
  webhookQueueName,
  workspaceExportQueueName
} from '@b2b-saas-starter/infra'
import { Effect } from 'effect'
import { beforeAll, expect, it } from 'vite-plus/test'

import { applyPoolMigrations, consume, rows } from './test-pool.ts'

// oxlint-disable-next-line effect/noTestLifecycleHooks -- real worker D1 schema
beforeAll(() => applyPoolMigrations())

it.each([
  webhookQueueName,
  webhookDeadLetterQueueName,
  billingQueueName,
  billingDeadLetterQueueName,
  workspaceExportQueueName,
  notificationEmailQueueName,
  emailEventsQueueName
])('acks malformed bodies on %s without persistent side effects', (queue) =>
  // oxlint-disable-next-line starter/no-run-promise-in-tests -- worker queue/D1 promise boundary
  Effect.runPromise(
    Effect.gen(function* () {
      const bodies = [
        null,
        'not an object',
        { workspaceId: 'untrusted', traceparent: 'invalid' }
      ]
      const result = yield* Effect.promise(() =>
        consume(
          queue,
          bodies.map((body, index) => ({
            id: `malformed-${index}`,
            // oxlint-disable-next-line effect/noGlobals -- platform envelope timestamp
            timestamp: new Date(1000),
            attempts: 1,
            body
          }))
        )
      )
      expect(result.ackAll).toBe(false)
      expect(result.retryBatch.retry).toBe(false)
      expect(result.explicitAcks.toSorted()).toEqual([
        'malformed-0',
        'malformed-1',
        'malformed-2'
      ])
      expect(result.retryMessages).toEqual([])
      for (const table of [
        'webhook_deliveries',
        'webhook_delivery_attempts',
        'workspace_exports',
        'billing_provider_events',
        'email_deliveries',
        'audit_events',
        'notifications'
      ]) {
        expect(yield* Effect.promise(() => rows(`select * from ${table}`))).toEqual([])
      }
    })
  )
)
