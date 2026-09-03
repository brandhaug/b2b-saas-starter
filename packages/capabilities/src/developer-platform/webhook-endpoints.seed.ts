import { DateTime, Effect, Layer, Option } from 'effect'

import { assertWithinPlanLimit } from '../billing/plan-catalog.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { seedKeysetPage } from '../internal/keyset-cursor.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { type JsonValue } from '@b2b-saas-starter/db/schema'
import { NotificationFeed } from '../notifications/notification-feed.ts'
import {
  activeSigningSecrets,
  deadLetterNotification,
  deliverySuccessRate,
  isReplayableDeliveryStatus,
  planReplayedDelivery,
  planSecretRotation,
  terminalDeliveryAuditEventType,
  type Json,
  type SeedWebhookDeliveryFixture,
  type WebhookDeliveryStatus
} from './webhook-delivery-plan.ts'
import {
  ensureValidWebhookUrl,
  WEBHOOK_TEST_EVENT_TYPE,
  WebhookDispatchRejected,
  WebhookEndpointNotFound,
  WebhookDeliveryNotFound,
  WebhookEndpoints,
  type WebhookEndpoint
} from './webhook-endpoints.ts'
import { publishWebhookEventWith, WebhookPublisher } from './webhook-publisher.ts'
import { seedWorkspaceRecord } from '../seed-fixture.ts'
import { WorkspaceContext } from '../workspace-context.ts'

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
  readonly successRate: number
  readonly signingSecret?: string
  readonly workspaceId?: string
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
  readonly payload: Json | null
  readonly requestHeaders: Record<string, string> | null
  readonly responseBody: string | null
  readonly replayedFrom: string | null
  /** Insertion order — the tie-break when rows share a `lastAttemptAt`. */
  readonly seq: number
}

function toDeliveryRow(
  fixture: SeedWebhookDeliveryFixture,
  seq: number,
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
    payload: fixture.payload ?? null,
    requestHeaders: fixture.requestHeaders ?? null,
    responseBody: fixture.responseBody ?? null,
    replayedFrom: fixture.replayedFrom ?? null,
    seq
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

export function SeedWebhookEndpoints(
  seedFixtures: ReadonlyArray<SeedWebhookEndpointFixture>,
  seedDeliveries: ReadonlyArray<SeedWebhookDeliveryFixture> = []
): Layer.Layer<
  WebhookEndpoints,
  never,
  AuditEventLog | WebhookPublisher | NotificationFeed
> {
  return Layer.effect(WebhookEndpoints)(
    Effect.gen(function* () {
      const audit = yield* AuditEventLog
      const publisher = yield* WebhookPublisher
      const notificationFeed = yield* NotificationFeed
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
        signingSecret: fixture.signingSecret ?? 'whsec_seed_fixture',
        previousSigningSecret: null,
        previousSecretExpiresAt: null
      }))
      const deliveries: Array<SeedDeliveryRow> = seedDeliveries.map((fixture, index) =>
        toDeliveryRow(fixture, index + 1, seedWorkspaceRecord.id)
      )
      let deliverySeq = seedDeliveries.length

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
        // Upsert on the row id, mirroring Live's `onConflictDoUpdate`: every
        // redelivery of the same message resolves the same row.
        const existing = deliveries.findIndex((candidate) => candidate.id === row.id)
        if (existing === -1) {
          deliveries.push(row)
        } else {
          deliveries[existing] = row
        }
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
        // Same user-facing half of a dead letter as Live: a broadcast
        // notification naming the endpoint URL.
        if (row.status === 'dead_lettered') {
          const endpoint = endpointFor(row.endpointId, row.workspaceId)
          if (endpoint) {
            yield* notificationFeed.create({
              workspaceId: row.workspaceId,
              userId: null,
              kind: 'webhook.delivery_failed',
              ...deadLetterNotification({
                eventType: row.eventType,
                url: endpoint.url,
                attempts: row.attempts
              })
            })
          }
        }
      })

      /** One attempt row; terminal statuses audit below their interface — mirrors Live's `recordAttempt`. */
      const recordAttempt = Effect.fnUntraced(function* (input: {
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
          payload: input.payload ?? null,
          requestHeaders: input.requestHeaders ?? null,
          responseBody: input.responseBody ?? null,
          replayedFrom: input.replayedFrom ?? null,
          seq: nextSeq()
        })
        return deliveryId
      })

      /**
       * The `pending` row an operator dispatch (replay, test send) starts
       * from, with its audit event when there is one.
       */
      const recordOperatorDispatch = Effect.fnUntraced(function* (input: {
        readonly deliveryId: string
        readonly endpointId: string
        readonly workspaceId: string
        readonly eventType: string
        readonly payload: Json
        readonly replayedFrom?: string | undefined
        readonly auditEventType?: 'webhook.delivery_replayed' | undefined
      }) {
        const plan = planReplayedDelivery({
          id: input.replayedFrom ?? input.deliveryId,
          endpointId: input.endpointId,
          eventType: input.eventType,
          payload: input.payload
        })
        deliveries.push({
          id: input.deliveryId,
          endpointId: plan.endpointId,
          workspaceId: input.workspaceId,
          eventType: plan.eventType,
          status: plan.status,
          attempts: plan.attempts,
          lastAttemptAt: DateTime.formatIso(yield* DateTime.now),
          nextAttemptAt: plan.nextAttemptAt,
          responseStatus: plan.responseStatus,
          payload: plan.payload,
          requestHeaders: null,
          responseBody: null,
          replayedFrom: input.replayedFrom ?? null,
          seq: nextSeq()
        })
        if (input.auditEventType !== undefined) {
          yield* audit.record({
            workspaceId: input.workspaceId,
            actorUserId: (yield* WorkspaceContext).actor?.userId ?? null,
            eventType: input.auditEventType,
            targetType: 'webhook_endpoint',
            targetId: input.endpointId,
            metadata: {
              deliveryId: input.deliveryId,
              replayedFrom: input.replayedFrom ?? null,
              eventType: input.eventType
            }
          })
        }
      })

      return {
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
              projections.push(toProjection(endpoint))
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
          })
          const endpoint: SeedEndpointRow = {
            id: yield* newCapabilityId('wh'),
            workspaceId: ctx.workspace.id,
            url: input.url,
            enabled: true,
            events: [...input.events],
            signingSecret: 'whsec_seed_created',
            previousSigningSecret: null,
            previousSecretExpiresAt: null
          }
          endpoints.push(endpoint)
          yield* audit.record({
            workspaceId: ctx.workspace.id,
            actorUserId: ctx.actor?.userId ?? null,
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
            // `lastAttemptAt` DESC, insertion recency as the tie-break —
            // mirrors Live's `orderBy(lastAttemptAt desc)` read.
            matched.sort((a, b) => {
              if (a.lastAttemptAt > b.lastAttemptAt) {
                return -1
              }
              if (a.lastAttemptAt < b.lastAttemptAt) {
                return 1
              }
              return b.seq - a.seq
            })
            return matched
              .slice(0, 20)
              .map(({ seq: _seq, workspaceId: _ws, ...row }) => row)
          }),
        disable: (input) =>
          Effect.gen(function* () {
            const endpoint = yield* inWorkspace(input.endpointId)
            if (!endpoint || !endpoint.enabled) {
              return false
            }
            endpoint.enabled = false
            const ctx = yield* WorkspaceContext
            yield* audit.record({
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              eventType: 'webhook_endpoint.disabled',
              targetType: 'webhook_endpoint',
              targetId: endpoint.id,
              metadata: {}
            })
            return true
          }),
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
              return false
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
              eventType: 'webhook_endpoint.deleted',
              targetType: 'webhook_endpoint',
              targetId: endpoint.id,
              metadata: { url: endpoint.url }
            })
            return true
          }),
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
            if (source.payload === null) {
              return yield* Effect.fail(
                new WebhookDispatchRejected({
                  reason: 'delivery records no payload to re-send'
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
              endpointId: source.endpointId,
              workspaceId: ctx.workspace.id,
              eventType: source.eventType,
              payload: source.payload,
              replayedFrom: source.id,
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
            const endpoint = yield* inWorkspace(input.endpointId)
            if (!endpoint) {
              return Option.none()
            }
            // Same shift as Live: the replaced secret moves into the grace
            // columns and keeps signing until the window closes.
            const expires = planSecretRotation(yield* DateTime.now)
            const replaced = endpoint.signingSecret
            endpoint.signingSecret = 'whsec_seed_rotated'
            endpoint.previousSigningSecret = replaced
            endpoint.previousSecretExpiresAt = expires.previousSecretExpiresAt
            yield* audit.record({
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              eventType: 'webhook_endpoint.secret_rotated',
              targetType: 'webhook_endpoint',
              targetId: endpoint.id,
              metadata: { previousSecretExpiresAt: expires.previousSecretExpiresAt }
            })
            return Option.some({ signingSecret: endpoint.signingSecret })
          }),
        getDispatchTarget: (endpointId, workspaceId) =>
          Effect.gen(function* () {
            const endpoint = endpointFor(endpointId, workspaceId)
            if (!endpoint || !endpoint.enabled) {
              return null
            }
            return {
              id: endpoint.id,
              url: endpoint.url,
              signingSecrets: activeSigningSecrets(endpoint, yield* DateTime.now)
            }
          }),
        recordDeliveryAttempt: (input) => recordAttempt(input).pipe(Effect.asVoid),
        recordTerminalDeliveryAttempt: Effect.fnUntraced(function* (input) {
          // The capability mints the row id, like Live does on this surface.
          const deliveryId = yield* recordAttempt(input)
          return { deliveryId }
        })
      }
    })
  )
}
