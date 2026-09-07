import {
  SeedResourceInventory,
  SeedResourceInventoryLayer
} from '../billing/resource-inventory.seed.ts'
import { Billing } from '../billing/billing.ts'
import { bestEffort } from '../internal/best-effort.ts'
import { attemptEvidence } from './webhook-attempt-history.ts'
import { DateTime, Duration, Effect, Layer } from 'effect'
import { randomWebhookSecret } from '../crypto.ts'

import { assertWithinPlanLimit } from '../billing/resource-admission.ts'
import { ResourceEntitlements } from '../billing/resource-entitlements.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { seedKeysetPage } from '../internal/keyset-cursor.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { type JsonValue } from '@b2b-saas-starter/db/schema'
import { NotificationFeed } from '../notifications/notification-feed.ts'
import {
  activeSigningSecrets,
  DELIVERY_HISTORY_CLEANUP_LIMIT,
  DELIVERY_HISTORY_RETENTION_DAYS,
  type WebhookDeliveryAttempt,
  type WebhookDeliveryAttemptInput,
  deadLetterNotification,
  failureLadderAction,
  DELIVERIES_PAGE_SIZE,
  deliverySuccessRate,
  isReplayableDeliveryStatus,
  nextConsecutiveFailures,
  planPendingDispatch,
  planReplayedDelivery,
  planSecretRotation,
  terminalDeliveryAuditEventType,
  WEBHOOK_FAILURE_AUTO_DISABLE_AT,
  type Json,
  type PendingDispatchPlan,
  type SeedWebhookDeliveryFixture,
  type WebhookDeliveryStatus
} from './webhook-delivery-plan.ts'
import {
  ensureValidWebhookUrl,
  planAdminReplay,
  type AdminReplaySource,
  TERMINAL_DELIVERY_STATUSES,
  WEBHOOK_TEST_EVENT_TYPE,
  WebhookDispatchRejected,
  WebhookEndpointNotFound,
  WebhookDeliveryNotFound,
  WebhookEndpoints,
  type GlobalWebhookDelivery,
  type WebhookEndpoint,
  type RecordedWebhookAttempt
} from './webhook-endpoints.ts'
import { publishWebhookEventWith, WebhookPublisher } from './webhook-publisher.ts'
import { seedWorkspaceRecord } from '../seed-fixture.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { type Workspace } from '../governance/workspace-identity.ts'

/**
 * A Seed fixture row: the wire projection plus the storage columns the
 * projection deliberately hides but the delivery path needs (the plaintext
 * signing secret `getDispatchTarget` hands the worker, and the owning
 * workspace so cross-workspace messages resolve `null` like Live). Absent
 * fields take fixed fixture defaults.
 */
export type SeedWebhookEndpointFixture = {
  readonly id: string
  readonly url: string
  readonly enabled: boolean
  readonly events: ReadonlyArray<string>
  readonly signingSecret?: string
  readonly workspaceId?: string
}

/** Persisted deliveries may lack an attempt time, including terminal rows. */
export type SeedDeliveryFixture = Omit<SeedWebhookDeliveryFixture, 'lastAttemptAt'> & {
  readonly lastAttemptAt: string | null
}

type SeedEndpointRow = {
  readonly id: string
  readonly workspaceId: string
  // `url` and `events` are mutable — `update` writes them in place, which is
  // the whole point of the Seed store mirroring Live's post-conditions.
  url: string
  enabled: boolean
  events: ReadonlyArray<string>
  signingSecret: string
  previousSigningSecret: string | null
  previousSecretExpiresAt: string | null
  // The failure ladder's streak, moved in the same step as the delivery row
  // (see `recordAttempt`) so the Seed store mirrors the Live batch.
  consecutiveFailures: number
}

type SeedDeliveryRow = {
  readonly id: string
  readonly endpointId: string
  readonly workspaceId: string
  readonly eventType: string
  readonly status: WebhookDeliveryStatus
  readonly attempts: number
  readonly lastAttemptAt: string | null
  readonly nextAttemptAt: string | null
  readonly responseStatus: number | null
  readonly payload: Json
  readonly requestHeaders: Record<string, string> | null
  readonly responseBody: string | null
  readonly replayedFrom: string | null
}

function toDeliveryRow(
  fixture: SeedDeliveryFixture,
  fallbackWorkspaceId: string
): SeedDeliveryRow {
  return {
    id: fixture.id,
    endpointId: fixture.endpointId,
    workspaceId: fixture.workspaceId ?? fallbackWorkspaceId,
    eventType: fixture.eventType,
    status: fixture.status,
    attempts: fixture.attempts,
    lastAttemptAt: fixture.lastAttemptAt,
    nextAttemptAt: fixture.nextAttemptAt ?? null,
    responseStatus: fixture.responseStatus ?? null,
    payload: fixture.payload,
    requestHeaders: fixture.requestHeaders ?? null,
    responseBody: fixture.responseBody ?? null,
    replayedFrom: fixture.replayedFrom ?? null
  }
}

/** The wire projection of a stored endpoint — never the signing secret. */
function toProjection(
  endpoint: SeedEndpointRow,
  deliveries: ReadonlyArray<SeedDeliveryRow>
): WebhookEndpoint {
  const mine = deliveries.filter((row) => row.endpointId === endpoint.id)
  return {
    id: endpoint.id,
    url: endpoint.url,
    enabled: endpoint.enabled,
    events: [...endpoint.events],
    successRate: deliverySuccessRate(
      mine.length,
      mine.filter((row) => row.status === 'delivered').length
    )
  }
}

/** The terminal statuses as a lookup set — the global read's filter. */
const TERMINAL_STATUSES: ReadonlySet<WebhookDeliveryStatus> = new Set(
  TERMINAL_DELIVERY_STATUSES
)

export function SeedWebhookEndpoints(
  seedFixtures: ReadonlyArray<SeedWebhookEndpointFixture>,
  seedDeliveries: ReadonlyArray<SeedDeliveryFixture> = [],
  seedWorkspaces: ReadonlyArray<Workspace> = [seedWorkspaceRecord],
  seedAttempts: ReadonlyArray<WebhookDeliveryAttempt> = []
): Layer.Layer<
  WebhookEndpoints,
  never,
  Billing | AuditEventLog | WebhookPublisher | NotificationFeed | ResourceEntitlements
> {
  return Layer.effect(WebhookEndpoints)(
    Effect.gen(function* () {
      const billing = yield* Billing
      const audit = yield* AuditEventLog
      const publisher = yield* WebhookPublisher
      const notificationFeed = yield* NotificationFeed
      const entitlements = yield* ResourceEntitlements
      const inventory = yield* SeedResourceInventory
      // Mutable stores, so Seed mirrors Live's post-conditions — a created
      // endpoint becomes dispatchable, a recorded attempt becomes listable,
      // the plan gate can actually trip. The membership seed roster sets the
      // same precedent; contract cases run unmodified against both adapters.
      const endpoints: Array<SeedEndpointRow> = seedFixtures.map((fixture) => ({
        id: fixture.id,
        workspaceId: fixture.workspaceId ?? seedWorkspaceRecord.id,
        url: fixture.url,
        enabled: fixture.enabled,
        events: [...fixture.events],
        signingSecret:
          fixture.signingSecret ?? 'whsec_c2VlZF9maXh0dXJlX3NlY3JldF8zMl9ieXRlc19sbmc=',
        previousSigningSecret: null,
        previousSecretExpiresAt: null,
        consecutiveFailures: 0
      }))
      inventory.registerWebhooks((workspaceId, includeUnavailable) => {
        const ids: Array<string> = []
        for (const endpoint of endpoints) {
          if (
            endpoint.workspaceId === workspaceId &&
            (includeUnavailable || endpoint.enabled)
          ) {
            ids.push(endpoint.id)
          }
        }
        return ids
      })
      const deliveries: Array<SeedDeliveryRow> = seedDeliveries.map((fixture) =>
        toDeliveryRow(fixture, seedWorkspaceRecord.id)
      )

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

      /** Mirror the Live join against the fixture's workspace catalog. */
      function globalDeliveryRow(row: SeedDeliveryRow): GlobalWebhookDelivery | null {
        const endpoint = endpoints.find((candidate) => candidate.id === row.endpointId)
        const workspace = seedWorkspaces.find(
          (candidate) => candidate.id === endpoint?.workspaceId
        )
        if (endpoint === undefined || workspace === undefined) {
          return null
        }
        return {
          id: row.id,
          endpointId: row.endpointId,
          endpointUrl: endpoint.url,
          endpointEnabled: endpoint.enabled,
          endpointConsecutiveFailures: endpoint.consecutiveFailures,
          endpointFailureLimitReached:
            endpoint.consecutiveFailures >= WEBHOOK_FAILURE_AUTO_DISABLE_AT,
          eventType: row.eventType,
          status: row.status,
          attempts: row.attempts,
          lastAttemptAt: row.lastAttemptAt,
          responseStatus: row.responseStatus,
          workspace
        }
      }

      function globalDeliveries(): Array<GlobalWebhookDelivery> {
        const rows: Array<GlobalWebhookDelivery> = []
        for (const delivery of deliveries) {
          if (TERMINAL_STATUSES.has(delivery.status)) {
            const row = globalDeliveryRow(delivery)
            if (row !== null) {
              rows.push(row)
            }
          }
        }
        return rows
      }

      const attempts: Array<WebhookDeliveryAttempt> = [...seedAttempts]

      const recordAttempt = Effect.fn('WebhookEndpoints.recordAttempt')(function* (
        input: WebhookDeliveryAttemptInput
      ) {
        const deliveryId = input.id ?? (yield* newCapabilityId('whd'))
        const attemptedAt = DateTime.formatIso(yield* DateTime.now)
        const id = yield* newCapabilityId('wha')
        const evidence = attemptEvidence(input)
        const endpoint = endpointFor(input.endpointId, input.workspaceId)
        if (!endpoint) {
          return {
            deliveryId,
            recorded: false,
            failureAction: 'silent',
            status: 'failed_permanent',
            consecutiveFailures: 0
          } satisfies RecordedWebhookAttempt & { readonly deliveryId: string }
        }
        const index = deliveries.findIndex((row) => row.id === deliveryId)
        const previous = deliveries[index]
        if (
          (previous && previous.endpointId !== input.endpointId) ||
          attempts.some(
            (row) =>
              row.deliveryId === deliveryId &&
              row.phase === evidence.phase &&
              (evidence.phase === 'terminal' || row.attempts === input.attempts)
          )
        ) {
          return {
            deliveryId,
            recorded: false,
            failureAction: 'silent',
            status: previous?.status ?? 'failed_permanent',
            consecutiveFailures: endpoint.consecutiveFailures
          } satisfies RecordedWebhookAttempt & { readonly deliveryId: string }
        }
        let ordinal = input.attempts
        if (evidence.phase === 'terminal') {
          ordinal = Math.max(ordinal, previous?.attempts ?? 0)
        }
        attempts.push({
          id,
          deliveryId,
          attempts: ordinal,
          status: input.status,
          attemptedAt,
          ...evidence
        })
        const advances =
          !previous ||
          previous.status === 'pending' ||
          (previous.status === 'failed' &&
            (evidence.phase === 'terminal' || previous.attempts < input.attempts))
        if (!advances) {
          return {
            deliveryId,
            recorded: false,
            failureAction: 'silent',
            status: previous.status,
            consecutiveFailures: endpoint.consecutiveFailures
          } satisfies RecordedWebhookAttempt & { readonly deliveryId: string }
        }
        let responseStatus = evidence.responseStatus
        let requestHeaders = evidence.requestHeaders
        let responseBody = evidence.responseBody
        if (evidence.phase === 'terminal') {
          responseStatus = previous?.responseStatus ?? null
          requestHeaders = previous?.requestHeaders ?? null
          responseBody = previous?.responseBody ?? null
        }
        let payload = input.payload
        let replayedFrom = input.replayedFrom ?? null
        if (previous) {
          payload = previous.payload
          replayedFrom = previous.replayedFrom
        }
        const row: SeedDeliveryRow = {
          id: deliveryId,
          endpointId: input.endpointId,
          workspaceId: input.workspaceId,
          eventType: previous?.eventType ?? input.eventType,
          status: input.status,
          attempts: ordinal,
          lastAttemptAt: attemptedAt,
          nextAttemptAt: input.nextAttemptAt ?? null,
          responseStatus,
          requestHeaders,
          responseBody,
          payload,
          replayedFrom
        }
        if (index === -1) {
          deliveries.push(row)
        } else {
          deliveries[index] = row
        }
        const countsFailure =
          evidence.phase === 'http' ||
          !attempts.some(
            (attempt) => attempt.deliveryId === deliveryId && attempt.phase === 'http'
          )
        if (countsFailure) {
          endpoint.consecutiveFailures = nextConsecutiveFailures(
            endpoint.consecutiveFailures,
            input.status
          )
        }
        const consecutiveFailures = endpoint.consecutiveFailures
        const disabled =
          countsFailure &&
          endpoint.enabled &&
          endpoint.consecutiveFailures >= WEBHOOK_FAILURE_AUTO_DISABLE_AT
        if (disabled) {
          endpoint.enabled = false
        }
        const eventType = terminalDeliveryAuditEventType.get(input.status)
        if (eventType !== undefined) {
          yield* audit.record({
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
          })
        }
        if (disabled) {
          yield* audit.record({
            workspaceId: input.workspaceId,
            actorType: 'system',
            eventType: 'webhook_endpoint.auto_disabled',
            targetType: 'webhook_endpoint',
            targetId: input.endpointId,
            metadata: { deliveryId }
          })
        }
        if (input.status === 'dead_lettered') {
          yield* bestEffort(
            notificationFeed.create({
              workspaceId: input.workspaceId,
              userId: null,
              kind: 'webhook.delivery_failed',
              ...deadLetterNotification({
                eventType: input.eventType,
                attempts: ordinal,
                url: endpoint.url
              })
            }),
            () => ({ webhookDeadLetterNotification: 'failed', deliveryId })
          )
        }
        let failureAction: 'silent' | 'warn' | 'disable' = 'silent'
        if (countsFailure) {
          failureAction = failureLadderAction(consecutiveFailures)
        }
        return {
          deliveryId,
          recorded: true,
          failureAction,
          status: input.status,
          consecutiveFailures
        } satisfies RecordedWebhookAttempt & { readonly deliveryId: string }
      })

      /**
       * The `pending` row an operator dispatch (replay, test send) starts
       * from, with its audit event when there is one. The row shape is the
       * caller's plan, mirroring Live's `recordOperatorDispatch`.
       */
      const recordOperatorDispatch = Effect.fnUntraced(function* (input: {
        readonly deliveryId: string
        readonly workspaceId: string
        readonly plan: PendingDispatchPlan
        readonly auditEventType?: 'webhook.delivery_replayed' | undefined
      }) {
        deliveries.push({
          id: input.deliveryId,
          endpointId: input.plan.endpointId,
          workspaceId: input.workspaceId,
          eventType: input.plan.eventType,
          status: input.plan.status,
          attempts: input.plan.attempts,
          lastAttemptAt: DateTime.formatIso(yield* DateTime.now),
          nextAttemptAt: input.plan.nextAttemptAt,
          responseStatus: input.plan.responseStatus,
          payload: input.plan.payload,
          requestHeaders: null,
          responseBody: null,
          replayedFrom: input.plan.replayedFrom
        })
        if (input.auditEventType !== undefined) {
          yield* audit.record({
            workspaceId: input.workspaceId,
            actorUserId: (yield* WorkspaceContext).actor?.userId ?? null,
            actorType: (yield* WorkspaceContext).actorType,
            eventType: input.auditEventType,
            targetType: 'webhook_endpoint',
            targetId: input.plan.endpointId,
            metadata: {
              deliveryId: input.deliveryId,
              replayedFrom: input.plan.replayedFrom,
              eventType: input.plan.eventType
            }
          })
        }
      })

      return {
        listDeliveryAttempts: Effect.fn('WebhookEndpoints.listDeliveryAttempts')(
          function* (input) {
            const ctx = yield* WorkspaceContext
            const delivery = deliveries.find((row) => row.id === input.deliveryId)
            if (!delivery || !endpointFor(delivery.endpointId, ctx.workspace.id)) {
              return []
            }
            return attempts
              .filter((row) => row.deliveryId === delivery.id)
              .toSorted(
                (a, b) => a.attempts - b.attempts || a.phase.localeCompare(b.phase)
              )
          }
        ),
        cleanupDeliveryHistory: Effect.fn('WebhookEndpoints.cleanupDeliveryHistory')(
          function* () {
            const cutoff = DateTime.formatIso(
              DateTime.subtractDuration(
                yield* DateTime.now,
                Duration.days(DELIVERY_HISTORY_RETENTION_DAYS)
              )
            )
            const expired = new Set(
              deliveries
                .filter(
                  (row) =>
                    row.lastAttemptAt !== null &&
                    row.lastAttemptAt < cutoff &&
                    ['delivered', 'failed_permanent', 'dead_lettered'].includes(
                      row.status
                    )
                )
                .toSorted((a, b) =>
                  (a.lastAttemptAt ?? '').localeCompare(b.lastAttemptAt ?? '')
                )
                .slice(0, DELIVERY_HISTORY_CLEANUP_LIMIT)
                .map((row) => row.id)
            )
            for (let i = deliveries.length - 1; i >= 0; i--) {
              if (expired.has(deliveries[i]?.id ?? '')) {
                deliveries.splice(i, 1)
              }
            }
            for (let i = attempts.length - 1; i >= 0; i--) {
              if (expired.has(attempts[i]?.deliveryId ?? '')) {
                attempts.splice(i, 1)
              }
            }
            return expired.size
          }
        ),
        list: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const projections: Array<WebhookEndpoint> = []
          for (const endpoint of endpoints) {
            if (endpoint.workspaceId !== ctx.workspace.id) {
              continue
            }
            projections.push(toProjection(endpoint, deliveries))
          }
          return projections
        }),
        listPage: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const projections: Array<WebhookEndpoint> = []
            for (const endpoint of endpoints) {
              if (endpoint.workspaceId !== ctx.workspace.id) {
                continue
              }
              projections.push(toProjection(endpoint, deliveries))
            }
            // Forward on `id ASC` — no timestamp on the wire shape, so the
            // stable order a page can resume is the id itself.
            return seedKeysetPage(
              projections,
              'asc',
              (endpoint) => ({ key: endpoint.id, id: endpoint.id }),
              input
            )
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
          }).pipe(Effect.provideService(Billing, billing))
          const endpoint: SeedEndpointRow = {
            id: yield* newCapabilityId('wh'),
            workspaceId: ctx.workspace.id,
            url: input.url,
            enabled: true,
            events: [...input.events],
            signingSecret: randomWebhookSecret(),
            previousSigningSecret: null,
            previousSecretExpiresAt: null,
            consecutiveFailures: 0
          }
          endpoints.push(endpoint)
          yield* audit.record({
            workspaceId: ctx.workspace.id,
            actorUserId: ctx.actor?.userId ?? null,
            actorType: ctx.actorType,
            eventType: 'webhook_endpoint.created',
            targetType: 'webhook_endpoint',
            targetId: endpoint.id,
            metadata: { url: input.url, events: input.events }
          })
          // The projection, never the signing secret.
          yield* publishWebhookEventWith(publisher, {
            eventType: 'webhook_endpoint.created',
            payload: toProjection(endpoint, deliveries)
          })
          return {
            endpoint: toProjection(endpoint, deliveries),
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
            // `lastAttemptAt` DESC, row id DESC as the tie-break — a total
            // order, mirroring Live's orderBy so the shared contract can
            // assert the sequence on both adapters.
            const sorted = matched.toSorted((a, b) => {
              if ((a.lastAttemptAt ?? '') > (b.lastAttemptAt ?? '')) {
                return -1
              }
              if ((a.lastAttemptAt ?? '') < (b.lastAttemptAt ?? '')) {
                return 1
              }
              if (a.id > b.id) {
                return -1
              }
              if (a.id < b.id) {
                return 1
              }
              return 0
            })
            return sorted
              .slice(0, DELIVERIES_PAGE_SIZE)
              .map(({ workspaceId: _ws, ...row }) => row)
          }),
        listGlobalDeliveries: (input) =>
          Effect.sync(() =>
            // Newest first on `(lastAttemptAt DESC, id DESC)` — the same
            // order Live's orderBy keeps, cut by the shared keyset recipe.
            seedKeysetPage(
              globalDeliveries(),
              'desc',
              (row) => ({ key: row.lastAttemptAt ?? '!', id: row.id }),
              input
            )
          ),
        update: (input) =>
          Effect.gen(function* () {
            if (input.url !== undefined) {
              yield* ensureValidWebhookUrl(input.url)
            }
            const ctx = yield* WorkspaceContext
            const endpoint = yield* inWorkspace(input.endpointId)
            if (!endpoint) {
              return yield* Effect.fail(
                new WebhookEndpointNotFound({ endpointId: input.endpointId })
              )
            }
            if (input.url !== undefined) {
              endpoint.url = input.url
            }
            if (input.events !== undefined) {
              endpoint.events = [...input.events]
            }
            if (input.enabled !== undefined) {
              endpoint.enabled = input.enabled
            }
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
            yield* audit.record({
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              actorType: ctx.actorType,
              eventType: 'webhook_endpoint.updated',
              targetType: 'webhook_endpoint',
              targetId: endpoint.id,
              metadata
            })
            return toProjection(endpoint, deliveries)
          }),
        delete: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const endpoint = yield* inWorkspace(input.endpointId)
            if (!endpoint) {
              return yield* Effect.fail(
                new WebhookEndpointNotFound({ endpointId: input.endpointId })
              )
            }
            // Deliveries cascade with the endpoint row, same as the FK.
            endpoints.splice(endpoints.indexOf(endpoint), 1)
            for (let i = deliveries.length - 1; i >= 0; i--) {
              if (deliveries[i]?.endpointId === endpoint.id) {
                deliveries.splice(i, 1)
              }
            }
            yield* audit.record({
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              actorType: ctx.actorType,
              eventType: 'webhook_endpoint.deleted',
              targetType: 'webhook_endpoint',
              targetId: endpoint.id,
              metadata: { url: endpoint.url }
            })
          }),
        replayDeliveryAsAdmin: Effect.fn('WebhookEndpoints.replayDeliveryAsAdmin')(
          function* (input) {
            const source = deliveries.find((row) => row.id === input.deliveryId)
            const endpoint = endpoints.find((row) => row.id === source?.endpointId)
            let replaySource: AdminReplaySource | undefined
            if (source && endpoint) {
              replaySource = {
                ...source,
                workspaceId: endpoint.workspaceId,
                enabled: endpoint.enabled
              }
            }
            const replay = yield* planAdminReplay(replaySource, input.actorUserId)
            // No ambient workspace identity: this is an explicitly attributed admin write.
            deliveries.push({
              ...replay.plan,
              id: replay.deliveryId,
              workspaceId: replay.workspaceId,
              lastAttemptAt: DateTime.formatIso(yield* DateTime.now),
              requestHeaders: null,
              responseBody: null
            })
            yield* audit.record(replay.auditEvent)
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
            const owned = new Set<string>()
            for (const endpoint of endpoints) {
              if (endpoint.workspaceId === ctx.workspace.id) {
                owned.add(endpoint.id)
              }
            }
            const source = deliveries.find(
              (row) => row.id === input.deliveryId && owned.has(row.endpointId)
            )
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
            const endpoint = endpointFor(source.endpointId, ctx.workspace.id)
            if (!endpoint || !endpoint.enabled) {
              return yield* Effect.fail(
                new WebhookDispatchRejected({ reason: 'endpoint is disabled' })
              )
            }
            const deliveryId = yield* newCapabilityId('whd')
            yield* recordOperatorDispatch({
              deliveryId,
              workspaceId: ctx.workspace.id,
              plan: planReplayedDelivery({
                id: source.id,
                endpointId: source.endpointId,
                eventType: source.eventType,
                payload: source.payload
              }),
              auditEventType: 'webhook.delivery_replayed'
            })
            yield* publisher.enqueue({
              endpointId: source.endpointId,
              workspaceId: ctx.workspace.id,
              eventType: source.eventType,
              deliveryId,
              payload: source.payload
            })
            return { deliveryId }
          }),
        sendTestEvent: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const endpoint = yield* inWorkspace(input.endpointId)
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
            const payload = {
              test: true,
              sentAt: DateTime.formatIso(yield* DateTime.now)
            }
            const deliveryId = yield* newCapabilityId('whd')
            // No audit event, mirroring Live: the pending row is the record.
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
            const endpoint = yield* inWorkspace(input.endpointId)
            if (!endpoint) {
              return yield* Effect.fail(
                new WebhookEndpointNotFound({ endpointId: input.endpointId })
              )
            }
            // Same shift as Live: the replaced secret moves into the grace
            // columns and keeps signing until the window closes.
            const expiresAt = planSecretRotation(yield* DateTime.now)
            const replaced = endpoint.signingSecret
            endpoint.signingSecret = randomWebhookSecret()
            endpoint.previousSigningSecret = replaced
            endpoint.previousSecretExpiresAt = expiresAt
            yield* audit.record({
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              actorType: ctx.actorType,
              eventType: 'webhook_endpoint.secret_rotated',
              targetType: 'webhook_endpoint',
              targetId: endpoint.id,
              metadata: { previousSecretExpiresAt: expiresAt }
            })
            return { signingSecret: endpoint.signingSecret }
          }),
        getDispatchTarget: (endpointId, workspaceId) =>
          Effect.gen(function* () {
            const endpoint = endpointFor(endpointId, workspaceId)
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
              signingSecrets: activeSigningSecrets(endpoint, yield* DateTime.now)
            }
          }),
        recordDeliveryAttempt: (input) => recordAttempt(input),
        recordTerminalDeliveryAttempt: (input) =>
          // Same row identity and evidence as Live: the id from the queue
          // message, the payload recorded so the row stays replayable. The
          // retry schedule clears; response evidence already on the row stays.
          recordAttempt({
            ...input,
            id: input.deliveryId,
            phase: 'terminal',
            nextAttemptAt: null
          })
      }
    })
  ).pipe(Layer.provide(SeedResourceInventoryLayer))
}
