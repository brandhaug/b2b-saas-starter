import {
  type WebhookDeliveryId,
  type WebhookEndpointId
} from '@b2b-saas-starter/db/ids'
import { Database } from '@b2b-saas-starter/db/service'
import {
  webhookDeliveries,
  webhookEndpoints
} from '@b2b-saas-starter/db/schema/developer-platform'
import { DateTime, Effect } from 'effect'
import { and, count, eq, sql } from 'drizzle-orm'
import {
  type CapabilityUnavailable,
  orUnavailable
} from '@b2b-saas-starter/failure/capability'
import { auditedMutations } from '../governance/audited-mutation.ts'
import {
  AuditEventLog,
  type RecordAuditEventInput
} from '../governance/audit-event-log.ts'
import {
  deliveredDeliveryStatus,
  deliverySuccessRate,
  type PendingDispatchPlan
} from './webhook-delivery-plan.ts'
import { type WebhookEndpoint } from './webhook-endpoints.ts'

/** The webhook services sharing this storage, each its own unavailability label. */
export type WebhookStorageCapability =
  | 'webhook-endpoints'
  | 'webhook-deliveries'
  | 'webhook-delivery-admin'
  | 'webhook-dispatch'

/**
 * D1 storage the webhook services share: endpoint lookups always paired with
 * their owning workspace, the success-rate aggregate, and the operator
 * dispatch reservation that replay, admin replay and test sends start from.
 * Every failure, shared reads included, is labelled with the calling service
 * so a 503 names the capability that was asked.
 */
export function makeLiveWebhookStorage(capability: WebhookStorageCapability) {
  const unavailable = orUnavailable(capability)
  return Effect.gen(function* () {
    const db = yield* Database
    const audit = yield* AuditEventLog

    const auditedMutation = yield* auditedMutations({
      prepareAuditRecord: audit.prepareRecord,
      unavailable
    })

    function endpointExists(endpointId: WebhookEndpointId, workspaceId: string) {
      return unavailable(
        db
          .select({ id: webhookEndpoints.id })
          .from(webhookEndpoints)
          .where(scopedEndpointWhere(endpointId, workspaceId))
          .limit(1)
      ).pipe(Effect.map((rows) => rows.length > 0))
    }

    function endpointRow(endpointId: WebhookEndpointId, workspaceId: string) {
      return unavailable(
        db
          .select()
          .from(webhookEndpoints)
          .where(scopedEndpointWhere(endpointId, workspaceId))
          .limit(1)
      ).pipe(Effect.map((rows) => rows[0] ?? null))
    }

    // Aggregate once per read rather than scanning deliveries for each endpoint.
    function aggregateQuery() {
      return db
        .select({
          id: webhookEndpoints.id,
          url: webhookEndpoints.url,
          enabled: webhookEndpoints.enabled,
          events: webhookEndpoints.events,
          total: count(webhookDeliveries.id),
          delivered: sql<number>`coalesce(sum(case when ${webhookDeliveries.status} = ${deliveredDeliveryStatus} then 1 else 0 end), 0)`
        })
        .from(webhookEndpoints)
        .leftJoin(
          webhookDeliveries,
          eq(webhookDeliveries.endpointId, webhookEndpoints.id)
        )
    }

    function endpointProjection(
      endpointId: WebhookEndpointId,
      workspaceId: string
    ): Effect.Effect<WebhookEndpoint | null, CapabilityUnavailable> {
      return unavailable(
        aggregateQuery()
          .where(scopedEndpointWhere(endpointId, workspaceId))
          .groupBy(webhookEndpoints.id)
      ).pipe(
        Effect.map((rows) => {
          const row = rows[0]
          if (!row) {
            return null
          }
          return projectionFromAggregate(row)
        })
      )
    }

    /**
     * Creates the `pending` row an operator dispatch (replay, test send)
     * starts from, batching its audit event when there is one. The row shape
     * is the caller's plan (`planReplayedDelivery` / `planPendingDispatch`),
     * so the two dispatch flows share everything and differ only in
     * provenance.
     */
    function recordOperatorDispatch(input: {
      readonly deliveryId: WebhookDeliveryId
      readonly workspaceId: string
      readonly plan: PendingDispatchPlan
      readonly auditEvent?: RecordAuditEventInput | undefined
      readonly approvedEndpointUrl?: string | undefined
    }) {
      return Effect.gen(function* () {
        const now = yield* DateTime.now
        const insert = db
          .insert(webhookDeliveries)
          .values({
            id: input.deliveryId,
            endpointId: input.plan.endpointId,
            eventType: input.plan.eventType,
            status: input.plan.status,
            attempts: input.plan.attempts,
            lastAttemptAt: DateTime.formatIso(now),
            nextAttemptAt: input.plan.nextAttemptAt,
            responseStatus: input.plan.responseStatus,
            payload: input.plan.payload,
            requestHeaders: null,
            responseBody: null,
            replayedFrom: input.plan.replayedFrom,
            approvedEndpointUrl: input.approvedEndpointUrl ?? null
          })
          .onConflictDoNothing()
        if (input.auditEvent === undefined) {
          yield* unavailable(insert)
          return
        }
        yield* auditedMutation({
          matched: Effect.succeed(true),
          auditEvent: input.auditEvent,
          write: () => [insert],
          // The audit immediately follows this insert in one D1 batch. A duplicate
          // stable replay identity changes zero rows and must record no new replay.
          transition: { condition: sql`changes() = 1`, alongside: [] }
        })
      })
    }

    return {
      db,
      unavailable,
      auditedMutation,
      endpointExists,
      endpointRow,
      aggregateQuery,
      endpointProjection,
      recordOperatorDispatch
    }
  })
}

export function projectionFromAggregate(
  row: Pick<
    typeof webhookEndpoints.$inferSelect,
    'id' | 'url' | 'enabled' | 'events'
  > & { total: number; delivered: number }
): WebhookEndpoint {
  return {
    id: row.id,
    url: row.url,
    enabled: row.enabled,
    events: row.events,
    // `sql<number>` does not guarantee the driver's runtime type for SUM.
    // oxlint-disable-next-line typescript/no-unnecessary-type-conversion -- see above
    successRate: deliverySuccessRate(row.total, Number(row.delivered))
  }
}

// Always pair endpoint identity with its owning workspace.
export function scopedEndpointWhere(
  endpointId: WebhookEndpointId,
  workspaceId: string
) {
  return and(
    eq(webhookEndpoints.id, endpointId),
    eq(webhookEndpoints.workspaceId, workspaceId)
  )
}
