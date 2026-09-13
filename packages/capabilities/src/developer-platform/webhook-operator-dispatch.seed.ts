import { DateTime, Effect } from 'effect'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { type PendingDispatchPlan } from './webhook-delivery-plan.ts'
import { WebhookDispatchRejected } from './webhook-endpoints.ts'
import { type SeedDeliveryFixture } from './webhook-endpoints.seed.ts'

/** Reserves one operator delivery and records its audit once per stable identity. */
export function seedOperatorDispatch(deliveries: Array<SeedDeliveryFixture>) {
  return Effect.gen(function* () {
    const audit = yield* AuditEventLog
    return Effect.fnUntraced(function* (input: {
      readonly deliveryId: string
      readonly workspaceId: string
      readonly plan: PendingDispatchPlan
      readonly auditEventType?: 'webhook.delivery_replayed' | undefined
    }) {
      const existing = deliveries.find((row) => row.id === input.deliveryId)
      if (existing !== undefined) {
        if (
          existing.workspaceId !== input.workspaceId ||
          existing.endpointId !== input.plan.endpointId ||
          existing.replayedFrom !== input.plan.replayedFrom
        ) {
          return yield* new WebhookDispatchRejected({
            reason: 'replay identity does not match the approved delivery'
          })
        }
        return
      }
      deliveries.push({
        id: input.deliveryId,
        endpointId: input.plan.endpointId,
        workspaceId: input.workspaceId,
        eventType: input.plan.eventType,
        status: input.plan.status,
        attempts: input.plan.attempts,
        lastAttemptAt: DateTime.formatIso(yield* DateTime.now),
        nextAttemptAt: input.plan.nextAttemptAt,
        responseStatus: input.plan.responseStatus,
        payload: input.plan.payload,
        requestHeaders: null,
        responseBody: null,
        replayedFrom: input.plan.replayedFrom
      })
      if (input.auditEventType !== undefined) {
        yield* audit.record({
          workspaceId: input.workspaceId,
          actorUserId: (yield* WorkspaceContext).actor?.userId ?? null,
          actorType: (yield* WorkspaceContext).actorType,
          eventType: input.auditEventType,
          targetType: 'webhook_endpoint',
          targetId: input.plan.endpointId,
          metadata: {
            deliveryId: input.deliveryId,
            replayedFrom: input.plan.replayedFrom,
            eventType: input.plan.eventType
          }
        })
      }
    })
  })
}
