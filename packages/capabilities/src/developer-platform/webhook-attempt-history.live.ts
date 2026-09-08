import { bestEffort } from '../internal/best-effort.ts'
// oxlint-disable effect/noGlobals -- D1 SQL parameters require serialized typed JSON at this adapter boundary.
import { Database, RawD1, type BatchStatement } from '@b2b-saas-starter/db/service'
import {
  webhookDeliveries,
  webhookDeliveryAttempts,
  webhookEndpoints
} from '@b2b-saas-starter/db/schema'
import { and, asc, eq, sql } from 'drizzle-orm'
import { DateTime, Duration, Effect, Schema } from 'effect'

import { AuditEventLog } from '../governance/audit-event-log.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '@b2b-saas-starter/failure/capability'
import { NotificationFeed } from '../notifications/notification-feed.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import {
  DELIVERY_HISTORY_CLEANUP_LIMIT,
  DELIVERY_HISTORY_RETENTION_DAYS,
  deadLetterNotification,
  failureLadderAction,
  terminalDeliveryAuditEventType,
  WEBHOOK_FAILURE_AUTO_DISABLE_AT,
  WebhookDeliveryAttempt,
  type WebhookDeliveryAttemptInput
} from './webhook-delivery-plan.ts'
import { attemptEvidence } from './webhook-attempt-history.ts'
import { type RecordedWebhookAttempt } from './webhook-endpoints.ts'

const unavailable = orUnavailable('webhook-endpoints')
const Recorded = Schema.Struct({
  recorded: Schema.Number,
  ladderChanged: Schema.Number,
  attempts: Schema.Number,
  consecutiveFailures: Schema.Number,
  url: Schema.String,
  status: Schema.Literals([
    'pending',
    'delivered',
    'failed',
    'failed_permanent',
    'dead_lettered'
  ])
})

const decodeRecorded = Schema.decodeUnknownEffect(Schema.Array(Recorded))
const decodeAttempts = Schema.decodeUnknownEffect(Schema.Array(WebhookDeliveryAttempt))

/** One D1 transaction owns acceptance, immutable evidence, summary, streak and audit. */
export const makeLiveAttemptHistory = Effect.gen(function* () {
  const db = yield* Database
  const d1 = yield* RawD1
  const audit = yield* AuditEventLog
  const notifications = yield* NotificationFeed

  const recordAttempt = Effect.fn('WebhookEndpoints.recordAttempt')(function* (
    observation: WebhookDeliveryAttemptInput,
    allowCreate = true
  ) {
    let input = observation
    if (!allowCreate) {
      const rows = yield* unavailable(
        db
          .select({
            eventType: webhookDeliveries.eventType,
            payload: webhookDeliveries.payload
          })
          .from(webhookDeliveries)
          .innerJoin(
            webhookEndpoints,
            eq(webhookEndpoints.id, webhookDeliveries.endpointId)
          )
          .where(
            and(
              eq(webhookDeliveries.id, observation.id ?? ''),
              eq(webhookEndpoints.id, observation.endpointId),
              eq(webhookEndpoints.workspaceId, observation.workspaceId)
            )
          )
          .limit(1)
      )
      const stored = rows[0]
      if (!stored) {
        return {
          deliveryId: observation.id ?? '',
          recorded: false,
          failureAction: 'silent',
          status: 'failed_permanent',
          consecutiveFailures: 0
        } satisfies RecordedWebhookAttempt & { readonly deliveryId: string }
      }
      input = { ...observation, eventType: stored.eventType, payload: stored.payload }
    }
    const deliveryId = input.id ?? (yield* newCapabilityId('whd'))
    const attemptId = yield* newCapabilityId('wha')
    const attemptedAt = DateTime.formatIso(yield* DateTime.now)
    const evidence = attemptEvidence(input)
    const endpointScope = and(
      eq(webhookEndpoints.id, input.endpointId),
      eq(webhookEndpoints.workspaceId, input.workspaceId)
    )
    const owned = sql`exists (select 1 from ${webhookEndpoints} where ${endpointScope})`
    const matchingDelivery = and(
      eq(webhookDeliveries.id, deliveryId),
      eq(webhookDeliveries.endpointId, input.endpointId),
      owned
    )
    const accepted = sql`exists (select 1 from ${webhookDeliveries} where ${matchingDelivery} and ${webhookDeliveries.lastAttemptToken} = ${attemptId})`
    const countsFailure = sql`(${evidence.phase} = 'http' or not exists (select 1 from ${webhookDeliveryAttempts} where ${webhookDeliveryAttempts.deliveryId} = ${deliveryId} and ${webhookDeliveryAttempts.phase} = 'http'))`
    const attemptOrdinal = sql<number>`case when ${evidence.phase} = 'terminal' then max(${input.attempts}, coalesce((select attempts from ${webhookDeliveries} where ${matchingDelivery}), 0)) else ${input.attempts} end`
    const summaryEvidence: Partial<typeof webhookDeliveries.$inferInsert> = {}
    if (evidence.phase === 'http') {
      summaryEvidence.responseStatus = evidence.responseStatus
      summaryEvidence.requestHeaders = evidence.requestHeaders
      summaryEvidence.responseBody = evidence.responseBody
    }
    let headersJson: string | null = null
    if (evidence.requestHeaders !== null) {
      headersJson = JSON.stringify(evidence.requestHeaders)
    }
    const statements: Array<BatchStatement> = []
    if (allowCreate) {
      statements.push(
        db
          .insert(webhookDeliveries)
          .select(
            db
              .select({
                id: sql<string>`${deliveryId}`.as('id'),
                endpointId: sql<string>`${input.endpointId}`.as('endpointId'),
                eventType: sql<string>`${input.eventType}`.as('eventType'),
                status: sql`'pending'`.as('status'),
                attempts: sql<number>`0`.as('attempts'),
                lastAttemptAt: sql<string>`${attemptedAt}`.as('lastAttemptAt'),
                nextAttemptAt: sql<string | null>`null`.as('nextAttemptAt'),
                responseStatus: sql<number | null>`null`.as('responseStatus'),
                payload: sql`${JSON.stringify(input.payload)}`.as('payload'),
                requestHeaders: sql`null`.as('requestHeaders'),
                responseBody: sql<string | null>`null`.as('responseBody'),
                replayedFrom: sql<string | null>`${input.replayedFrom ?? null}`.as(
                  'replayedFrom'
                ),
                lastAttemptToken: sql<string | null>`null`.as('lastAttemptToken')
              })
              .from(sql`(select 1)`)
              .where(owned)
          )
          .onConflictDoNothing()
      )
    }
    statements.push(
      db
        .insert(webhookDeliveryAttempts)
        .select(
          db
            .select({
              id: sql<string>`${attemptId}`.as('id'),
              deliveryId: sql<string>`${deliveryId}`.as('deliveryId'),
              attempts: attemptOrdinal.as('attempts'),
              phase: sql`${evidence.phase}`.as('phase'),
              status: sql`${input.status}`.as('status'),
              attemptedAt: sql<string>`${attemptedAt}`.as('attemptedAt'),
              durationMs: sql<number | null>`${evidence.durationMs}`.as('durationMs'),
              failureReason: sql<string | null>`${evidence.failureReason}`.as(
                'failureReason'
              ),
              responseStatus: sql<number | null>`${evidence.responseStatus}`.as(
                'responseStatus'
              ),
              requestHeaders: sql`${headersJson}`.as('requestHeaders'),
              responseBody: sql<string | null>`${evidence.responseBody}`.as(
                'responseBody'
              )
            })
            .from(sql`(select 1)`)
            .where(
              sql`exists (select 1 from ${webhookDeliveries} where ${matchingDelivery})`
            )
        )
        .onConflictDoNothing(),
      db
        .update(webhookDeliveries)
        .set({
          status: input.status,
          attempts: attemptOrdinal,
          lastAttemptAt: attemptedAt,
          nextAttemptAt: input.nextAttemptAt ?? null,
          ...summaryEvidence,
          lastAttemptToken: attemptId
        })
        .where(
          and(
            matchingDelivery,
            sql`exists (select 1 from ${webhookDeliveryAttempts} where ${webhookDeliveryAttempts.id} = ${attemptId})`,
            sql`${webhookDeliveries.status} in ('pending', 'failed')`,
            sql`(${evidence.phase} = 'terminal' or ${webhookDeliveries.status} = 'pending' or ${webhookDeliveries.attempts} < ${input.attempts})`
          )
        ),
      db
        .update(webhookEndpoints)
        .set({
          consecutiveFailures: sql`case when ${input.status} = 'delivered' then 0 else ${webhookEndpoints.consecutiveFailures} + 1 end`
        })
        .where(and(endpointScope, accepted, countsFailure))
    )
    const eventType = terminalDeliveryAuditEventType.get(input.status)
    if (eventType !== undefined) {
      statements.push(
        yield* audit.prepareRecord(
          {
            workspaceId: input.workspaceId,
            actorType: 'system',
            eventType,
            targetType: 'webhook_endpoint',
            targetId: input.endpointId,
            metadata: {
              deliveryId,
              eventType: input.eventType,
              queueAttempts: input.attempts,
              responseStatus: evidence.responseStatus
            }
          },
          accepted
        )
      )
    }
    const disable = and(
      endpointScope,
      accepted,
      countsFailure,
      eq(webhookEndpoints.enabled, true),
      sql`${webhookEndpoints.consecutiveFailures} >= ${WEBHOOK_FAILURE_AUTO_DISABLE_AT}`
    )
    statements.push(
      yield* audit.prepareRecord(
        {
          workspaceId: input.workspaceId,
          actorType: 'system',
          eventType: 'webhook_endpoint.auto_disabled',
          targetType: 'webhook_endpoint',
          targetId: input.endpointId,
          metadata: { deliveryId }
        },
        sql`exists (select 1 from ${webhookEndpoints} where ${disable})`
      ),
      db.update(webhookEndpoints).set({ enabled: false }).where(disable),
      db
        .select({
          recorded: sql<number>`case when ${accepted} then 1 else 0 end`.as('recorded'),
          ladderChanged:
            sql<number>`case when ${accepted} and ${countsFailure} then 1 else 0 end`.as(
              'ladderChanged'
            ),
          attempts:
            sql<number>`coalesce((select attempts from ${webhookDeliveries} where ${matchingDelivery}), 0)`.as(
              'attempts'
            ),
          consecutiveFailures: sql<number>`${webhookEndpoints.consecutiveFailures}`.as(
            'consecutiveFailures'
          ),
          url: webhookEndpoints.url,
          status:
            sql`coalesce((select status from ${webhookDeliveries} where ${matchingDelivery}), 'failed_permanent')`.as(
              'status'
            )
        })
        .from(webhookEndpoints)
        .where(endpointScope)
    )
    const results = yield* unavailable(
      Effect.tryPromise(() =>
        d1.batch(
          statements.map((statement) => {
            const query = statement.toSQL()
            return d1.prepare(query.sql).bind(...query.params)
          })
        )
      )
    )
    const rows = yield* unavailable(decodeRecorded(results.at(-1)?.results ?? []))
    const row = rows[0]
    const recorded = row?.recorded === 1
    if (recorded && input.status === 'dead_lettered') {
      yield* bestEffort(
        notifications.create({
          workspaceId: input.workspaceId,
          userId: null,
          kind: 'webhook.delivery_failed',
          ...deadLetterNotification({
            eventType: input.eventType,
            attempts: row.attempts,
            url: row.url
          })
        }),
        () => ({ webhookDeadLetterNotification: 'failed', deliveryId })
      )
    }
    let failureAction: 'silent' | 'warn' | 'disable' = 'silent'
    if (row?.ladderChanged === 1) {
      failureAction = failureLadderAction(row.consecutiveFailures)
    }
    return {
      deliveryId,
      recorded,
      failureAction,
      status: row?.status ?? 'failed_permanent',
      consecutiveFailures: row?.consecutiveFailures ?? 0
    }
  })
  const listDeliveryAttempts = Effect.fn('WebhookEndpoints.listDeliveryAttempts')(
    function* (input: { readonly deliveryId: string }) {
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
  const cleanupDeliveryHistory = Effect.fn('WebhookEndpoints.cleanupDeliveryHistory')(
    function* () {
      const cutoff = DateTime.formatIso(
        DateTime.subtractDuration(
          yield* DateTime.now,
          Duration.days(DELIVERY_HISTORY_RETENTION_DAYS)
        )
      )
      const deleted = yield* unavailable(
        db
          .delete(webhookDeliveries)
          .where(
            sql`${webhookDeliveries.id} in (select id from ${webhookDeliveries} where ${webhookDeliveries.lastAttemptAt} < ${cutoff} and ${webhookDeliveries.status} in ('delivered', 'failed_permanent', 'dead_lettered') order by ${webhookDeliveries.lastAttemptAt} limit ${DELIVERY_HISTORY_CLEANUP_LIMIT})`
          )
          .returning({ id: webhookDeliveries.id })
      )
      return deleted.length
    }
  )
  function recordTerminalAttempt(input: WebhookDeliveryAttemptInput) {
    return recordAttempt(input, false)
  }
  return {
    recordAttempt,
    recordTerminalAttempt,
    listDeliveryAttempts,
    cleanupDeliveryHistory
  }
})
