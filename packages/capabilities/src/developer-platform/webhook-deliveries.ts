import { WebhookDeliveryId } from '@b2b-saas-starter/db/ids'
import { Context, type Effect, Schema } from 'effect'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type WorkspaceContext } from '../workspace-context.ts'
import {
  type ListWebhookDeliveriesInput,
  type WebhookDelivery,
  type WebhookDeliveryAttempt,
  type WebhookDeliveryStatus
} from './webhook-delivery-plan.ts'
import {
  type WebhookDispatchRejected,
  type WebhookEndpoint
} from './webhook-endpoints.ts'

/**
 * No delivery row matched in this workspace. Distinct from
 * `WebhookEndpointNotFound` because a replay addresses a delivery, and a
 * foreign delivery id must not read as a missing endpoint.
 */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class WebhookDeliveryNotFound extends Schema.TaggedError<WebhookDeliveryNotFound>()(
  'WebhookDeliveryNotFound',
  { deliveryId: WebhookDeliveryId },
  { httpApiStatus: 404 }
) {}

export type DispatchedDelivery = {
  /**
   * The id of the `pending` delivery row the dispatch created. The queue
   * consumer records its attempts against this id, so the row a replay or test
   * created is the row that resolves.
   */
  readonly deliveryId: WebhookDeliveryId
}

/**
 * How many endpoints' `listDeliveries` reads a caller runs at once when it
 * reads every endpoint's history. Endpoints are unlimited on paid plans, and a
 * Worker invocation holds six outbound connections; this leaves room for the
 * caller's other reads.
 */
export const WEBHOOK_DELIVERY_READ_CONCURRENCY = 4

export type ReplayWebhookDeliveryInput = {
  readonly deliveryId: WebhookDeliveryId
  /** Stable identity for a caller that must reconcile an uncertain enqueue. */
  readonly replayDeliveryId?: WebhookDeliveryId | undefined
  readonly expectedEndpointUrl?: string | undefined
  readonly expectedStatus?: WebhookDeliveryStatus | undefined
}

/**
 * A workspace's delivery history and operator replay. Every read and the
 * replay source join through the endpoint to `WorkspaceContext`, so a foreign
 * delivery id reads as absent.
 */
type WebhookDeliveriesInterface = {
  readonly listDeliveries: (
    input: ListWebhookDeliveriesInput
  ) => Effect.Effect<
    ReadonlyArray<WebhookDelivery>,
    CapabilityUnavailable,
    WorkspaceContext
  >

  readonly inspectDelivery: (input: {
    readonly deliveryId: WebhookDeliveryId
  }) => Effect.Effect<
    {
      readonly endpoint: WebhookEndpoint
      readonly delivery: WebhookDelivery
      readonly attempts: ReadonlyArray<WebhookDeliveryAttempt>
    },
    CapabilityUnavailable | WebhookDeliveryNotFound,
    WorkspaceContext
  >

  /**
   * Immutable attempt evidence for one of this workspace's deliveries, in
   * attempt order. A delivery from another workspace yields an empty list.
   */
  readonly listDeliveryAttempts: (input: {
    readonly deliveryId: WebhookDeliveryId
  }) => Effect.Effect<
    ReadonlyArray<WebhookDeliveryAttempt>,
    CapabilityUnavailable,
    WorkspaceContext
  >

  /**
   * Re-enqueues a failed delivery verbatim: a **new** `pending` row carrying
   * the original payload, attempts reset to zero, and a `replayedFrom` link to
   * the source row. Fails `WebhookDeliveryNotFound` when no delivery matched in
   * this workspace, `WebhookDispatchRejected` when there is nothing honest to
   * re-send (the delivery never failed, records no payload, or its endpoint is
   * disabled or gone).
   */
  readonly replayDelivery: (
    input: ReplayWebhookDeliveryInput
  ) => Effect.Effect<
    DispatchedDelivery,
    CapabilityUnavailable | WebhookDeliveryNotFound | WebhookDispatchRejected,
    WorkspaceContext
  >
}

export class WebhookDeliveries extends Context.Service<
  WebhookDeliveries,
  WebhookDeliveriesInterface
>()('@b2b-saas-starter/capabilities/WebhookDeliveries') {}
