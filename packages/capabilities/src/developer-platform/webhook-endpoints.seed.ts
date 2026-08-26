import { DateTime, Effect, Layer, Option } from 'effect'

import { assertWithinPlanLimit } from '../billing/billing.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import {
  ensureValidWebhookUrl,
  WebhookEndpoints,
  type WebhookEndpoint
} from './webhook-endpoints.ts'
import {
  terminalDeliveryAuditEventType,
  type WebhookDeliveryStatus
} from './webhook-delivery-plan.ts'
import { publishWebhookEventWith, WebhookPublisher } from './webhook-publisher.ts'
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
  readonly events: readonly string[]
  readonly successRate: number
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

/** The wire projection of a stored endpoint — never the signing secret. */
function toProjection(endpoint: SeedEndpointRow): WebhookEndpoint {
  return {
    id: endpoint.id,
    url: endpoint.url,
    enabled: endpoint.enabled,
    events: [...endpoint.events],
    successRate: endpoint.successRate
  }
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
          seq: nextSeq()
        })
        return deliveryId
      })

      return {
        list: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const projections: WebhookEndpoint[] = []
          for (const endpoint of endpoints) {
            if (endpoint.workspaceId !== ctx.workspace.id) continue
            projections.push(toProjection(endpoint))
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
            payload: toProjection(endpoint)
          })
          return {
            endpoint: toProjection(endpoint),
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
