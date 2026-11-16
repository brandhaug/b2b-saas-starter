import { WebhookDeliveryId, WebhookEndpointId } from '@b2b-saas-starter/db/ids'
import { Context, Effect, Schema } from 'effect'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type RecordAuditEventInput } from '../governance/audit-event-log.ts'
import { Workspace } from '../governance/workspace-identity.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { type Page } from '../internal/keyset-cursor.ts'
import {
  isTerminalDeliveryStatus,
  planReplayedDelivery,
  type Json,
  type WebhookDeliveryStatus
} from './webhook-delivery-plan.ts'
import { type ListGlobalDeliveriesInput } from './webhook-delivery-view.ts'
import { type DispatchedDelivery } from './webhook-deliveries.ts'
import { WebhookDispatchRejected } from './webhook-endpoints.ts'

/** Terminal delivery and current endpoint state for the global operator list.
 * No payload or signing secrets are exposed. Replay re-reads the source.
 */
export const GlobalWebhookDelivery = Schema.Struct({
  id: WebhookDeliveryId,
  endpointId: WebhookEndpointId,
  endpointUrl: Schema.String,
  endpointEnabled: Schema.Boolean,
  endpointConsecutiveFailures: Schema.Number,
  endpointFailureLimitReached: Schema.Boolean,
  eventType: Schema.String,
  status: Schema.String,
  attempts: Schema.Number,
  lastAttemptAt: Schema.NullOr(Schema.String),
  responseStatus: Schema.NullOr(Schema.Number),
  workspace: Workspace
})
export type GlobalWebhookDelivery = typeof GlobalWebhookDelivery.Type

export type AdminReplaySource = {
  readonly id: WebhookDeliveryId
  readonly endpointId: WebhookEndpointId
  readonly workspaceId: string
  readonly eventType: string
  readonly status: WebhookDeliveryStatus
  readonly enabled: boolean
  readonly payload: Json | undefined
}

/** Shared replay policy and audit attribution; adapters only persist and enqueue. */
export const planAdminReplay = Effect.fn('WebhookDeliveryAdmin.planAdminReplay')(
  function* (source: AdminReplaySource | undefined, actorUserId: string) {
    if (source === undefined) {
      return yield* Effect.fail(
        new WebhookDispatchRejected({
          reason: 'delivery or endpoint no longer exists'
        })
      )
    }
    if (!isTerminalDeliveryStatus(source.status)) {
      return yield* Effect.fail(
        new WebhookDispatchRejected({
          reason: `delivery is ${source.status}, only terminal deliveries replay from admin`
        })
      )
    }
    if (!source.enabled) {
      return yield* Effect.fail(
        new WebhookDispatchRejected({
          reason:
            'endpoint is disabled; a workspace operator must re-enable it before replay'
        })
      )
    }
    if (source.payload === undefined) {
      return yield* Effect.fail(
        new WebhookDispatchRejected({
          reason: 'delivery payload is missing; replay cannot reconstruct it'
        })
      )
    }
    const deliveryId = yield* newCapabilityId('whd').pipe(
      Effect.map((id) => WebhookDeliveryId.make(id))
    )
    return {
      deliveryId,
      workspaceId: source.workspaceId,
      plan: planReplayedDelivery({ ...source, payload: source.payload }),
      auditEvent: {
        workspaceId: source.workspaceId,
        actorUserId,
        actorType: 'user',
        eventType: 'webhook.delivery_replayed',
        targetType: 'webhook_endpoint',
        targetId: source.endpointId,
        metadata: {
          deliveryId,
          replayedFrom: source.id,
          eventType: source.eventType,
          scope: 'system_admin'
        }
      } satisfies RecordAuditEventInput
    }
  }
)

/**
 * Cross-workspace operator reads and replay for `/admin`. Like
 * `AuditEventLog.listGlobal`, nothing here reads `WorkspaceContext`: the
 * boundary rechecks the system-admin session, and replay resolves the
 * delivery's workspace itself and audits the real admin actor.
 */
type WebhookDeliveryAdminInterface = {
  /** Terminal deliveries, newest-first by (lastAttemptAt, id), nulls last. */
  readonly listGlobalDeliveries: (
    input?: ListGlobalDeliveriesInput
  ) => Effect.Effect<Page<GlobalWebhookDelivery>, CapabilityUnavailable>

  /** Grants no workspace membership and never provides `WorkspaceContext`. */
  readonly replayDeliveryAsAdmin: (input: {
    readonly deliveryId: WebhookDeliveryId
    readonly actorUserId: string
  }) => Effect.Effect<
    DispatchedDelivery,
    CapabilityUnavailable | WebhookDispatchRejected
  >
}

export class WebhookDeliveryAdmin extends Context.Service<
  WebhookDeliveryAdmin,
  WebhookDeliveryAdminInterface
>()('@b2b-saas-starter/capabilities/WebhookDeliveryAdmin') {}
