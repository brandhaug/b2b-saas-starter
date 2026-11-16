import {
  type WebhookDeliveryId,
  type WebhookEndpointId,
  type WorkspaceId
} from '@b2b-saas-starter/db/ids'
import { Context, type Effect, type Redacted } from 'effect'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import {
  type FailureLadderAction,
  type Json,
  type WebhookDeliveryAttemptInput,
  type WebhookDeliveryStatus
} from './webhook-delivery-plan.ts'

/** Accepted-summary result. The worker follows the persisted status for queue
 * disposition and sends only the failure reaction named by persistence. */
export type RecordedWebhookAttempt = {
  readonly recorded: boolean
  readonly failureAction: FailureLadderAction
  readonly status: WebhookDeliveryStatus
  readonly consecutiveFailures: number
}

/** What a queue message may sign and send, read from persisted state. */
export type WebhookDispatchTarget = {
  readonly id: WebhookEndpointId
  readonly url: string
  /** Unwrapped only by the worker's signing call. */
  readonly signingSecrets: ReadonlyArray<Redacted.Redacted<string>>
  /** Authoritative queued delivery contents, present for queue execution. */
  readonly eventType: string
  readonly payload: Json
}

/**
 * Queue-execution state for `apps/background`. No `WorkspaceContext` exists on
 * the consumer, so the workspace ID travels in the queue message (stamped by
 * `WebhookPublisher` from the producing request's context) and every lookup
 * binds the delivery to its endpoint's current workspace.
 */
type WebhookDispatchInterface = {
  /** Persisted outcomes that must not dispatch again on queue redelivery. */
  readonly isDeliverySettled: (input: {
    readonly deliveryId: WebhookDeliveryId
    readonly endpointId: WebhookEndpointId
    readonly workspaceId: WorkspaceId
  }) => Effect.Effect<boolean, CapabilityUnavailable>

  /**
   * The lookup filters on `(endpointId, workspaceId)` and resolves `null` on a
   * cross-workspace mismatch, so a forged or misrouted message never yields
   * another workspace's signing secret. `signingSecrets` holds every secret a
   * dispatch may currently sign with — the current one, plus the rotated-out
   * one while its grace window is open.
   */
  readonly getDispatchTarget: (
    endpointId: WebhookEndpointId,
    workspaceId: WorkspaceId,
    /** Queue execution supplies the producer-stamped delivery identity. */
    deliveryId: WebhookDeliveryId
  ) => Effect.Effect<WebhookDispatchTarget | null, CapabilityUnavailable>

  /** Atomically records immutable HTTP evidence and advances summary, streak,
   * terminal audit, and automatic disable only for an accepted observation. */
  readonly recordDeliveryAttempt: (
    input: WebhookDeliveryAttemptInput
  ) => Effect.Effect<RecordedWebhookAttempt, CapabilityUnavailable>

  /** One terminal observation per delivery, including never-dispatched outcomes.
   * DLQ retries cannot create extra observations or increment the HTTP count.
   * Existing HTTP evidence and replay provenance remain on the summary. */
  readonly recordTerminalDeliveryAttempt: (input: {
    readonly deliveryId: WebhookDeliveryId
    readonly endpointId: WebhookEndpointId
    readonly workspaceId: WorkspaceId
    readonly eventType: string
    readonly attempts: number
    readonly status: 'failed_permanent' | 'dead_lettered'
    readonly failureReason?: string | null
    readonly payload: Json
  }) => Effect.Effect<
    { readonly deliveryId: WebhookDeliveryId } & RecordedWebhookAttempt,
    CapabilityUnavailable
  >
}

export class WebhookDispatch extends Context.Service<
  WebhookDispatch,
  WebhookDispatchInterface
>()('@b2b-saas-starter/capabilities/WebhookDispatch') {}
