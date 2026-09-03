import { Database, type RawD1 } from '@b2b-saas-starter/db/service'
import {
  type JsonObject,
  type JsonValue,
  webhookDeliveries,
  webhookEndpoints
} from '@b2b-saas-starter/db/schema'
import { DateTime, Effect, Layer, Option } from 'effect'
import { and, asc, count, eq, sql, type SQL } from 'drizzle-orm'

import { assertWithinPlanLimitFor } from '../billing/plan-catalog.ts'
import { auditedMutations } from '../governance/audited-mutation.ts'
import {
  AuditEventLog,
  type RecordAuditEventInput
} from '../governance/audit-event-log.ts'
import { type CapabilityUnavailable } from '../errors.ts'
import {
  activeSigningSecrets,
  deadLetterNotification,
  deliverySuccessRate,
  isReplayableDeliveryStatus,
  planReplayedDelivery,
  planSecretRotation,
  terminalDeliveryAuditEventType,
  type Json,
  type WebhookDeliveryStatus
} from './webhook-delivery-plan.ts'
import { NotificationFeed } from '../notifications/notification-feed.ts'
import {
  ensureValidWebhookUrl,
  type UpdateWebhookEndpointInput,
  WEBHOOK_TEST_EVENT_TYPE,
  WebhookDispatchRejected,
  WebhookEndpointNotFound,
  WebhookDeliveryNotFound,
  WebhookEndpoints,
  type WebhookEndpoint
} from './webhook-endpoints.ts'
import { randomHex } from '../internal/crypto.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { clampPageLimit, cutKeysetPage } from '../internal/keyset-cursor.ts'
import { keysetResume } from '../internal/keyset-query.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { publishWebhookEventWith, WebhookPublisher } from './webhook-publisher.ts'
import { WorkspaceContext } from '../workspace-context.ts'

function randomSecret(): string {
  return `whsec_${randomHex(24)}`
}

const unavailable = orUnavailable('webhook-endpoints')

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
  Database | RawD1 | AuditEventLog | WebhookPublisher | NotificationFeed
> = Layer.effect(WebhookEndpoints)(
  Effect.gen(function* () {
    const db = yield* Database
    const audit = yield* AuditEventLog
    const publisher = yield* WebhookPublisher
    const notificationFeed = yield* NotificationFeed

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
     * The wire projection for one endpoint, success rate included — the same
     * aggregate shape `list` computes for every endpoint, over this one.
     */
    function endpointProjection(
      endpointId: string,
      workspaceId: string
    ): Effect.Effect<WebhookEndpoint | null, CapabilityUnavailable> {
      return unavailable(
        db
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
          .where(scopedEndpointWhere(endpointId, workspaceId))
          .groupBy(webhookEndpoints.id)
      ).pipe(
        Effect.map((rows) => {
          const row = rows[0]
          if (!row) {
            return null
          }
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
        })
      )
    }

    /**
     * The user-facing half of a dead-letter outcome: a broadcast notification
     * so every member's bell sees that an endpoint stopped receiving. Best
     * effort after the row + audit batch — a notification outage surfaces as
     * `CapabilityUnavailable` and the DLQ consumer acks anyway.
     */
    function notifyDeadLetter(input: {
      readonly endpointId: string
      readonly workspaceId: string
      readonly eventType: string
      readonly attempts: number
      readonly url: string
    }) {
      return notificationFeed.create({
        workspaceId: input.workspaceId,
        userId: null,
        kind: 'webhook.delivery_failed',
        ...deadLetterNotification({
          eventType: input.eventType,
          url: input.url,
          attempts: input.attempts
        })
      })
    }

    /**
     * One attempt row, upserted on its id so every redelivery of the same
     * queue message resolves the *same* row instead of forking identities (or
     * dying on the primary key): a replay's `pending` row, created before the
     * message was enqueued, is the row the consumer's first attempt updates.
     * Evidence columns (`payload`, `replayedFrom`) are insert-only — the set
     * clause carries attempt state alone, so a redelivery cannot erase the
     * link back to the row a replay came from.
     */
    function recordAttempt(input: {
      readonly id?: string
      readonly endpointId: string
      readonly workspaceId: string
      readonly eventType: string
      readonly status: WebhookDeliveryStatus
      readonly attempts: number
      readonly responseStatus?: number | null
      readonly nextAttemptAt?: string | null
      readonly payload?: Json
      readonly requestHeaders?: Record<string, string> | null
      readonly responseBody?: string | null
      readonly replayedFrom?: string | null
    }) {
      return Effect.gen(function* () {
        const deliveryId = input.id ?? (yield* newCapabilityId('whd'))
        const lastAttemptAt = yield* DateTime.now
        const deliveryInsert = db
          .insert(webhookDeliveries)
          .values({
            id: deliveryId,
            endpointId: input.endpointId,
            eventType: input.eventType,
            status: input.status,
            attempts: input.attempts,
            lastAttemptAt: DateTime.formatIso(lastAttemptAt),
            nextAttemptAt: input.nextAttemptAt ?? null,
            responseStatus: input.responseStatus ?? null,
            payload: input.payload ?? null,
            requestHeaders: input.requestHeaders ?? null,
            responseBody: input.responseBody ?? null,
            replayedFrom: input.replayedFrom ?? null
          })
          .onConflictDoUpdate({
            target: webhookDeliveries.id,
            set: {
              status: input.status,
              attempts: input.attempts,
              lastAttemptAt: DateTime.formatIso(lastAttemptAt),
              nextAttemptAt: input.nextAttemptAt ?? null,
              responseStatus: input.responseStatus ?? null,
              requestHeaders: input.requestHeaders ?? null,
              responseBody: input.responseBody ?? null
            }
          })
        const auditEventType = terminalDeliveryAuditEventType.get(input.status)
        if (auditEventType === undefined) {
          yield* unavailable(deliveryInsert)
          return deliveryId
        }
        // Terminal outcome: the attempt row and its audit event commit or roll
        // back together — the shared audited-mutation shape. `workspaceId`
        // comes from the queue message — verified against the endpoint by
        // `getDispatchTarget` on the delivery path, trusted as stamped by our
        // own publisher on the dead-letter path.
        yield* auditedMutation({
          matched: Effect.succeed(true),
          auditEvent: {
            workspaceId: input.workspaceId,
            actorUserId: null,
            eventType: auditEventType,
            targetType: 'webhook_endpoint',
            targetId: input.endpointId,
            metadata: {
              deliveryId,
              eventType: input.eventType,
              attempts: input.attempts,
              responseStatus: input.responseStatus ?? null
            }
          },
          write: () => deliveryInsert
        })
        // The dead-letter outcome additionally tells the workspace: the
        // notification names the endpoint URL so the message is actionable
        // without a query. Reads the endpoint row for it.
        if (input.status === 'dead_lettered') {
          const endpoint = yield* endpointRow(input.endpointId, input.workspaceId)
          if (endpoint) {
            yield* notifyDeadLetter({
              endpointId: endpoint.id,
              workspaceId: input.workspaceId,
              eventType: input.eventType,
              attempts: input.attempts,
              url: endpoint.url
            })
          }
        }
        return deliveryId
      })
    }

    /**
     * Creates the `pending` row an operator dispatch (replay, test send)
     * starts from, batching its audit event when there is one.
     */
    function recordOperatorDispatch(input: {
      readonly deliveryId: string
      readonly endpointId: string
      readonly workspaceId: string
      readonly eventType: string
      readonly payload: Json
      readonly replayedFrom?: string | undefined
      readonly auditEvent?: RecordAuditEventInput | undefined
    }) {
      return Effect.gen(function* () {
        const now = yield* DateTime.now
        const plan = planReplayedDelivery({
          id: input.replayedFrom ?? input.deliveryId,
          endpointId: input.endpointId,
          eventType: input.eventType,
          payload: input.payload
        })
        const insert = db.insert(webhookDeliveries).values({
          id: input.deliveryId,
          endpointId: plan.endpointId,
          eventType: plan.eventType,
          status: plan.status,
          attempts: plan.attempts,
          lastAttemptAt: DateTime.formatIso(now),
          nextAttemptAt: plan.nextAttemptAt,
          responseStatus: plan.responseStatus,
          payload: plan.payload,
          requestHeaders: null,
          responseBody: null,
          replayedFrom: input.replayedFrom ?? null
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
      list: Effect.gen(function* () {
        const ctx = yield* WorkspaceContext
        // Single grouped query: endpoints left-joined to their deliveries with
        // count/conditional-sum aggregates, instead of one delivery scan per
        // endpoint.
        const rows = yield* unavailable(
          db
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
            .where(eq(webhookEndpoints.workspaceId, ctx.workspace.id))
            .groupBy(webhookEndpoints.id)
        )
        return rows.map((row) => ({
          id: row.id,
          url: row.url,
          enabled: row.enabled,
          events: row.events,
          // `sql<number>` is an unchecked claim about what the driver hands back, not a
          // guarantee, so the coercion stays as runtime defence for the SUM column.
          // oxlint-disable-next-line typescript/no-unnecessary-type-conversion -- see above
          successRate: deliverySuccessRate(row.total, Number(row.delivered))
        }))
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
            db
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
              .where(and(...conditions))
              .groupBy(webhookEndpoints.id)
              .orderBy(asc(webhookEndpoints.id))
              .limit(limit + 1)
          )
          return cutKeysetPage(
            rows.map((row) => ({
              id: row.id,
              url: row.url,
              enabled: row.enabled,
              events: row.events,
              // oxlint-disable-next-line typescript/no-unnecessary-type-conversion -- the SUM column claim above is unchecked; see `list`
              successRate: deliverySuccessRate(row.total, Number(row.delivered))
            })),
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
          })
          const signingSecret = randomSecret()
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
              .orderBy(sql`${webhookDeliveries.lastAttemptAt} desc`)
              .limit(20)
          )
        }),
      disable: (input) =>
        Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          return yield* auditedMutation({
            matched: endpointExists(input.endpointId, ctx.workspace.id),
            auditEvent: {
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              eventType: 'webhook_endpoint.disabled',
              targetType: 'webhook_endpoint',
              targetId: input.endpointId,
              metadata: {}
            },
            write: () =>
              db
                .update(webhookEndpoints)
                .set({ enabled: false })
                .where(scopedEndpointWhere(input.endpointId, ctx.workspace.id))
          })
        }),
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
            return false
          }
          yield* auditedMutation({
            matched: Effect.succeed(true),
            auditEvent: {
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
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
          return true
        }),
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
          if (source.payload === null) {
            return yield* Effect.fail(
              new WebhookDispatchRejected({
                reason: 'delivery records no payload to re-send'
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
            endpointId: source.endpointId,
            workspaceId: ctx.workspace.id,
            eventType: source.eventType,
            payload,
            replayedFrom: source.id,
            auditEvent: {
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
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
            endpointId: endpoint.id,
            workspaceId: ctx.workspace.id,
            eventType: WEBHOOK_TEST_EVENT_TYPE,
            payload
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
            return Option.none()
          }
          const rotatedAt = yield* DateTime.now
          const expires = planSecretRotation(rotatedAt)
          // The replacement secret is minted inside `write`, so a zero-match
          // mutation still mints nothing — the interface promises that.
          let signingSecret = ''
          const applied = yield* auditedMutation({
            matched: Effect.succeed(true),
            auditEvent: {
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              eventType: 'webhook_endpoint.secret_rotated',
              targetType: 'webhook_endpoint',
              targetId: input.endpointId,
              metadata: { previousSecretExpiresAt: expires.previousSecretExpiresAt }
            },
            write: () => {
              signingSecret = randomSecret()
              return db
                .update(webhookEndpoints)
                .set({
                  signingSecret,
                  previousSigningSecret: endpoint.signingSecret,
                  previousSecretExpiresAt: expires.previousSecretExpiresAt
                })
                .where(scopedEndpointWhere(input.endpointId, ctx.workspace.id))
            }
          })
          if (!applied) {
            return Option.none()
          }
          return Option.some({ signingSecret })
        }),
      getDispatchTarget: (endpointId, workspaceId) =>
        Effect.gen(function* () {
          const endpoint = yield* endpointRow(endpointId, workspaceId)
          if (!endpoint || !endpoint.enabled) {
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
      recordDeliveryAttempt: (input) => recordAttempt(input).pipe(Effect.asVoid),
      recordTerminalDeliveryAttempt: Effect.fnUntraced(function* (input) {
        // The capability mints the row id — there is no signed payload to keep
        // in step with on a never-dispatched or exhausted message.
        const deliveryId = yield* recordAttempt(input)
        return { deliveryId }
      })
    }
  })
)

/** The wire projection assembled once for both the fan-out payload and the return value. */
export function toEndpointProjection(endpoint: {
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
