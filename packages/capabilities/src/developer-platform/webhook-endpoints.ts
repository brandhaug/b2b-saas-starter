import { Context, Effect, Layer, Option, Schema } from 'effect'
import { and, count, eq, sql } from 'drizzle-orm'
import {
  batch,
  Database,
  webhookDeliveries,
  webhookEndpoints
} from '@b2b-saas-starter/db'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import type { CapabilityUnavailable } from '../errors.ts'
import { randomHex } from '../internal/crypto.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { InvalidWebhookUrl, validateWebhookUrl } from './webhook-url.ts'
import { WorkspaceContext } from '../workspace-context.ts'

export const WebhookEndpoint = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  enabled: Schema.Boolean,
  events: Schema.Array(Schema.String),
  successRate: Schema.Number
})
export type WebhookEndpoint = typeof WebhookEndpoint.Type

/**
 * Delivery status vocabulary (free-text column, keep these values consistent):
 * - `delivered` — 2xx response.
 * - `failed` — retryable failure (5xx, 408, 429, network error, timeout); the
 *   queue will redeliver and `nextAttemptAt` is set.
 * - `failed_permanent` — terminal failure (non-retryable 4xx, or the endpoint
 *   URL failed the SSRF guard at dispatch); the message is acked.
 * - `dead_lettered` — the message exhausted `maxRetries` and was consumed from
 *   the dead-letter queue.
 */
export type WebhookDeliveryStatus =
  | 'delivered'
  | 'failed'
  | 'failed_permanent'
  | 'dead_lettered'

export type WebhookDeliveryAttemptInput = {
  /**
   * Delivery row id. The background worker mints it before dispatch so the
   * signed payload's `deliveryId` matches the persisted row. Generated here
   * when omitted.
   */
  readonly id?: string
  readonly endpointId: string
  /**
   * Owning workspace of the endpoint, carried in the queue message. Terminal
   * statuses use it to scope their audit event.
   */
  readonly workspaceId: string
  readonly eventType: string
  readonly status: WebhookDeliveryStatus
  readonly attempts: number
  readonly responseStatus?: number | null
  readonly nextAttemptAt?: string | null
}

/**
 * Audit event emitted per terminal delivery status — retryable attempts stay
 * out of the governance log. Naming follows the `auth.sign_in` /
 * `auth.sign_in_failed` convention from the web app's auth audit.
 */
export const terminalDeliveryAuditEventType: Partial<
  Record<WebhookDeliveryStatus, string>
> = {
  failed_permanent: 'webhook.delivery_failed',
  dead_lettered: 'webhook.delivery_dead_lettered'
}

export type CreateWebhookEndpointInput = {
  readonly url: string
  readonly events: readonly string[]
  readonly description?: string
  readonly actorUserId?: string
}

/** Wire payload for endpoint creation, shared by the REST contract and the API worker. */
export const CreateWebhookEndpointPayload = Schema.Struct({
  url: Schema.String,
  events: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
  description: Schema.optional(Schema.String)
})
export type CreateWebhookEndpointPayload = typeof CreateWebhookEndpointPayload.Type

export type DisableWebhookEndpointInput = {
  readonly endpointId: string
  readonly actorUserId?: string
}

export type RotateWebhookSecretInput = {
  readonly endpointId: string
  readonly actorUserId?: string
}

export type WebhookEndpointsShape = {
  readonly list: Effect.Effect<
    readonly WebhookEndpoint[],
    CapabilityUnavailable,
    WorkspaceContext
  >
  readonly create: (
    input: CreateWebhookEndpointInput
  ) => Effect.Effect<
    WebhookEndpoint,
    CapabilityUnavailable | InvalidWebhookUrl,
    WorkspaceContext
  >
  /** Resolves `true` when an endpoint was disabled, `false` when nothing matched. */
  readonly disable: (
    input: DisableWebhookEndpointInput
  ) => Effect.Effect<boolean, CapabilityUnavailable, WorkspaceContext>
  /**
   * Resolves `Option.some({ signingSecret })` with the newly persisted secret,
   * or `Option.none()` when no endpoint matched in this workspace (no secret
   * is minted in that case).
   */
  readonly rotateSecret: (
    input: RotateWebhookSecretInput
  ) => Effect.Effect<
    Option.Option<{ readonly signingSecret: string }>,
    CapabilityUnavailable,
    WorkspaceContext
  >
  /**
   * Background-worker surface — no `WorkspaceContext` exists on the queue
   * consumer, so the workspace ID travels in the queue message (stamped by
   * `WebhookPublisher` from the producing request's context) and is verified
   * here: the lookup filters on `(endpointId, workspaceId)` and resolves
   * `null` on a cross-workspace mismatch, so a forged or misrouted message
   * never yields another workspace's signing secret.
   */
  readonly getDispatchTarget: (
    endpointId: string,
    workspaceId: string
  ) => Effect.Effect<
    {
      readonly id: string
      readonly url: string
      readonly signingSecret: string
    } | null,
    CapabilityUnavailable
  >
  readonly recordDeliveryAttempt: (
    input: WebhookDeliveryAttemptInput
  ) => Effect.Effect<void, CapabilityUnavailable>
}

export class WebhookEndpoints extends Context.Service<
  WebhookEndpoints,
  WebhookEndpointsShape
>()('@b2b-saas-starter/capabilities/WebhookEndpoints') {}

// Shared SSRF/shape guard — both layers must reject the same URLs so tests
// against Seed exercise the same contract as Live.
const ensureValidWebhookUrl = (url: string): Effect.Effect<void, InvalidWebhookUrl> => {
  const check = validateWebhookUrl(url)
  return check.valid
    ? Effect.void
    : Effect.fail(new InvalidWebhookUrl({ url, reason: check.reason }))
}

export const SeedWebhookEndpoints = (
  seed: readonly WebhookEndpoint[]
): Layer.Layer<WebhookEndpoints> =>
  Layer.succeed(WebhookEndpoints)({
    list: Effect.succeed(seed),
    create: (input) =>
      ensureValidWebhookUrl(input.url).pipe(
        Effect.as({
          id: `wh_${Date.now()}`,
          url: input.url,
          enabled: true,
          events: [...input.events],
          successRate: 100
        })
      ),
    disable: (input) =>
      Effect.succeed(seed.some((endpoint) => endpoint.id === input.endpointId)),
    rotateSecret: (input) =>
      Effect.succeed(
        seed.some((endpoint) => endpoint.id === input.endpointId)
          ? Option.some({ signingSecret: 'whsec_seed_rotated' })
          : Option.none()
      ),
    getDispatchTarget: () => Effect.succeed(null),
    recordDeliveryAttempt: () => Effect.void
  })

const randomSecret = (): string => `whsec_${randomHex(24)}`

const unavailable = orUnavailable('webhook-endpoints')

export const LiveWebhookEndpoints: Layer.Layer<
  WebhookEndpoints,
  never,
  Database | AuditEventLog
> = Layer.effect(WebhookEndpoints)(
  Effect.gen(function* () {
    const db = yield* Database
    const audit = yield* AuditEventLog

    const endpointInWorkspace = (endpointId: string, workspaceId: string) =>
      unavailable(
        db
          .select({ id: webhookEndpoints.id })
          .from(webhookEndpoints)
          .where(
            and(
              eq(webhookEndpoints.id, endpointId),
              eq(webhookEndpoints.workspaceId, workspaceId)
            )
          )
          .limit(1)
      ).pipe(Effect.map((rows) => rows.length > 0))

    /**
     * One audited endpoint mutation: verify the endpoint belongs to the
     * calling workspace, then run the update and its audit insert as one D1
     * batch. Resolves the applied `set` values, or `Option.none()` (skipping
     * both writes and the `makeSet` thunk) when no endpoint matched.
     *
     * This is check-then-act, not atomic: a concurrent delete between the
     * lookup and the batch can make the UPDATE match zero rows while the
     * audit insert still commits — a phantom audit row. `batch` discards
     * per-statement results, so the update's row count can't gate the audit
     * insert inside the same batch; the starter accepts that narrow race.
     * What the shape does guarantee is workspace scoping: every mutation's
     * where clause re-applies `(id, workspaceId)`, so a foreign workspace's
     * endpoint is never mutated even when this pre-check goes stale.
     */
    const auditedEndpointUpdate = <
      S extends Partial<typeof webhookEndpoints.$inferInsert>
    >(
      input: { readonly endpointId: string; readonly actorUserId?: string },
      eventType: string,
      makeSet: () => S
    ): Effect.Effect<Option.Option<S>, CapabilityUnavailable, WorkspaceContext> =>
      Effect.gen(function* () {
        const ctx = yield* WorkspaceContext
        const exists = yield* endpointInWorkspace(input.endpointId, ctx.workspace.id)
        if (!exists) return Option.none()
        const set = makeSet()
        yield* unavailable(
          batch(db, [
            db
              .update(webhookEndpoints)
              .set(set)
              .where(
                and(
                  eq(webhookEndpoints.id, input.endpointId),
                  eq(webhookEndpoints.workspaceId, ctx.workspace.id)
                )
              ),
            audit.prepareRecord({
              workspaceId: ctx.workspace.id,
              actorUserId: input.actorUserId ?? null,
              eventType,
              targetType: 'webhook_endpoint',
              targetId: input.endpointId,
              metadata: {}
            })
          ])
        )
        return Option.some(set)
      })

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
          successRate:
            row.total === 0
              ? 100
              : Math.round((Number(row.delivered) / row.total) * 100)
        }))
      }),
      create: (input) =>
        Effect.gen(function* () {
          yield* ensureValidWebhookUrl(input.url)
          const ctx = yield* WorkspaceContext
          const signingSecret = randomSecret()
          const endpoint = {
            id: newCapabilityId('wh'),
            workspaceId: ctx.workspace.id,
            url: input.url,
            description: input.description,
            signingSecret,
            enabled: true,
            events: [...input.events],
            createdAt: new Date().toISOString()
          }
          yield* unavailable(
            batch(db, [
              db.insert(webhookEndpoints).values(endpoint),
              audit.prepareRecord({
                workspaceId: ctx.workspace.id,
                actorUserId: input.actorUserId ?? null,
                eventType: 'webhook_endpoint.created',
                targetType: 'webhook_endpoint',
                targetId: endpoint.id,
                metadata: { url: input.url, events: input.events }
              })
            ])
          )
          return {
            id: endpoint.id,
            url: endpoint.url,
            enabled: endpoint.enabled,
            events: endpoint.events,
            successRate: 100
          }
        }),
      disable: (input) =>
        auditedEndpointUpdate(input, 'webhook_endpoint.disabled', () => ({
          enabled: false
        })).pipe(Effect.map(Option.isSome)),
      rotateSecret: (input) =>
        auditedEndpointUpdate(input, 'webhook_endpoint.secret_rotated', () => ({
          signingSecret: randomSecret()
        })).pipe(
          Effect.map((applied) =>
            Option.map(applied, (set) => ({ signingSecret: set.signingSecret }))
          )
        ),
      getDispatchTarget: (endpointId, workspaceId) =>
        unavailable(
          db
            .select()
            .from(webhookEndpoints)
            .where(
              and(
                eq(webhookEndpoints.id, endpointId),
                eq(webhookEndpoints.workspaceId, workspaceId)
              )
            )
            .limit(1)
        ).pipe(
          Effect.map((rows) => {
            const endpoint = rows[0]
            if (!endpoint || !endpoint.enabled) return null
            return {
              id: endpoint.id,
              url: endpoint.url,
              signingSecret: endpoint.signingSecret
            }
          })
        ),
      recordDeliveryAttempt: (input) => {
        const deliveryId = input.id ?? newCapabilityId('whd')
        const deliveryInsert = db.insert(webhookDeliveries).values({
          id: deliveryId,
          endpointId: input.endpointId,
          eventType: input.eventType,
          status: input.status,
          attempts: input.attempts,
          lastAttemptAt: new Date().toISOString(),
          nextAttemptAt: input.nextAttemptAt ?? null,
          responseStatus: input.responseStatus ?? null
        })
        const auditEventType = terminalDeliveryAuditEventType[input.status]
        if (auditEventType === undefined) {
          return unavailable(deliveryInsert).pipe(Effect.asVoid)
        }
        // Terminal outcome: the attempt row and its audit event commit or roll
        // back together, mirroring ApiTokenRegistry's mutation+audit batches.
        // `workspaceId` comes from the queue message — verified against the
        // endpoint by `getDispatchTarget` on the delivery path, trusted as
        // stamped by our own publisher on the dead-letter path.
        return unavailable(
          batch(db, [
            deliveryInsert,
            audit.prepareRecord({
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
            })
          ])
        ).pipe(Effect.asVoid)
      }
    }
  })
)
