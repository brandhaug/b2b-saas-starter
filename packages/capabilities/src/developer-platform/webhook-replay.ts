import { Effect } from 'effect'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type RecordAuditEventInput } from '../governance/audit-event-log.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import {
  isReplayableDeliveryStatus,
  planReplayedDelivery,
  type Json,
  type WebhookDeliveryStatus,
  type PendingDispatchPlan
} from './webhook-delivery-plan.ts'
import {
  WebhookDeliveryNotFound,
  WebhookDispatchRejected,
  type WebhookEndpoints
} from './webhook-endpoints.ts'
import { type WebhookPublisher } from './webhook-publisher.ts'

type ReplayInput = Parameters<WebhookEndpoints['Service']['replayDelivery']>[0]

type ReplaySource = {
  readonly id: string
  readonly endpointId: string
  readonly eventType: string
  readonly status: WebhookDeliveryStatus
  readonly payload: Json
  readonly enabled: boolean
  readonly endpointUrl: string
}

type ReplayReservation = {
  readonly endpointId: string
  readonly replayedFrom: string | null
  readonly approvedEndpointUrl: string | null
  readonly status: WebhookDeliveryStatus
}

type ReplayStore = {
  readonly source: (
    deliveryId: string,
    workspaceId: string
  ) => Effect.Effect<ReplaySource | null, CapabilityUnavailable>
  /** Atomically reserve and audit once, then return the stored identity. */
  readonly reserve: (input: {
    readonly deliveryId: string
    readonly workspaceId: string
    readonly plan: PendingDispatchPlan
    readonly approvedEndpointUrl: string | undefined
    readonly auditEvent: RecordAuditEventInput
  }) => Effect.Effect<ReplayReservation | null, CapabilityUnavailable>
}

/** Approval drift precedes ordinary eligibility, identically in every adapter. */
function replayRefusal(source: ReplaySource, input: ReplayInput): string | null {
  if (
    input.expectedEndpointUrl !== undefined &&
    source.endpointUrl !== input.expectedEndpointUrl
  ) {
    return 'endpoint changed since investigation'
  }
  if (input.expectedStatus !== undefined && source.status !== input.expectedStatus) {
    return 'delivery status changed since investigation'
  }
  if (!isReplayableDeliveryStatus(source.status)) {
    return `delivery is ${source.status}, only failed deliveries replay`
  }
  if (!source.enabled) {
    return 'endpoint is disabled'
  }
  return null
}

export function makeWebhookReplay(
  store: ReplayStore,
  publisher: Pick<WebhookPublisher['Service'], 'enqueue'>
): WebhookEndpoints['Service']['replayDelivery'] {
  return Effect.fn('WebhookEndpoints.replayDelivery')(function* (input: ReplayInput) {
    const ctx = yield* WorkspaceContext
    const source = yield* store.source(input.deliveryId, ctx.workspace.id)
    if (source === null) {
      return yield* new WebhookDeliveryNotFound({ deliveryId: input.deliveryId })
    }
    const reason = replayRefusal(source, input)
    if (reason !== null) {
      return yield* new WebhookDispatchRejected({ reason })
    }
    const deliveryId = input.replayDeliveryId ?? (yield* newCapabilityId('whd'))
    const replay = yield* store.reserve({
      deliveryId,
      workspaceId: ctx.workspace.id,
      approvedEndpointUrl: input.expectedEndpointUrl,
      plan: planReplayedDelivery(source),
      auditEvent: {
        workspaceId: ctx.workspace.id,
        actorUserId: ctx.actor?.userId ?? null,
        actorType: ctx.actorType,
        eventType: 'webhook.delivery_replayed',
        targetType: 'webhook_endpoint',
        targetId: source.endpointId,
        metadata: { deliveryId, replayedFrom: source.id, eventType: source.eventType }
      }
    })
    if (
      replay === null ||
      replay.endpointId !== source.endpointId ||
      replay.replayedFrom !== source.id ||
      replay.approvedEndpointUrl !== (input.expectedEndpointUrl ?? null)
    ) {
      return yield* new WebhookDispatchRejected({
        reason: 'replay identity does not match the approved delivery'
      })
    }
    if (replay.status === 'pending') {
      // A queue failure remains visible; the reservation survives a stable-ID retry.
      yield* publisher.enqueue({
        endpointId: source.endpointId,
        workspaceId: ctx.workspace.id,
        eventType: source.eventType,
        deliveryId,
        payload: source.payload
      })
    }
    return { deliveryId }
  })
}
