import { Database } from '@b2b-saas-starter/db/src/service.ts'
import { webhookDeliveries, webhookEndpoints } from '@b2b-saas-starter/db/src/schema.ts'
import { Context, DateTime, Duration, Effect, Layer, Option, Schema } from 'effect'
import { and, count, eq, sql } from 'drizzle-orm'

import { auditedMutations } from '../governance/audited-mutation.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { type AuditEventType } from '../governance/audit-event-taxonomy.ts'
import { assertWithinPlanLimit } from '../billing/billing.ts'
import { type CapabilityUnavailable, type PlanLimitExceeded } from '../errors.ts'
import { randomHex } from '../internal/crypto.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { publishWebhookEventWith, WebhookPublisher } from './webhook-publisher.ts'
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
 * The creation result: the projected endpoint plus the signing secret shown
 * once to the caller. The secret rides beside — never inside — the endpoint
 * projection, so adapters that publish the projection as an event payload
 * (`webhook_endpoint.created`) cannot leak it to the endpoint being registered.
 */
export type CreatedWebhookEndpoint = {
  readonly endpoint: WebhookEndpoint
  readonly signingSecret: string
}

/** A recorded delivery attempt, newest first in `listDeliveries`. */
export const WebhookDelivery = Schema.Struct({
  id: Schema.String,
  endpointId: Schema.String,
  eventType: Schema.String,
  status: Schema.String,
  attempts: Schema.Number,
  lastAttemptAt: Schema.NullOr(Schema.String),
  nextAttemptAt: Schema.NullOr(Schema.String),
  responseStatus: Schema.NullOr(Schema.Number)
})
export type WebhookDelivery = typeof WebhookDelivery.Type

export type ListWebhookDeliveriesInput = {
  readonly endpointId: string
}

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

/**
 * Redelivery backoff: 30s per attempt, capped at six attempts (180s). The
 * queue retry delay and the persisted `nextAttemptAt` are derived from this
 * one function, so the stored schedule matches when Cloudflare will actually
 * redeliver.
 */
export function backoffSeconds(attempts: number): number {
  return Math.min(attempts, 6) * 30
}

export type DeliveryDecision = 'delivered' | 'retry' | 'terminal'

/**
 * Ack/retry/terminal decision per response status. `0` means no HTTP response
 * (network error or timeout) and is retryable. 4xx responses are permanent
 * failures except 408 (request timeout) and 429 (rate limited).
 */
export function classifyResponseStatus(status: number): DeliveryDecision {
  if (status >= 200 && status < 300) return 'delivered'
  if (status === 408 || status === 429) return 'retry'
  if (status >= 400 && status < 500) return 'terminal'
  return 'retry'
}

/** Persisted `webhookDeliveries.status` for a dispatch decision. */
function deliveryStatus(
  decision: DeliveryDecision
): 'delivered' | 'failed_permanent' | 'failed' {
  if (decision === 'delivered') return 'delivered'
  if (decision === 'terminal') return 'failed_permanent'
  return 'failed'
}

/** `0` stands for "no HTTP response at all", which is persisted as null. */
function recordedResponseStatus(status: number): number | null {
  if (status === 0) return null
  return status
}

/** Everything a dispatch needs to persist its attempt row and answer the queue. */
export type DeliveryAttemptPlan = {
  readonly status: 'delivered' | 'failed_permanent' | 'failed'
  readonly responseStatus: number | null
  readonly nextAttemptAt: string | null
  readonly outcome: 'ack' | 'retry'
}

/**
 * The dispatch half of the delivery state machine, pure and owned here so the
 * background worker never re-derives it: classify the response status, map it
 * to the persisted vocabulary above, and derive the retry schedule from the
 * same `backoffSeconds` the queue consumer passes to `message.retry`. Terminal
 * outcomes have no next attempt.
 */
export function planDeliveryAttempt(
  responseStatus: number,
  attempts: number,
  now: DateTime.Utc
): DeliveryAttemptPlan {
  const decision = classifyResponseStatus(responseStatus)
  const status = deliveryStatus(decision)
  const recorded = recordedResponseStatus(responseStatus)
  if (decision !== 'retry') {
    return { status, responseStatus: recorded, nextAttemptAt: null, outcome: 'ack' }
  }
  const nextAttemptAt = DateTime.formatIso(
    DateTime.addDuration(now, Duration.seconds(backoffSeconds(attempts)))
  )
  return { status, responseStatus: recorded, nextAttemptAt, outcome: 'retry' }
}

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
export const terminalDeliveryAuditEventType = new Map<
  WebhookDeliveryStatus,
  AuditEventType
>([
  ['failed_permanent', 'webhook.delivery_failed'],
  ['dead_lettered', 'webhook.delivery_dead_lettered']
])

export type CreateWebhookEndpointInput = {
  readonly url: string
  readonly events: readonly string[]
  // `| undefined` on purpose: callers read `description` off an optional request
  // field, and both adapters treat an absent key and an explicit `undefined` the
  // same way. Without it every caller has to hand-build the input key by key.
  readonly description?: string | undefined
  readonly actorUserId?: string
}

/**
 * The event types this starter currently publishes (the mutating capabilities
 * fan out below their interface — `ApiTokenRegistry` and this module's
 * `create`). Subscriptions are free-text strings so a producer can grow
 * without a migration; this list is what the management UI offers as
 * checkboxes.
 */
export type WebhookEventType =
  | 'api_token.created'
  | 'api_token.revoked'
  | 'webhook_endpoint.created'

// oxlint-disable-next-line effect/noAs -- a const assertion, not a type assertion
export const WEBHOOK_EVENT_TYPES = [
  'api_token.created',
  'api_token.revoked',
  'webhook_endpoint.created'
] as const satisfies readonly WebhookEventType[]

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

export type WebhookEndpointsInterface = {
  readonly list: Effect.Effect<
    readonly WebhookEndpoint[],
    CapabilityUnavailable,
    WorkspaceContext
  >

  readonly create: (
    input: CreateWebhookEndpointInput
  ) => Effect.Effect<
    CreatedWebhookEndpoint,
    CapabilityUnavailable | InvalidWebhookUrl | PlanLimitExceeded,
    WorkspaceContext
  >

  /**
   * Recent delivery attempts for one of this workspace's endpoints, newest
   * first. Workspace scoping comes from `WorkspaceContext`; an endpoint id
   * from another workspace yields an empty list, never its deliveries.
   */
  readonly listDeliveries: (
    input: ListWebhookDeliveriesInput
  ) => Effect.Effect<
    readonly WebhookDelivery[],
    CapabilityUnavailable,
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

  /**
   * Terminal delivery rows for outcomes that never dispatched (the SSRF guard
   * rejected the endpoint URL at dispatch time) or exhausted the queue (dead
   * letter). The capability owns the whole row — delivery id minting, the
   * timestamp, and the terminal audit event batched with it — so callers hand
   * over only what the queue message carries and cannot assemble a half-shaped
   * attempt input.
   */
  readonly recordTerminalDeliveryAttempt: (input: {
    readonly endpointId: string
    readonly workspaceId: string
    readonly eventType: string
    readonly attempts: number
    readonly status: 'failed_permanent' | 'dead_lettered'
  }) => Effect.Effect<{ readonly deliveryId: string }, CapabilityUnavailable>
}

export class WebhookEndpoints extends Context.Service<
  WebhookEndpoints,
  WebhookEndpointsInterface
>()('@b2b-saas-starter/capabilities/WebhookEndpoints') {}

// Shared SSRF/shape guard — both layers must reject the same URLs so tests
// against Seed exercise the same contract as Live.
function ensureValidWebhookUrl(url: string): Effect.Effect<void, InvalidWebhookUrl> {
  const check = validateWebhookUrl(url)
  if (check.valid) return Effect.void
  return Effect.fail(new InvalidWebhookUrl({ url, reason: check.reason }))
}

/**
 * A Seed fixture row: the wire projection plus the storage columns the
 * projection deliberately hides but the delivery path needs (the plaintext
 * signing secret `getDispatchTarget` hands the worker, and the owning
 * workspace so cross-workspace messages resolve `null` like Live). Absent
 * fields take fixed fixture defaults.
 */
export type SeedWebhookEndpointFixture = WebhookEndpoint & {
  readonly signingSecret?: string
  readonly workspaceId?: string
}

/** Owning workspace of fixture endpoints without an explicit one. Matches `seedWorkspaceRecord.id`; kept literal to avoid a fixture import cycle. */
const SEED_WORKSPACE_ID = 'wrk_starter'

type SeedEndpointRow = {
  readonly id: string
  readonly workspaceId: string
  readonly url: string
  enabled: boolean
  readonly events: readonly string[]
  readonly successRate: number
  signingSecret: string
}

type SeedDeliveryRow = {
  readonly id: string
  readonly endpointId: string
  readonly workspaceId: string
  readonly eventType: string
  readonly status: WebhookDeliveryStatus
  readonly attempts: number
  readonly lastAttemptAt: string
  readonly nextAttemptAt: string | null
  readonly responseStatus: number | null
  /** Insertion order — the tie-break when rows share a `lastAttemptAt`. */
  readonly seq: number
}

export function SeedWebhookEndpoints(
  seedFixtures: readonly SeedWebhookEndpointFixture[]
): Layer.Layer<WebhookEndpoints, never, AuditEventLog | WebhookPublisher> {
  return Layer.effect(WebhookEndpoints)(
    Effect.gen(function* () {
      const audit = yield* AuditEventLog
      const publisher = yield* WebhookPublisher
      // Mutable stores, so Seed mirrors Live's post-conditions — a created
      // endpoint becomes dispatchable, a recorded attempt becomes listable,
      // the plan gate can actually trip. The membership seed roster sets the
      // same precedent; contract cases run unmodified against both adapters.
      const endpoints: SeedEndpointRow[] = seedFixtures.map((fixture) => ({
        id: fixture.id,
        workspaceId: fixture.workspaceId ?? SEED_WORKSPACE_ID,
        url: fixture.url,
        enabled: fixture.enabled,
        events: [...fixture.events],
        successRate: fixture.successRate,
        signingSecret: fixture.signingSecret ?? 'whsec_seed_fixture'
      }))
      const deliveries: SeedDeliveryRow[] = []
      let deliverySeq = 0

      /** Next insertion sequence — the newest-first tie-break in listDeliveries. */
      function nextSeq(): number {
        deliverySeq += 1
        return deliverySeq
      }

      function endpointFor(endpointId: string, workspaceId: string) {
        return (
          endpoints.find(
            (endpoint) =>
              endpoint.id === endpointId && endpoint.workspaceId === workspaceId
          ) ?? null
        )
      }

      function inWorkspace(endpointId: string) {
        return Effect.map(WorkspaceContext, (ctx) =>
          endpointFor(endpointId, ctx.workspace.id)
        )
      }

      /** Shared persistence for both attempt surfaces, terminal audits included. */
      const persistAttempt = Effect.fnUntraced(function* (row: SeedDeliveryRow) {
        deliveries.push(row)
        const auditEventType = terminalDeliveryAuditEventType.get(row.status)
        if (auditEventType !== undefined) {
          yield* audit.record({
            workspaceId: row.workspaceId,
            actorUserId: null,
            eventType: auditEventType,
            targetType: 'webhook_endpoint',
            targetId: row.endpointId,
            metadata: {
              deliveryId: row.id,
              eventType: row.eventType,
              attempts: row.attempts,
              responseStatus: row.responseStatus
            }
          })
        }
      })

      return {
        list: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const projections: WebhookEndpoint[] = []
          for (const endpoint of endpoints) {
            if (endpoint.workspaceId !== ctx.workspace.id) continue
            projections.push({
              id: endpoint.id,
              url: endpoint.url,
              enabled: endpoint.enabled,
              events: [...endpoint.events],
              successRate: endpoint.successRate
            })
          }
          return projections
        }),
        create: Effect.fnUntraced(function* (input) {
          yield* ensureValidWebhookUrl(input.url)
          const ctx = yield* WorkspaceContext
          // Same entitlement gate as Live — and because the store mutates, the
          // cap can actually trip here instead of being unreachable.
          yield* assertWithinPlanLimit({
            resource: 'webhook_endpoint',
            used: endpoints.filter(
              (endpoint) => endpoint.workspaceId === ctx.workspace.id
            ).length
          })
          const endpoint: SeedEndpointRow = {
            id: yield* newCapabilityId('wh'),
            workspaceId: ctx.workspace.id,
            url: input.url,
            enabled: true,
            events: [...input.events],
            successRate: 100,
            signingSecret: 'whsec_seed_created'
          }
          endpoints.push(endpoint)
          yield* audit.record({
            workspaceId: ctx.workspace.id,
            actorUserId: input.actorUserId ?? null,
            eventType: 'webhook_endpoint.created',
            targetType: 'webhook_endpoint',
            targetId: endpoint.id,
            metadata: { url: input.url, events: input.events }
          })
          // The projection, never the signing secret.
          yield* publishWebhookEventWith(publisher, {
            eventType: 'webhook_endpoint.created',
            payload: {
              id: endpoint.id,
              url: endpoint.url,
              enabled: endpoint.enabled,
              events: [...endpoint.events],
              successRate: endpoint.successRate
            }
          })
          return {
            endpoint: {
              id: endpoint.id,
              url: endpoint.url,
              enabled: endpoint.enabled,
              events: [...endpoint.events],
              successRate: endpoint.successRate
            },
            signingSecret: endpoint.signingSecret
          }
        }),
        listDeliveries: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            // Same join semantics as Live: the endpoint's owning workspace is
            // resolved from context, so a foreign endpoint id yields nothing.
            const owned = new Set<string>()
            for (const endpoint of endpoints) {
              if (endpoint.workspaceId === ctx.workspace.id) {
                owned.add(endpoint.id)
              }
            }
            const matched = deliveries.filter(
              (row) => row.endpointId === input.endpointId && owned.has(row.endpointId)
            )
            // `lastAttemptAt` DESC, insertion recency as the tie-break —
            // mirrors Live's `orderBy(lastAttemptAt desc)` read.
            matched.sort((a, b) => {
              if (a.lastAttemptAt > b.lastAttemptAt) return -1
              if (a.lastAttemptAt < b.lastAttemptAt) return 1
              return b.seq - a.seq
            })
            return matched.slice(0, 20)
          }),
        disable: (input) =>
          Effect.gen(function* () {
            const endpoint = yield* inWorkspace(input.endpointId)
            if (!endpoint || !endpoint.enabled) return false
            endpoint.enabled = false
            const ctx = yield* WorkspaceContext
            yield* audit.record({
              workspaceId: ctx.workspace.id,
              actorUserId: input.actorUserId ?? null,
              eventType: 'webhook_endpoint.disabled',
              targetType: 'webhook_endpoint',
              targetId: endpoint.id,
              metadata: {}
            })
            return true
          }),
        rotateSecret: (input) =>
          Effect.gen(function* () {
            const endpoint = yield* inWorkspace(input.endpointId)
            if (!endpoint) return Option.none()
            endpoint.signingSecret = 'whsec_seed_rotated'
            const ctx = yield* WorkspaceContext
            yield* audit.record({
              workspaceId: ctx.workspace.id,
              actorUserId: input.actorUserId ?? null,
              eventType: 'webhook_endpoint.secret_rotated',
              targetType: 'webhook_endpoint',
              targetId: endpoint.id,
              metadata: {}
            })
            return Option.some({ signingSecret: endpoint.signingSecret })
          }),
        getDispatchTarget: (endpointId, workspaceId) =>
          Effect.sync(() => {
            const endpoint = endpointFor(endpointId, workspaceId)
            if (!endpoint || !endpoint.enabled) return null
            return {
              id: endpoint.id,
              url: endpoint.url,
              signingSecret: endpoint.signingSecret
            }
          }),
        recordDeliveryAttempt: Effect.fnUntraced(function* (input) {
          const deliveryId = input.id ?? (yield* newCapabilityId('whd'))
          yield* persistAttempt({
            id: deliveryId,
            endpointId: input.endpointId,
            workspaceId: input.workspaceId,
            eventType: input.eventType,
            status: input.status,
            attempts: input.attempts,
            lastAttemptAt: DateTime.formatIso(yield* DateTime.now),
            nextAttemptAt: input.nextAttemptAt ?? null,
            responseStatus: input.responseStatus ?? null,
            seq: nextSeq()
          })
        }),
        recordTerminalDeliveryAttempt: Effect.fnUntraced(function* (input) {
          const deliveryId = yield* newCapabilityId('whd')
          yield* persistAttempt({
            id: deliveryId,
            endpointId: input.endpointId,
            workspaceId: input.workspaceId,
            eventType: input.eventType,
            status: input.status,
            attempts: input.attempts,
            lastAttemptAt: DateTime.formatIso(yield* DateTime.now),
            nextAttemptAt: null,
            responseStatus: null,
            seq: nextSeq()
          })
          return { deliveryId }
        })
      }
    })
  )
}

function randomSecret(): string {
  return `whsec_${randomHex(24)}`
}

/** An endpoint with no delivery attempts yet reports a full success rate. */
function deliverySuccessRate(total: number, delivered: number): number {
  if (total === 0) return 100
  return Math.round((delivered / total) * 100)
}

const unavailable = orUnavailable('webhook-endpoints')

export const LiveWebhookEndpoints: Layer.Layer<
  WebhookEndpoints,
  never,
  Database | AuditEventLog | WebhookPublisher
> = Layer.effect(WebhookEndpoints)(
  Effect.gen(function* () {
    const db = yield* Database
    const audit = yield* AuditEventLog
    const publisher = yield* WebhookPublisher

    // The shared mutate+audit combinator — one implementation of the batched
    // write, its zero-match skip, and the phantom-audit caveat (see
    // governance/audited-mutation.ts).
    const auditedMutation = auditedMutations({
      db,
      prepareAuditRecord: audit.prepareRecord,
      unavailable
    })

    function endpointExists(endpointId: string, workspaceId: string) {
      return unavailable(
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
    }

    /**
     * One attempt row; terminal statuses batch their audit event with it.
     * Resolves the persisted delivery id so `recordTerminalDeliveryAttempt`
     * can hand back what it minted.
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
      create: (input) =>
        Effect.gen(function* () {
          yield* ensureValidWebhookUrl(input.url)
          const ctx = yield* WorkspaceContext
          // Entitlement gate: the workspace's plan caps endpoint count. The
          // rule lives in the billing capability; the counting lives here.
          const existingCount = yield* unavailable(
            db
              .select({ value: count() })
              .from(webhookEndpoints)
              .where(eq(webhookEndpoints.workspaceId, ctx.workspace.id))
          )
          yield* assertWithinPlanLimit({
            resource: 'webhook_endpoint',
            used: existingCount[0]?.value ?? 0
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
            events: [...input.events],
            createdAt: DateTime.formatIso(createdAt)
          }
          // Insert + audit insert as one batch — the shared audited-mutation
          // shape with an unconditional match.
          yield* auditedMutation({
            matched: Effect.succeed(true),
            auditEvent: {
              workspaceId: ctx.workspace.id,
              actorUserId: input.actorUserId ?? null,
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
            payload: {
              id: endpoint.id,
              url: endpoint.url,
              enabled: endpoint.enabled,
              events: endpoint.events,
              successRate: 100
            }
          })
          return {
            endpoint: {
              id: endpoint.id,
              url: endpoint.url,
              enabled: endpoint.enabled,
              events: endpoint.events,
              successRate: 100
            },
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
              actorUserId: input.actorUserId ?? null,
              eventType: 'webhook_endpoint.disabled',
              targetType: 'webhook_endpoint',
              targetId: input.endpointId,
              metadata: {}
            },
            write: () =>
              db
                .update(webhookEndpoints)
                .set({ enabled: false })
                .where(
                  and(
                    eq(webhookEndpoints.id, input.endpointId),
                    eq(webhookEndpoints.workspaceId, ctx.workspace.id)
                  )
                )
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
              actorUserId: input.actorUserId ?? null,
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
                .where(
                  and(
                    eq(webhookEndpoints.id, input.endpointId),
                    eq(webhookEndpoints.workspaceId, ctx.workspace.id)
                  )
                )
            }
          })
          if (!applied) return Option.none()
          return Option.some({ signingSecret })
        }),
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
