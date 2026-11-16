import { type WebhookDeliveryId } from '@b2b-saas-starter/db/ids'
import { type RawD1, type Database } from '@b2b-saas-starter/db/service'
import {
  webhookDeliveries,
  webhookDeliveryAttempts,
  webhookEndpoints
} from '@b2b-saas-starter/db/schema/developer-platform'
import { Effect, Layer, Schema } from 'effect'
import { and, asc, desc, eq, sql } from 'drizzle-orm'

import { type AuditEventLog } from '../governance/audit-event-log.ts'
import {
  DELIVERIES_PAGE_SIZE,
  WebhookDeliveryAttempt
} from './webhook-delivery-plan.ts'
import { WebhookDeliveries, WebhookDeliveryNotFound } from './webhook-deliveries.ts'
import { makeWebhookReplay } from './webhook-replay.ts'
import { WebhookPublisher } from './webhook-publisher.ts'
import { makeLiveWebhookStorage } from './webhook-storage.live.ts'
import { WorkspaceContext } from '../workspace-context.ts'

const decodeAttempts = Schema.decodeUnknownEffect(Schema.Array(WebhookDeliveryAttempt))

export const LiveWebhookDeliveries: Layer.Layer<
  WebhookDeliveries,
  never,
  Database | RawD1 | AuditEventLog | WebhookPublisher
> = Layer.effect(WebhookDeliveries)(
  Effect.gen(function* () {
    const publisher = yield* WebhookPublisher
    const { db, unavailable, endpointProjection, recordOperatorDispatch } =
      yield* makeLiveWebhookStorage('webhook-deliveries')

    const listDeliveryAttempts = Effect.fn('WebhookDeliveries.listDeliveryAttempts')(
      function* (input: { readonly deliveryId: WebhookDeliveryId }) {
        const ctx = yield* WorkspaceContext
        const rows = yield* unavailable(
          db
            .select({ attempt: webhookDeliveryAttempts })
            .from(webhookDeliveryAttempts)
            .innerJoin(
              webhookDeliveries,
              eq(webhookDeliveries.id, webhookDeliveryAttempts.deliveryId)
            )
            .innerJoin(
              webhookEndpoints,
              eq(webhookEndpoints.id, webhookDeliveries.endpointId)
            )
            .where(
              and(
                eq(webhookDeliveries.id, input.deliveryId),
                eq(webhookEndpoints.workspaceId, ctx.workspace.id)
              )
            )
            .orderBy(
              asc(webhookDeliveryAttempts.attempts),
              asc(webhookDeliveryAttempts.phase)
            )
        )
        return yield* unavailable(decodeAttempts(rows.map((row) => row.attempt)))
      }
    )

    return {
      listDeliveryAttempts,
      listDeliveries: Effect.fn('WebhookDeliveries.listDeliveries')(function* (input) {
        const ctx = yield* WorkspaceContext
        // The join scopes to the calling workspace: a foreign endpoint id
        // matches no row of its own and yields an empty list.
        return yield* unavailable(
          db
            .select({
              id: webhookDeliveries.id,
              endpointId: webhookDeliveries.endpointId,
              eventType: webhookDeliveries.eventType,
              status: webhookDeliveries.status,
              attempts: webhookDeliveries.attempts,
              lastAttemptAt: webhookDeliveries.lastAttemptAt,
              nextAttemptAt: webhookDeliveries.nextAttemptAt,
              responseStatus: webhookDeliveries.responseStatus,
              payload: webhookDeliveries.payload,
              requestHeaders: webhookDeliveries.requestHeaders,
              responseBody: webhookDeliveries.responseBody,
              replayedFrom: webhookDeliveries.replayedFrom
            })
            .from(webhookDeliveries)
            .innerJoin(
              webhookEndpoints,
              eq(webhookEndpoints.id, webhookDeliveries.endpointId)
            )
            .where(
              and(
                eq(webhookDeliveries.endpointId, input.endpointId),
                eq(webhookEndpoints.workspaceId, ctx.workspace.id)
              )
            )
            // Newest first, with the row id as the tie-break so the order is
            // total even when attempts share a timestamp — the same order
            // the Seed adapter sorts by, asserted by the shared contract.
            .orderBy(
              sql`${webhookDeliveries.lastAttemptAt} desc`,
              desc(webhookDeliveries.id)
            )
            .limit(DELIVERIES_PAGE_SIZE)
        )
      }),
      inspectDelivery: Effect.fn('WebhookDeliveries.inspectDelivery')(
        function* (input) {
          const ctx = yield* WorkspaceContext
          const rows = yield* unavailable(
            db
              .select({
                delivery: webhookDeliveries,
                endpoint: webhookEndpoints
              })
              .from(webhookDeliveries)
              .innerJoin(
                webhookEndpoints,
                eq(webhookEndpoints.id, webhookDeliveries.endpointId)
              )
              .where(
                and(
                  eq(webhookDeliveries.id, input.deliveryId),
                  eq(webhookEndpoints.workspaceId, ctx.workspace.id)
                )
              )
              .limit(1)
          )
          const row = rows[0]
          if (!row) {
            return yield* Effect.fail(
              new WebhookDeliveryNotFound({ deliveryId: input.deliveryId })
            )
          }
          const endpoint = yield* endpointProjection(row.endpoint.id, ctx.workspace.id)
          if (endpoint === null) {
            return yield* new WebhookDeliveryNotFound({ deliveryId: input.deliveryId })
          }
          return {
            endpoint,
            delivery: row.delivery,
            attempts: yield* listDeliveryAttempts({
              deliveryId: input.deliveryId
            })
          }
        }
      ),
      replayDelivery: makeWebhookReplay(
        {
          source: (deliveryId, workspaceId) =>
            Effect.gen(function* () {
              const rows = yield* unavailable(
                db
                  .select({
                    id: webhookDeliveries.id,
                    endpointId: webhookDeliveries.endpointId,
                    eventType: webhookDeliveries.eventType,
                    status: webhookDeliveries.status,
                    payload: webhookDeliveries.payload,
                    enabled: webhookEndpoints.enabled,
                    endpointUrl: webhookEndpoints.url
                  })
                  .from(webhookDeliveries)
                  .innerJoin(
                    webhookEndpoints,
                    eq(webhookEndpoints.id, webhookDeliveries.endpointId)
                  )
                  .where(
                    and(
                      eq(webhookDeliveries.id, deliveryId),
                      eq(webhookEndpoints.workspaceId, workspaceId)
                    )
                  )
                  .limit(1)
              )
              return rows[0] ?? null
            }),
          reserve: (input) =>
            Effect.gen(function* () {
              yield* recordOperatorDispatch(input)
              const rows = yield* unavailable(
                db
                  .select({
                    endpointId: webhookDeliveries.endpointId,
                    replayedFrom: webhookDeliveries.replayedFrom,
                    approvedEndpointUrl: webhookDeliveries.approvedEndpointUrl,
                    status: webhookDeliveries.status
                  })
                  .from(webhookDeliveries)
                  .where(eq(webhookDeliveries.id, input.deliveryId))
                  .limit(1)
              )
              return rows[0] ?? null
            })
        },
        publisher
      )
    }
  })
)
