import { WebhookDeliveryId, WebhookEndpointId } from '@b2b-saas-starter/db/ids'
import { DateTime, Effect, Layer, Redacted } from 'effect'
import {
  WorkspaceContext as BillingWorkspaceContext,
  workspaceAuditAttribution
} from '@b2b-saas-starter/billing/ports'
import { Billing } from '@b2b-saas-starter/billing/billing'
import { assertWithinPlanLimit } from '@b2b-saas-starter/billing/resource-admission'
import { type JsonValue } from '@b2b-saas-starter/db/schema/json'
import { randomWebhookSecret } from '../crypto.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { seedKeysetPage } from '../internal/keyset-cursor.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { planPendingDispatch, planSecretRotation } from './webhook-delivery-plan.ts'
import {
  ensureValidWebhookUrl,
  WEBHOOK_TEST_EVENT_TYPE,
  WebhookDispatchRejected,
  WebhookEndpointNotFound,
  WebhookEndpoints,
  type WebhookEndpoint
} from './webhook-endpoints.ts'
import { seedOperatorDispatch } from './webhook-operator-dispatch.seed.ts'
import { publishWebhookEventWith, WebhookPublisher } from './webhook-publisher.ts'
import { SeedWebhookStore, type SeedEndpointRow } from './webhook-store.seed.ts'

export const SeedWebhookEndpoints: Layer.Layer<
  WebhookEndpoints,
  never,
  SeedWebhookStore | Billing | AuditEventLog | WebhookPublisher
> = Layer.effect(WebhookEndpoints)(
  Effect.gen(function* () {
    const audit = yield* AuditEventLog
    const billing = yield* Billing
    const publisher = yield* WebhookPublisher
    const store = yield* SeedWebhookStore
    const { endpoints, deliveries, attempts, inventory, endpointFor } = store
    const recordOperatorDispatch = yield* seedOperatorDispatch(deliveries)

    function inWorkspace(endpointId: WebhookEndpointId) {
      return Effect.map(WorkspaceContext, (ctx) =>
        endpointFor(endpointId, ctx.workspace.id)
      )
    }

    /** Mirror the Live join against the fixture's workspace catalog. */

    return {
      list: Effect.fn('WebhookEndpoints.list')(function* () {
        const ctx = yield* WorkspaceContext
        const projections: Array<WebhookEndpoint> = []
        for (const endpoint of endpoints) {
          if (endpoint.workspaceId !== ctx.workspace.id) {
            continue
          }
          projections.push(store.projection(endpoint))
        }
        return projections
      })(),
      listPage: Effect.fn('WebhookEndpoints.listPage')(function* (input) {
        const ctx = yield* WorkspaceContext
        const projections: Array<WebhookEndpoint> = []
        for (const endpoint of endpoints) {
          if (endpoint.workspaceId !== ctx.workspace.id) {
            continue
          }
          projections.push(store.projection(endpoint))
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
      create: Effect.fn('WebhookEndpoints.create')(function* (input) {
        yield* ensureValidWebhookUrl(input.url)
        const ctx = yield* WorkspaceContext
        // Same entitlement gate as Live — and because the store mutates, the
        // cap can actually trip here instead of being unreachable.
        yield* assertWithinPlanLimit({
          resource: 'webhook_endpoint',
          used: inventory.known(ctx.workspace.id).webhookEndpointIds.length
        }).pipe(
          Effect.provideService(Billing, billing),
          Effect.provideService(BillingWorkspaceContext, ctx)
        )
        const endpoint: SeedEndpointRow = {
          id: yield* newCapabilityId('wh').pipe(
            Effect.map((id) => WebhookEndpointId.make(id))
          ),
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
          ...workspaceAuditAttribution(ctx),
          eventType: 'webhook_endpoint.created',
          targetType: 'webhook_endpoint',
          targetId: endpoint.id,
          metadata: { url: input.url, events: input.events }
        })
        // The projection, never the signing secret.
        yield* publishWebhookEventWith(publisher, {
          eventType: 'webhook_endpoint.created',
          payload: store.projection(endpoint)
        })
        return {
          endpoint: store.projection(endpoint),
          signingSecret: Redacted.make(endpoint.signingSecret)
        }
      }, inventory.lock.withPermits(1)),
      update: Effect.fn('WebhookEndpoints.update')(function* (input) {
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
          ...workspaceAuditAttribution(ctx),
          eventType: 'webhook_endpoint.updated',
          targetType: 'webhook_endpoint',
          targetId: endpoint.id,
          metadata
        })
        return store.projection(endpoint)
      }),
      delete: Effect.fn('WebhookEndpoints.delete')(function* (input) {
        const ctx = yield* WorkspaceContext
        const endpoint = yield* inWorkspace(input.endpointId)
        if (!endpoint) {
          return yield* Effect.fail(
            new WebhookEndpointNotFound({ endpointId: input.endpointId })
          )
        }
        // Deliveries cascade with the endpoint row, and attempts cascade
        // with their delivery — the same two hops D1's foreign keys make.
        // Leaving the attempts behind would let a Seed-backed admin read
        // find delivery evidence for a delivery that no longer exists.
        endpoints.splice(endpoints.indexOf(endpoint), 1)
        const cascaded = new Set<string>()
        for (let i = deliveries.length - 1; i >= 0; i--) {
          const delivery = deliveries[i]
          if (delivery?.endpointId === endpoint.id) {
            cascaded.add(delivery.id)
            deliveries.splice(i, 1)
          }
        }
        for (let i = attempts.length - 1; i >= 0; i--) {
          if (cascaded.has(attempts[i]?.deliveryId ?? '')) {
            attempts.splice(i, 1)
          }
        }
        yield* audit.record({
          ...workspaceAuditAttribution(ctx),
          eventType: 'webhook_endpoint.deleted',
          targetType: 'webhook_endpoint',
          targetId: endpoint.id,
          metadata: { url: endpoint.url }
        })
      }),
      sendTestEvent: Effect.fn('WebhookEndpoints.sendTestEvent')(function* (input) {
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
        const deliveryId = yield* newCapabilityId('whd').pipe(
          Effect.map((id) => WebhookDeliveryId.make(id))
        )
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
      rotateSecret: Effect.fn('WebhookEndpoints.rotateSecret')(function* (input) {
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
          ...workspaceAuditAttribution(ctx),
          eventType: 'webhook_endpoint.secret_rotated',
          targetType: 'webhook_endpoint',
          targetId: endpoint.id,
          metadata: { previousSecretExpiresAt: expiresAt }
        })
        return { signingSecret: Redacted.make(endpoint.signingSecret) }
      })
    }
  })
)
