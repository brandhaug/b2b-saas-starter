import { type RawD1, type Database } from '@b2b-saas-starter/db/service'
import {
  webhookDeliveries,
  webhookEndpoints
} from '@b2b-saas-starter/db/schema/developer-platform'
import { DateTime, Effect, Layer } from 'effect'
import { and, eq, inArray } from 'drizzle-orm'

import { ResourceEntitlements } from '@b2b-saas-starter/billing/resource-entitlements'
import { type AuditEventLog } from '../governance/audit-event-log.ts'
import { type NotificationFeed } from '../notifications/notification-feed.ts'
import { makeLiveAttemptHistory } from './webhook-attempt-history.live.ts'
import {
  activeSigningSecrets,
  readSigningSecretRotation,
  settledDeliveryStatuses
} from './webhook-delivery-plan.ts'
import { WebhookDispatch } from './webhook-dispatch.ts'
import { makeLiveWebhookStorage } from './webhook-storage.live.ts'

export const LiveWebhookDispatch: Layer.Layer<
  WebhookDispatch,
  never,
  Database | RawD1 | AuditEventLog | NotificationFeed | ResourceEntitlements
> = Layer.effect(WebhookDispatch)(
  Effect.gen(function* () {
    const entitlements = yield* ResourceEntitlements
    const history = yield* makeLiveAttemptHistory
    const { db, unavailable, endpointRow } =
      yield* makeLiveWebhookStorage('webhook-dispatch')

    return {
      isDeliverySettled: (input) =>
        Effect.gen(function* () {
          const rows = yield* unavailable(
            db
              .select({ id: webhookDeliveries.id })
              .from(webhookDeliveries)
              .innerJoin(
                webhookEndpoints,
                eq(webhookEndpoints.id, webhookDeliveries.endpointId)
              )
              .where(
                and(
                  eq(webhookDeliveries.id, input.deliveryId),
                  eq(webhookEndpoints.id, input.endpointId),
                  eq(webhookEndpoints.workspaceId, input.workspaceId),
                  inArray(webhookDeliveries.status, [...settledDeliveryStatuses])
                )
              )
              .limit(1)
          )
          return rows.length > 0
        }),
      getDispatchTarget: (endpointId, workspaceId, deliveryId) =>
        Effect.gen(function* () {
          const endpoint = yield* endpointRow(endpointId, workspaceId)
          if (!endpoint || !endpoint.enabled) {
            return null
          }
          const delivery = yield* unavailable(
            db
              .select({
                id: webhookDeliveries.id,
                eventType: webhookDeliveries.eventType,
                payload: webhookDeliveries.payload,
                approvedEndpointUrl: webhookDeliveries.approvedEndpointUrl
              })
              .from(webhookDeliveries)
              .where(
                and(
                  eq(webhookDeliveries.id, deliveryId),
                  eq(webhookDeliveries.endpointId, endpointId)
                )
              )
              .limit(1)
          )
          const queued = delivery[0]
          if (
            !queued ||
            (queued.approvedEndpointUrl !== null &&
              queued.approvedEndpointUrl !== endpoint.url)
          ) {
            return null
          }
          const allowed = yield* entitlements.isActiveForWorkspace({
            workspaceId,
            resource: 'webhook_endpoint',
            resourceId: endpoint.id
          })
          if (!allowed) {
            return null
          }
          return {
            id: endpoint.id,
            url: endpoint.url,
            signingSecrets: activeSigningSecrets(
              readSigningSecretRotation(endpoint),
              yield* DateTime.now
            ),
            eventType: queued.eventType,
            payload: queued.payload
          }
        }),
      recordDeliveryAttempt: (input) => history.recordAttempt(input),
      recordTerminalDeliveryAttempt: (input) =>
        // Resolve the producer's existing row and stored contents before
        // terminal bookkeeping. Keep response evidence and clear retry timing.
        history.recordTerminalAttempt({
          ...input,
          id: input.deliveryId,
          phase: 'terminal',
          nextAttemptAt: null
        })
    }
  })
)
