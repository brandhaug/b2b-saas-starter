import { Database } from '@b2b-saas-starter/db/service'
import {
  webhookDeliveries,
  webhookDeliveryAttempts,
  webhookEndpoints
} from '@b2b-saas-starter/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { DateTime, Effect } from 'effect'

import { AuditEventLog } from '../governance/audit-event-log.ts'
import { auditedMutations } from '../governance/audited-mutation.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '@b2b-saas-starter/failure/capability'
import { type WebhookQueueMessage } from './webhook-publisher.ts'

const unavailable = orUnavailable('webhook-publisher')

/** Queue confirmation failure settles untouched reservations without blaming the receiver. */
export const makeLiveWebhookEnqueueFailure = Effect.gen(function* () {
  const db = yield* Database
  const audit = yield* AuditEventLog
  const auditedMutation = yield* auditedMutations({
    prepareAuditRecord: audit.prepareRecord,
    unavailable
  })

  return Effect.fn('WebhookPublisher.recordEnqueueFailure')(function* (
    messages: ReadonlyArray<{ readonly body: WebhookQueueMessage }>
  ) {
    const attemptedAt = DateTime.formatIso(yield* DateTime.now)
    for (const { body } of messages) {
      const attemptId = yield* newCapabilityId('wha')
      const identity = and(
        eq(webhookDeliveries.id, body.deliveryId),
        eq(webhookDeliveries.endpointId, body.endpointId),
        sql`exists (select 1 from ${webhookEndpoints} where ${webhookEndpoints.id} = ${body.endpointId} and ${webhookEndpoints.workspaceId} = ${body.workspaceId})`
      )
      const accepted = and(identity, eq(webhookDeliveries.lastAttemptToken, attemptId))
      const acceptedExists = sql`exists (select 1 from ${webhookDeliveries} where ${accepted})`
      yield* auditedMutation({
        matched: Effect.succeed(true),
        write: () =>
          db
            .update(webhookDeliveries)
            .set({
              status: 'failed_permanent',
              lastAttemptAt: attemptedAt,
              nextAttemptAt: null,
              lastAttemptToken: attemptId
            })
            .where(
              and(
                identity,
                eq(webhookDeliveries.status, 'pending'),
                eq(webhookDeliveries.attempts, 0),
                isNull(webhookDeliveries.lastAttemptToken)
              )
            ),
        transition: {
          condition: acceptedExists,
          alongside: [
            db.insert(webhookDeliveryAttempts).select(
              db
                .select({
                  id: sql<string>`${attemptId}`.as('id'),
                  deliveryId: webhookDeliveries.id,
                  attempts: sql<number>`0`.as('attempts'),
                  phase: sql`'terminal'`.as('phase'),
                  status: sql`'failed_permanent'`.as('status'),
                  attemptedAt: sql<string>`${attemptedAt}`.as('attemptedAt'),
                  durationMs: sql<number | null>`null`.as('durationMs'),
                  failureReason:
                    sql<string>`'Queue enqueue confirmation failed; acceptance is unknown'`.as(
                      'failureReason'
                    ),
                  responseStatus: sql<number | null>`null`.as('responseStatus'),
                  requestHeaders: sql`null`.as('requestHeaders'),
                  responseBody: sql<string | null>`null`.as('responseBody')
                })
                .from(webhookDeliveries)
                .where(accepted)
            )
          ]
        },
        auditEvent: {
          workspaceId: body.workspaceId,
          actorType: 'system',
          eventType: 'webhook.delivery_failed',
          targetType: 'webhook_endpoint',
          targetId: body.endpointId,
          metadata: {
            deliveryId: body.deliveryId,
            eventType: body.eventType,
            reason: 'enqueue_confirmation_failed',
            acceptance: 'unknown',
            queueAttempts: 0
          }
        }
      })
    }
  })
})
