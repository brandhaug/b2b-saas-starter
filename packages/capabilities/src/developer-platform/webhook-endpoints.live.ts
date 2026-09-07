import { Billing } from '../billing/billing.ts'
import { makeLiveAttemptHistory } from './webhook-attempt-history.live.ts'
import { Database, type RawD1 } from '@b2b-saas-starter/db/service'
import {
  type JsonObject,
  type JsonValue,
  webhookDeliveries,
  webhookEndpoints,
  workspaces
} from '@b2b-saas-starter/db/schema'
import { DateTime, Effect, Layer } from 'effect'
import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'

import { assertWithinPlanLimitFor } from '../billing/resource-admission.ts'
import { ResourceEntitlements } from '../billing/resource-entitlements.ts'
import { auditedMutations } from '../governance/audited-mutation.ts'
import {
  AuditEventLog,
  type RecordAuditEventInput
} from '../governance/audit-event-log.ts'
import { type CapabilityUnavailable } from '../errors.ts'
import {
  activeSigningSecrets,
  DELIVERIES_PAGE_SIZE,
  deliverySuccessRate,
  isReplayableDeliveryStatus,
  planPendingDispatch,
  planReplayedDelivery,
  planSecretRotation,
  WEBHOOK_FAILURE_AUTO_DISABLE_AT,
  type PendingDispatchPlan
} from './webhook-delivery-plan.ts'
import { type NotificationFeed } from '../notifications/notification-feed.ts'
import {
  ensureValidWebhookUrl,
  planAdminReplay,
  TERMINAL_DELIVERY_STATUSES,
  type UpdateWebhookEndpointInput,
  WEBHOOK_TEST_EVENT_TYPE,
  WebhookDispatchRejected,
  WebhookEndpointNotFound,
  WebhookDeliveryNotFound,
  WebhookEndpoints,
  type WebhookEndpoint
} from './webhook-endpoints.ts'
import { randomWebhookSecret } from '../crypto.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { clampPageLimit, cutKeysetPage } from '../internal/keyset-cursor.ts'
import { keysetResume } from '../internal/keyset-query.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { publishWebhookEventWith, WebhookPublisher } from './webhook-publisher.ts'
import { WorkspaceContext } from '../workspace-context.ts'

const unavailable = orUnavailable('webhook-endpoints')

/**
 * One aggregate row → the wire projection. The success rate is derived
 * here so no read site re-derives (or drifts from) it.
 */
function projectionFromAggregate(
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
    // `sql<number>` is an unchecked claim about what the driver hands
    // back, not a guarantee, so the coercion stays as runtime defence
    // for the SUM column.
    // oxlint-disable-next-line typescript/no-unnecessary-type-conversion -- see above
    successRate: deliverySuccessRate(row.total, Number(row.delivered))
  }
}

/**
 * The workspace-scoped row filter every endpoint read/write shares. The
 * double-check discipline lives here: an endpoint id is only ever acted on
 * together with its owning workspace.
 */
function scopedEndpointWhere(endpointId: string, workspaceId: string) {
  return and(
    eq(webhookEndpoints.id, endpointId),
    eq(webhookEndpoints.workspaceId, workspaceId)
  )
}

/**
 * The audit metadata for an update: the fields the caller provided, and only
 * those — an unchanged field never reads as changed in the governance log.
 * Built as statements, not a conditional spread, so a missing field is
 * *absent* rather than laundered through `{}`.
 */
function updateMetadata(input: {
  readonly url?: string | undefined
  readonly events?: ReadonlyArray<string> | undefined
  readonly enabled?: boolean | undefined
}): JsonObject {
  const metadata: Record<string, JsonValue> = {}
  if (input.url !== undefined) {
    metadata.url = input.url
  }
  if (input.events !== undefined) {
    metadata.events = [...input.events]
  }
  if (input.enabled !== undefined) {
    metadata.enabled = input.enabled
  }
  return metadata
}

export const LiveWebhookEndpoints: Layer.Layer<
  WebhookEndpoints,
  never,
  | Billing
  | Database
  | RawD1
  | AuditEventLog
  | WebhookPublisher
  | NotificationFeed
  | ResourceEntitlements
> = Layer.effect(WebhookEndpoints)(
  Effect.gen(function* () {
    const db = yield* Database
    const billing = yield* Billing
    const audit = yield* AuditEventLog
    const publisher = yield* WebhookPublisher
    const entitlements = yield* ResourceEntitlements
    const history = yield* makeLiveAttemptHistory

    // The shared mutate+audit combinator — one implementation of the batched
    // write, its zero-match skip, and the phantom-audit caveat (see
    // governance/audited-mutation.ts).
    const auditedMutation = yield* auditedMutations({
      prepareAuditRecord: audit.prepareRecord,
      unavailable
    })

    function endpointExists(endpointId: string, workspaceId: string) {
      return unavailable(
        db
          .select({ id: webhookEndpoints.id })
          .from(webhookEndpoints)
          .where(scopedEndpointWhere(endpointId, workspaceId))
          .limit(1)
      ).pipe(Effect.map((rows) => rows.length > 0))
    }

    /** One endpoint row scoped to a workspace, or `null` on no match. */
    function endpointRow(endpointId: string, workspaceId: string) {
      return unavailable(
        db
          .select()
          .from(webhookEndpoints)
          .where(scopedEndpointWhere(endpointId, workspaceId))
          .limit(1)
      ).pipe(Effect.map((rows) => rows[0] ?? null))
    }

    /**
     * The endpoint+deliveries aggregate every endpoint read projects: one
     * grouped query (endpoints left-joined to their deliveries with count +
     * conditional-sum aggregates) instead of one delivery scan per endpoint.
     * `endpointProjection`, `list`, and `listPage` differ only in the where
     * clause and the paging around this builder.
     */
    function aggregateQuery() {
      return db
        .select({
          id: webhookEndpoints.id,
          url: webhookEndpoints.url,
          enabled: webhookEndpoints.enabled,
          events: webhookEndpoints.events,
          total: count(webhookDeliveries.id),
          delivered: sql<number>`coalesce(sum(case when ${webhookDeliveries.status} = 'delivered' then 1 else 0 end), 0)`
        })
        .from(webhookEndpoints)
        .leftJoin(
          webhookDeliveries,
          eq(webhookDeliveries.endpointId, webhookEndpoints.id)
        )
    }

    /**
     * The wire projection for one endpoint, success rate included — the same
     * aggregate shape `list` computes for every endpoint, over this one.
     */
    function endpointProjection(
      endpointId: string,
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
      readonly deliveryId: string
      readonly workspaceId: string
      readonly plan: PendingDispatchPlan
      readonly auditEvent?: RecordAuditEventInput | undefined
    }) {
      return Effect.gen(function* () {
        const now = yield* DateTime.now
        const insert = db.insert(webhookDeliveries).values({
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
          replayedFrom: input.plan.replayedFrom
        })
        if (input.auditEvent === undefined) {
          yield* unavailable(insert)
          return
        }
        yield* auditedMutation({
          matched: Effect.succeed(true),
          auditEvent: input.auditEvent,
          write: () => insert
        })
      })
    }

    return {
      listDeliveryAttempts: history.listDeliveryAttempts,
      cleanupDeliveryHistory: history.cleanupDeliveryHistory,
      list: Effect.gen(function* () {
        const ctx = yield* WorkspaceContext
        const rows = yield* unavailable(
          aggregateQuery()
            .where(eq(webhookEndpoints.workspaceId, ctx.workspace.id))
            .groupBy(webhookEndpoints.id)
        )
        return rows.map(projectionFromAggregate)
      }),
      listPage: (input) =>
        Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const limit = clampPageLimit(input?.limit)
          const conditions: Array<SQL> = [
            eq(webhookEndpoints.workspaceId, ctx.workspace.id)
          ]
          // Forward on `id ASC` — no timestamp on the wire shape, so the
          // stable order a page can resume is the id itself. The SQL resume
          // comes from `keyset-query.ts`, like every paged read.
          const resume = keysetResume(
            'asc',
            { key: webhookEndpoints.id, id: webhookEndpoints.id },
            input?.cursor
          )
          if (resume.kind === 'empty') {
            return { items: [], nextCursor: null }
          }
          if (resume.kind === 'resume') {
            conditions.push(resume.condition)
          }
          // One row past the page cap, so `cutKeysetPage` can see whether the
          // cap actually cut rows off before offering a cursor.
          const rows = yield* unavailable(
            aggregateQuery()
              .where(and(...conditions))
              .groupBy(webhookEndpoints.id)
              .orderBy(asc(webhookEndpoints.id))
              .limit(limit + 1)
          )
          return cutKeysetPage(
            rows.map(projectionFromAggregate),
            limit,
            (endpoint) => ({ key: endpoint.id, id: endpoint.id })
          )
        }),
      create: (input) =>
        Effect.gen(function* () {
          yield* ensureValidWebhookUrl(input.url)
          const ctx = yield* WorkspaceContext
          // Entitlement gate: the workspace's plan caps endpoint count.
          yield* assertWithinPlanLimitFor({
            resource: 'webhook_endpoint',
            db,
            capability: 'webhook-endpoints',
            table: webhookEndpoints,
            where: eq(webhookEndpoints.workspaceId, ctx.workspace.id)
          }).pipe(Effect.provideService(Billing, billing))
          const signingSecret = randomWebhookSecret()
          const createdAt = yield* DateTime.now
          const endpoint = {
            id: yield* newCapabilityId('wh'),
            workspaceId: ctx.workspace.id,
            url: input.url,
            description: input.description,
            signingSecret,
            enabled: true,
            // Subscriptions stay free-text on the wire and at rest so producers
            // can grow without a migration — the column type matches.
            events: [...input.events],
            createdAt: DateTime.formatIso(createdAt)
          }
          // Insert + audit insert as one batch — the shared audited-mutation
          // shape with an unconditional match.
          yield* auditedMutation({
            matched: Effect.succeed(true),
            auditEvent: {
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              actorType: ctx.actorType,
              eventType: 'webhook_endpoint.created',
              targetType: 'webhook_endpoint',
              targetId: endpoint.id,
              metadata: { url: input.url, events: input.events }
            },
            write: () => db.insert(webhookEndpoints).values(endpoint)
          })
          // Fan-out sits beside the audit write, below the interface: the
          // projection only — never the signing secret.
          yield* publishWebhookEventWith(publisher, {
            eventType: 'webhook_endpoint.created',
            payload: toEndpointProjection(endpoint)
          })
          return {
            endpoint: toEndpointProjection(endpoint),
            signingSecret
          }
        }),
      listDeliveries: (input) =>
        Effect.gen(function* () {
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
      listGlobalDeliveries: Effect.fn('WebhookEndpoints.listGlobalDeliveries')(
        function* (input) {
          const limit = clampPageLimit(input?.limit)
          const conditions: Array<SQL> = [
            inArray(webhookDeliveries.status, [...TERMINAL_DELIVERY_STATUSES])
          ]
          // Nullable attempt times sort last. Use a nonempty sentinel below
          // ISO dates so the shared cursor codec can page through nulls too.
          const attemptKey = sql`coalesce(${webhookDeliveries.lastAttemptAt}, '!')`
          const resume = keysetResume(
            'desc',
            {
              key: attemptKey,
              id: webhookDeliveries.id
            },
            input?.cursor
          )
          if (resume.kind === 'empty') {
            return { items: [], nextCursor: null }
          }
          if (resume.kind === 'resume') {
            conditions.push(resume.condition)
          }
          // One row past the page cap, so `cutKeysetPage` can see whether the
          // cap actually cut rows off before offering a cursor.
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
              .orderBy(sql`${attemptKey} desc`, desc(webhookDeliveries.id))
              .limit(limit + 1)
          )
          return cutKeysetPage(rows, limit, (row) => ({
            key: row.lastAttemptAt ?? '!',
            id: row.id
          }))
        }
      ),
      update: (input) =>
        Effect.gen(function* () {
          if (input.url !== undefined) {
            yield* ensureValidWebhookUrl(input.url)
          }
          const ctx = yield* WorkspaceContext
          const patch: UpdateWebhookEndpointInput = {
            endpointId: input.endpointId
          }
          if (input.url !== undefined) {
            patch.url = input.url
          }
          if (input.events !== undefined) {
            patch.events = [...input.events]
          }
          if (input.enabled !== undefined) {
            patch.enabled = input.enabled
          }
          const applied = yield* auditedMutation({
            matched: endpointExists(input.endpointId, ctx.workspace.id),
            auditEvent: {
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              actorType: ctx.actorType,
              eventType: 'webhook_endpoint.updated',
              targetType: 'webhook_endpoint',
              targetId: input.endpointId,
              metadata: updateMetadata(input)
            },
            write: () =>
              db
                .update(webhookEndpoints)
                .set(patch)
                .where(scopedEndpointWhere(input.endpointId, ctx.workspace.id))
          })
          if (!applied) {
            return yield* Effect.fail(
              new WebhookEndpointNotFound({ endpointId: input.endpointId })
            )
          }
          const projection = yield* endpointProjection(
            input.endpointId,
            ctx.workspace.id
          )
          if (projection === null) {
            // The update matched but the row vanished before the read-back —
            // the same phantom race the combinator documents. Not-found is the
            // honest answer for a row that no longer exists.
            return yield* Effect.fail(
              new WebhookEndpointNotFound({ endpointId: input.endpointId })
            )
          }
          return projection
        }),
      delete: (input) =>
        Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          // Read first so the audit metadata can name what was removed; the
          // deliveries cascade with the endpoint row (FK `onDelete`).
          const endpoint = yield* endpointRow(input.endpointId, ctx.workspace.id)
          if (!endpoint) {
            return yield* Effect.fail(
              new WebhookEndpointNotFound({ endpointId: input.endpointId })
            )
          }
          yield* auditedMutation({
            matched: Effect.succeed(true),
            auditEvent: {
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              actorType: ctx.actorType,
              eventType: 'webhook_endpoint.deleted',
              targetType: 'webhook_endpoint',
              targetId: input.endpointId,
              metadata: { url: endpoint.url }
            },
            write: () =>
              db
                .delete(webhookEndpoints)
                .where(scopedEndpointWhere(input.endpointId, ctx.workspace.id))
          })
        }),
      replayDeliveryAsAdmin: Effect.fn('WebhookEndpoints.replayDeliveryAsAdmin')(
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
      ),
      replayDelivery: (input) =>
        Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          // Workspace-scoped join: a foreign delivery id matches no row and
          // reads as not found, same as every other mutation here.
          const rows = yield* unavailable(
            db
              .select({
                id: webhookDeliveries.id,
                endpointId: webhookDeliveries.endpointId,
                eventType: webhookDeliveries.eventType,
                status: webhookDeliveries.status,
                payload: webhookDeliveries.payload,
                enabled: webhookEndpoints.enabled
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
          const source = rows[0]
          if (!source) {
            return yield* Effect.fail(
              new WebhookDeliveryNotFound({ deliveryId: input.deliveryId })
            )
          }
          if (!isReplayableDeliveryStatus(source.status)) {
            return yield* Effect.fail(
              new WebhookDispatchRejected({
                reason: `delivery is ${source.status}, only failed deliveries replay`
              })
            )
          }
          if (!source.enabled) {
            return yield* Effect.fail(
              new WebhookDispatchRejected({ reason: 'endpoint is disabled' })
            )
          }
          const deliveryId = yield* newCapabilityId('whd')
          const payload = source.payload
          yield* recordOperatorDispatch({
            deliveryId,
            workspaceId: ctx.workspace.id,
            plan: planReplayedDelivery({
              id: source.id,
              endpointId: source.endpointId,
              eventType: source.eventType,
              payload
            }),
            auditEvent: {
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              actorType: ctx.actorType,
              eventType: 'webhook.delivery_replayed',
              targetType: 'webhook_endpoint',
              targetId: source.endpointId,
              metadata: {
                deliveryId,
                replayedFrom: source.id,
                eventType: source.eventType
              }
            }
          })
          // The enqueue rides after the row: a queue outage fails the replay
          // visibly (`CapabilityUnavailable`) instead of leaving the operator
          // believing it was sent. The pending row stays until they retry.
          yield* publisher.enqueue({
            endpointId: source.endpointId,
            workspaceId: ctx.workspace.id,
            eventType: source.eventType,
            deliveryId,
            payload
          })
          return { deliveryId }
        }),
      sendTestEvent: (input) =>
        Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const endpoint = yield* endpointRow(input.endpointId, ctx.workspace.id)
          if (!endpoint) {
            return yield* Effect.fail(
              new WebhookEndpointNotFound({ endpointId: input.endpointId })
            )
          }
          if (!endpoint.enabled) {
            return yield* Effect.fail(
              new WebhookDispatchRejected({ reason: 'endpoint is disabled' })
            )
          }
          const now = yield* DateTime.now
          const payload = { test: true, sentAt: DateTime.formatIso(now) }
          const deliveryId = yield* newCapabilityId('whd')
          // No audit event: a test send is operator tooling, not a
          // security-relevant mutation — the delivery row itself is the record.
          yield* recordOperatorDispatch({
            deliveryId,
            workspaceId: ctx.workspace.id,
            plan: planPendingDispatch({
              endpointId: endpoint.id,
              eventType: WEBHOOK_TEST_EVENT_TYPE,
              payload
            })
          })
          yield* publisher.enqueue({
            endpointId: endpoint.id,
            workspaceId: ctx.workspace.id,
            eventType: WEBHOOK_TEST_EVENT_TYPE,
            deliveryId,
            payload
          })
          return { deliveryId }
        }),
      rotateSecret: (input) =>
        Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          // The row is read before the mutation so the secret being replaced
          // can move into the grace columns — a rotation is a shift, not an
          // overwrite: the old secret keeps signing for the grace window.
          const endpoint = yield* endpointRow(input.endpointId, ctx.workspace.id)
          if (!endpoint) {
            return yield* Effect.fail(
              new WebhookEndpointNotFound({ endpointId: input.endpointId })
            )
          }
          const rotatedAt = yield* DateTime.now
          const expiresAt = planSecretRotation(rotatedAt)
          // The replacement secret is minted inside `write`, so a zero-match
          // mutation still mints nothing.
          let signingSecret = ''
          yield* auditedMutation({
            matched: Effect.succeed(true),
            auditEvent: {
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              actorType: ctx.actorType,
              eventType: 'webhook_endpoint.secret_rotated',
              targetType: 'webhook_endpoint',
              targetId: input.endpointId,
              metadata: { previousSecretExpiresAt: expiresAt }
            },
            write: () => {
              signingSecret = randomWebhookSecret()
              return db
                .update(webhookEndpoints)
                .set({
                  signingSecret,
                  previousSigningSecret: endpoint.signingSecret,
                  previousSecretExpiresAt: expiresAt
                })
                .where(scopedEndpointWhere(input.endpointId, ctx.workspace.id))
            }
          })
          return { signingSecret }
        }),
      getDispatchTarget: (endpointId, workspaceId) =>
        Effect.gen(function* () {
          const endpoint = yield* endpointRow(endpointId, workspaceId)
          if (!endpoint || !endpoint.enabled) {
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
              {
                signingSecret: endpoint.signingSecret,
                previousSigningSecret: endpoint.previousSigningSecret,
                previousSecretExpiresAt: endpoint.previousSecretExpiresAt
              },
              yield* DateTime.now
            )
          }
        }),
      recordDeliveryAttempt: (input) => history.recordAttempt(input),
      recordTerminalDeliveryAttempt: (input) =>
        // The row id and payload travel in the queue message: the id resolves
        // the message's own attempt row (one row per message), and the
        // recorded payload is what makes a terminal row replayable. The
        // retry schedule clears; response evidence already on the row stays.
        history.recordAttempt({
          ...input,
          id: input.deliveryId,
          phase: 'terminal',
          nextAttemptAt: null
        })
    }
  })
)

/** The wire projection assembled once for both the fan-out payload and the return value. */
function toEndpointProjection(endpoint: {
  readonly id: string
  readonly url: string
  readonly enabled: boolean
  readonly events: ReadonlyArray<string>
}): WebhookEndpoint {
  return {
    id: endpoint.id,
    url: endpoint.url,
    enabled: endpoint.enabled,
    events: [...endpoint.events],
    successRate: 100
  }
}
