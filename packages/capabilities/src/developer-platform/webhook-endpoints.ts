import { Context, Effect, Schema } from 'effect'

import { type CapabilityUnavailable, type PlanLimitExceeded } from '../errors.ts'
import { literalTuple } from '../internal/literal-tuple.ts'
import { type ListPageInput, type Page } from '../internal/keyset-cursor.ts'
import {
  type Json,
  type ListWebhookDeliveriesInput,
  type WebhookDelivery,
  type WebhookDeliveryAttemptInput
} from './webhook-delivery-plan.ts'
import { validateWebhookUrl, InvalidWebhookUrl } from './webhook-url.ts'
import { type WorkspaceContext } from '../workspace-context.ts'

/**
 * No endpoint matched in this workspace. Raised by the operator mutations
 * (`update`, `delete`, `sendTestEvent`, `rotateSecret`) — one typed 404 for
 * the whole surface.
 */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class WebhookEndpointNotFound extends Schema.TaggedError<WebhookEndpointNotFound>()(
  'WebhookEndpointNotFound',
  { endpointId: Schema.String },
  { httpApiStatus: 404 }
) {}

/**
 * No delivery row matched in this workspace. Distinct from
 * {@link WebhookEndpointNotFound} because a replay addresses a delivery, and a
 * foreign delivery id must not read as a missing endpoint.
 */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class WebhookDeliveryNotFound extends Schema.TaggedError<WebhookDeliveryNotFound>()(
  'WebhookDeliveryNotFound',
  { deliveryId: Schema.String },
  { httpApiStatus: 404 }
) {}

/**
 * A dispatch the workspace refuses: an endpoint that is disabled, a delivery
 * that never failed. Same reading as `MembershipChangeRejected` — the request
 * was answerable and the answer is no — naming the operator dispatch surface.
 */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class WebhookDispatchRejected extends Schema.TaggedError<WebhookDispatchRejected>()(
  'WebhookDispatchRejected',
  { reason: Schema.String },
  { httpApiStatus: 409 }
) {}

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

export type CreateWebhookEndpointInput = {
  readonly url: string
  readonly events: ReadonlyArray<string>
  // `| undefined` on purpose: callers read `description` off an optional request
  // field, and both adapters treat an absent key and an explicit `undefined` the
  // same way. Without it every caller has to hand-build the input key by key.
  readonly description?: string | undefined
}

/**
 * The event types this starter currently publishes (the mutating capabilities
 * fan out below their interface — `ApiTokenRegistry` and `WebhookEndpoints.create`).
 * Subscriptions are free-text strings so a producer can grow without a
 * migration; this list is what the management UI offers as checkboxes.
 */
export const WEBHOOK_EVENT_TYPES = literalTuple(
  'api_token.created',
  'api_token.revoked',
  'webhook_endpoint.created'
)

/** The union of {@link WEBHOOK_EVENT_TYPES} — the vocabulary is written once. */
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number]

/** Wire payload for endpoint creation, shared by the REST contract and the API worker. */
export const CreateWebhookEndpointPayload = Schema.Struct({
  url: Schema.String,
  events: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
  description: Schema.optionalKey(Schema.String)
})
export type CreateWebhookEndpointPayload = typeof CreateWebhookEndpointPayload.Type

export type UpdateWebhookEndpointInput = {
  readonly endpointId: string
  /**
   * Each field is optional and mutable-on-purpose: callers build the patch
   * with statements (`if (x !== undefined) patch.url = x`), which the lint
   * rules require over conditional spreads. Only the provided ones change;
   * `undefined` and an absent key mean the same thing.
   */
  url?: string | undefined
  events?: ReadonlyArray<string> | undefined
  enabled?: boolean | undefined
}

/**
 * Wire payload for endpoint updates — the REST contract and the web server
 * functions share one schema, with every constraint declared here (an empty
 * subscription list is refused, same as at creation).
 */
export const UpdateWebhookEndpointPayload = Schema.Struct({
  url: Schema.optionalKey(Schema.String),
  events: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
  enabled: Schema.optionalKey(Schema.Boolean)
})
export type UpdateWebhookEndpointPayload = typeof UpdateWebhookEndpointPayload.Type

export type DeleteWebhookEndpointInput = {
  readonly endpointId: string
}

export type ReplayWebhookDeliveryInput = {
  readonly deliveryId: string
}

export type SendTestEventInput = {
  readonly endpointId: string
}

/**
 * The synthetic event type a test send dispatches. It is operator vocabulary,
 * not a domain event: it never appears in `WEBHOOK_EVENT_TYPES`, subscriptions
 * do not gate it (the send is already addressed to one endpoint), and receivers
 * see it as the `eventType` of a normally signed delivery.
 */
export const WEBHOOK_TEST_EVENT_TYPE = 'webhook.test_event'

export type DispatchedDelivery = {
  /**
   * The id of the `pending` delivery row the dispatch created. The queue
   * consumer records its attempts against this id, so the row a replay or test
   * created is the row that resolves.
   */
  readonly deliveryId: string
}

export type RotateWebhookSecretInput = {
  readonly endpointId: string
}

export type WebhookEndpointsInterface = {
  readonly list: Effect.Effect<
    ReadonlyArray<WebhookEndpoint>,
    CapabilityUnavailable,
    WorkspaceContext
  >

  /**
   * The paged read the REST and MCP list surfaces serve (ADR 0057). The wire
   * shape carries no timestamp, so pages run forward on `id ASC` — the one
   * stable order a caller can resume. `list` stays for the settings page's
   * whole-collection read.
   */
  readonly listPage: (
    input?: ListPageInput
  ) => Effect.Effect<Page<WebhookEndpoint>, CapabilityUnavailable, WorkspaceContext>

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
    ReadonlyArray<WebhookDelivery>,
    CapabilityUnavailable,
    WorkspaceContext
  >

  /**
   * Updates the mutable endpoint fields — URL, event subscriptions, and the
   * enabled flag: disabling is `update { enabled: false }`, re-enabling is
   * `update { enabled: true }` — one mutation path, one audit event. Only
   * provided fields change. Fails `WebhookEndpointNotFound` when no endpoint
   * matched in this workspace, and `InvalidWebhookUrl` when a provided URL
   * fails the SSRF/shape guard.
   */
  readonly update: (
    input: UpdateWebhookEndpointInput
  ) => Effect.Effect<
    WebhookEndpoint,
    CapabilityUnavailable | InvalidWebhookUrl | WebhookEndpointNotFound,
    WorkspaceContext
  >

  /**
   * Deletes the endpoint row; delivery rows cascade with it (the FK is
   * `onDelete: 'cascade'`). Fails `WebhookEndpointNotFound` when nothing
   * matched in this workspace.
   */
  readonly delete: (
    input: DeleteWebhookEndpointInput
  ) => Effect.Effect<
    void,
    CapabilityUnavailable | WebhookEndpointNotFound,
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

  /**
   * Dispatches one synthetic `webhook.test_event` to the endpoint so an
   * operator can prove a receiver's configuration end to end. Creates the same
   * `pending` row a replay does. Fails `WebhookEndpointNotFound` when no
   * endpoint matched, `WebhookDispatchRejected` when it is disabled.
   */
  readonly sendTestEvent: (
    input: SendTestEventInput
  ) => Effect.Effect<
    DispatchedDelivery,
    CapabilityUnavailable | WebhookEndpointNotFound | WebhookDispatchRejected,
    WorkspaceContext
  >

  /**
   * Shifts the signing secret: the replacement is returned so the caller can
   * show it once, and the secret it replaces keeps signing deliveries for the
   * 24h grace window (`planSecretRotation` / `activeSigningSecrets` in the
   * delivery plan), so a receiver can roll without dropping deliveries. No
   * secret is minted when no endpoint matched — the call fails
   * `WebhookEndpointNotFound` instead.
   */
  readonly rotateSecret: (
    input: RotateWebhookSecretInput
  ) => Effect.Effect<
    { readonly signingSecret: string },
    CapabilityUnavailable | WebhookEndpointNotFound,
    WorkspaceContext
  >

  /**
   * Background-worker surface — no `WorkspaceContext` exists on the queue
   * consumer, so the workspace ID travels in the queue message (stamped by
   * `WebhookPublisher` from the producing request's context) and is verified
   * here: the lookup filters on `(endpointId, workspaceId)` and resolves
   * `null` on a cross-workspace mismatch, so a forged or misrouted message
   * never yields another workspace's signing secret. `signingSecrets` holds
   * every secret a dispatch may currently sign with — the current one, plus
   * the rotated-out one while its grace window is open.
   */
  readonly getDispatchTarget: (
    endpointId: string,
    workspaceId: string
  ) => Effect.Effect<
    {
      readonly id: string
      readonly url: string
      readonly signingSecrets: ReadonlyArray<string>
    } | null,
    CapabilityUnavailable
  >

  readonly recordDeliveryAttempt: (
    input: WebhookDeliveryAttemptInput
  ) => Effect.Effect<void, CapabilityUnavailable>

  /**
   * Terminal delivery rows for outcomes that never dispatched (the SSRF guard
   * rejected the endpoint URL at dispatch time) or exhausted the queue (dead
   * letter). The capability owns the row — the timestamp, and the terminal
   * audit event batched with it — so callers hand over only what the queue
   * message carries and cannot assemble a half-shaped attempt input. The
   * delivery id and payload travel in the queue message: the id resolves the
   * message's existing attempt row (one row per message, same as the retry
   * path), and the recorded payload is what makes a terminal row replayable.
   */
  readonly recordTerminalDeliveryAttempt: (input: {
    readonly deliveryId: string
    readonly endpointId: string
    readonly workspaceId: string
    readonly eventType: string
    readonly attempts: number
    readonly status: 'failed_permanent' | 'dead_lettered'
    readonly payload: Json
  }) => Effect.Effect<{ readonly deliveryId: string }, CapabilityUnavailable>
}

export class WebhookEndpoints extends Context.Service<
  WebhookEndpoints,
  WebhookEndpointsInterface
>()('@b2b-saas-starter/capabilities/WebhookEndpoints') {}

// Shared SSRF/shape guard — both layers must reject the same URLs so tests
// against Seed exercise the same contract as Live.
export function ensureValidWebhookUrl(
  url: string
): Effect.Effect<void, InvalidWebhookUrl> {
  const check = validateWebhookUrl(url)
  if (check.valid) {
    return Effect.void
  }
  return Effect.fail(new InvalidWebhookUrl({ url, reason: check.reason }))
}
