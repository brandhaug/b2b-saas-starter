import { Database, type RawD1 } from '@b2b-saas-starter/db/service'
import { webhookDeliveries, webhookEndpoints } from '@b2b-saas-starter/db/schema'
import { DateTime, Effect, Layer, Option } from 'effect'
import { and, asc, count, eq, gt, sql, type SQL } from 'drizzle-orm'

import { assertWithinPlanLimitFor } from '../billing/plan-catalog.ts'
import { auditedMutations } from '../governance/audited-mutation.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import {
  terminalDeliveryAuditEventType,
  type WebhookDeliveryStatus
} from './webhook-delivery-plan.ts'
import {
  ensureValidWebhookUrl,
  WebhookEndpoints,
  type WebhookEndpoint
} from './webhook-endpoints.ts'
import { randomHex } from '../internal/crypto.ts'
import { newCapabilityId } from '../internal/ids.ts'
import {
  clampPageLimit,
  cutKeysetPage,
  decodeKeysetCursor
} from '../internal/keyset-cursor.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { publishWebhookEventWith, WebhookPublisher } from './webhook-publisher.ts'
import { WorkspaceContext } from '../workspace-context.ts'

function randomSecret(): string {
  return `whsec_${randomHex(24)}`
}

/** An endpoint with no delivery attempts yet reports a full success rate. */
function deliverySuccessRate(total: number, delivered: number): number {
  if (total === 0) {
    return 100
  }
  return Math.round((delivered / total) * 100)
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

export const LiveWebhookEndpoints: Layer.Layer<
  WebhookEndpoints,
  never,
  Database | RawD1 | AuditEventLog | WebhookPublisher
> = Layer.effect(WebhookEndpoints)(
  Effect.gen(function* () {
    const db = yield* Database
    const audit = yield* AuditEventLog
    const publisher = yield* WebhookPublisher

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

    /** One attempt row; terminal statuses batch their audit event with it. ... */
    function recordAttempt(input: {
      readonly id?: string
      readonly endpointId: string
      readonly workspaceId: string
      readonly eventType: string
      readonly status: WebhookDeliveryStatus
      readonly attempts: number
      readonly responseStatus?: number | null
      readonly nextAttemptAt?: string | null
    }) {
      return Effect.gen(function* () {
        const deliveryId = input.id ?? (yield* newCapabilityId('whd'))
        const lastAttemptAt = yield* DateTime.now
        const deliveryInsert = db.insert(webhookDeliveries).values({
          id: deliveryId,
          endpointId: input.endpointId,
          eventType: input.eventType,
          status: input.status,
          attempts: input.attempts,
          lastAttemptAt: DateTime.formatIso(lastAttemptAt),
          nextAttemptAt: input.nextAttemptAt ?? null,
          responseStatus: input.responseStatus ?? null
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
        return deliveryId
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
          // stable order a page can resume is the id itself; a cursor is
          // then every endpoint with a strictly greater id.
          if (input?.cursor !== undefined) {
            const cursor = decodeKeysetCursor(input.cursor)
            if (cursor === null) {
              return { items: [], nextCursor: null }
            }
            conditions.push(gt(webhookEndpoints.id, cursor.id))
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
                responseStatus: webhookDeliveries.responseStatus
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
      rotateSecret: (input) =>
        Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          // The replacement secret is minted inside `write`, so a zero-match
          // mutation still mints nothing — the interface promises that.
          let signingSecret = ''
          const applied = yield* auditedMutation({
            matched: endpointExists(input.endpointId, ctx.workspace.id),
            auditEvent: {
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              eventType: 'webhook_endpoint.secret_rotated',
              targetType: 'webhook_endpoint',
              targetId: input.endpointId,
              metadata: {}
            },
            write: () => {
              signingSecret = randomSecret()
              return db
                .update(webhookEndpoints)
                .set({ signingSecret })
                .where(scopedEndpointWhere(input.endpointId, ctx.workspace.id))
            }
          })
          if (!applied) {
            return Option.none()
          }
          return Option.some({ signingSecret })
        }),
      getDispatchTarget: (endpointId, workspaceId) =>
        unavailable(
          db
            .select()
            .from(webhookEndpoints)
            .where(scopedEndpointWhere(endpointId, workspaceId))
            .limit(1)
        ).pipe(
          Effect.map((rows) => {
            const endpoint = rows[0]
            if (!endpoint || !endpoint.enabled) {
              return null
            }
            return {
              id: endpoint.id,
              url: endpoint.url,
              signingSecret: endpoint.signingSecret
            }
          })
        ),
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
