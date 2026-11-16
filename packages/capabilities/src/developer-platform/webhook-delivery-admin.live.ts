import { type RawD1, type Database } from '@b2b-saas-starter/db/service'
import {
  webhookDeliveries,
  webhookEndpoints
} from '@b2b-saas-starter/db/schema/developer-platform'
import { workspaces } from '@b2b-saas-starter/db/schema/workspaces'
import { Effect, Layer } from 'effect'
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'

import { type AuditEventLog } from '../governance/audit-event-log.ts'
import { clampPageLimit } from '../internal/keyset-cursor.ts'
import {
  terminalDeliveryStatuses,
  WEBHOOK_FAILURE_AUTO_DISABLE_AT
} from './webhook-delivery-plan.ts'
import { planAdminReplay, WebhookDeliveryAdmin } from './webhook-delivery-admin.ts'
import { deliveryView, cutDeliveryViewPage } from './webhook-delivery-view.ts'
import { deliveryViewQuery } from './webhook-delivery-view.live.ts'
import { WebhookPublisher } from './webhook-publisher.ts'
import { makeLiveWebhookStorage } from './webhook-storage.live.ts'

export const LiveWebhookDeliveryAdmin: Layer.Layer<
  WebhookDeliveryAdmin,
  never,
  Database | RawD1 | AuditEventLog | WebhookPublisher
> = Layer.effect(WebhookDeliveryAdmin)(
  Effect.gen(function* () {
    const publisher = yield* WebhookPublisher
    const { db, unavailable, recordOperatorDispatch } = yield* makeLiveWebhookStorage(
      'webhook-delivery-admin'
    )

    return {
      listGlobalDeliveries: Effect.fn('WebhookDeliveryAdmin.listGlobalDeliveries')(
        function* (input) {
          const limit = clampPageLimit(input?.limit)
          const conditions: Array<SQL> = [
            inArray(webhookDeliveries.status, [...terminalDeliveryStatuses])
          ]
          const view = deliveryView(input)
          const query = deliveryViewQuery(view, input?.cursor)
          conditions.push(...query.conditions)
          const rows = yield* unavailable(
            db
              .select({
                id: webhookDeliveries.id,
                endpointId: webhookDeliveries.endpointId,
                eventType: webhookDeliveries.eventType,
                status: webhookDeliveries.status,
                attempts: webhookDeliveries.attempts,
                lastAttemptAt: webhookDeliveries.lastAttemptAt,
                responseStatus: webhookDeliveries.responseStatus,
                endpointUrl: webhookEndpoints.url,
                endpointEnabled: webhookEndpoints.enabled,
                endpointConsecutiveFailures: webhookEndpoints.consecutiveFailures,
                endpointFailureLimitReached:
                  sql<boolean>`${webhookEndpoints.consecutiveFailures} >= ${WEBHOOK_FAILURE_AUTO_DISABLE_AT}`.mapWith(
                    Boolean
                  ),
                workspace: {
                  id: workspaces.id,
                  slug: workspaces.slug,
                  name: workspaces.name,
                  planId: workspaces.planId
                }
              })
              .from(webhookDeliveries)
              .innerJoin(
                webhookEndpoints,
                eq(webhookEndpoints.id, webhookDeliveries.endpointId)
              )
              .innerJoin(workspaces, eq(workspaces.id, webhookEndpoints.workspaceId))
              .where(and(...conditions))
              .orderBy(...query.order)
              .limit(limit + 1)
          )
          return cutDeliveryViewPage(rows, limit, view)
        }
      ),
      replayDeliveryAsAdmin: Effect.fn('WebhookDeliveryAdmin.replayDeliveryAsAdmin')(
        function* (input) {
          const rows = yield* unavailable(
            db
              .select({
                id: webhookDeliveries.id,
                endpointId: webhookDeliveries.endpointId,
                eventType: webhookDeliveries.eventType,
                status: webhookDeliveries.status,
                payload: webhookDeliveries.payload,
                enabled: webhookEndpoints.enabled,
                workspaceId: webhookEndpoints.workspaceId
              })
              .from(webhookDeliveries)
              .innerJoin(
                webhookEndpoints,
                eq(webhookEndpoints.id, webhookDeliveries.endpointId)
              )
              .where(eq(webhookDeliveries.id, input.deliveryId))
              .limit(1)
          )
          const replay = yield* planAdminReplay(rows[0], input.actorUserId)
          yield* recordOperatorDispatch(replay)
          yield* publisher.enqueue({
            endpointId: replay.plan.endpointId,
            workspaceId: replay.workspaceId,
            eventType: replay.plan.eventType,
            deliveryId: replay.deliveryId,
            payload: replay.plan.payload
          })
          return { deliveryId: replay.deliveryId }
        }
      )
    }
  })
)
