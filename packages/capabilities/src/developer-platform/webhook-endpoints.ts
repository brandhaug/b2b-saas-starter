import { WebhookEndpointId } from '@b2b-saas-starter/db/ids'
import { Context, Effect, Schema } from 'effect'

import { type PlanLimitExceeded } from '@b2b-saas-starter/billing/errors'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type ListPageInput, type Page } from '../internal/keyset-cursor.ts'
import { validateWebhookUrl, InvalidWebhookUrl } from './webhook-url.ts'
import { type WorkspaceContext } from '../workspace-context.ts'
import { type DispatchedDelivery } from './webhook-deliveries.ts'

/**
 * No endpoint matched in this workspace. Raised by the operator mutations
 * (`update`, `delete`, `sendTestEvent`, `rotateSecret`) — one typed 404 for
 * the whole surface.
 */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class WebhookEndpointNotFound extends Schema.TaggedError<WebhookEndpointNotFound>()(
  'WebhookEndpointNotFound',
  { endpointId: WebhookEndpointId },
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
  id: WebhookEndpointId,
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

type CreateWebhookEndpointInput = {
  readonly url: string
  readonly events: ReadonlyArray<string>
  // `| undefined` on purpose: callers read `description` off an optional request
  // field, and both adapters treat an absent key and an explicit `undefined` the
  // same way. Without it every caller has to hand-build the input key by key.
  readonly description?: string | undefined
}

// The vocabulary lives in the `webhook-events.ts` leaf (same values, no
// `effect` imports) so the management UI can offer the checkbox set without
// dragging this module's Schema graph into the browser.
export { WEBHOOK_EVENT_TYPES } from './webhook-events.ts'
export type { WebhookEventType } from './webhook-events.ts'

/** Wire payload for endpoint creation, shared by the REST contract and the API worker. */
const WebhookUrl = Schema.NonEmptyString.check(Schema.isMaxLength(2048))
// Keep free-text event names for future producers, but bound both dimensions
// before persistence and audit metadata duplicate the subscription list.
const WebhookSubscriptions = Schema.Array(
  Schema.NonEmptyString.check(Schema.isMaxLength(128))
).check(Schema.isMinLength(1), Schema.isMaxLength(100))

export const CreateWebhookEndpointPayload = Schema.Struct({
  url: WebhookUrl,
  events: WebhookSubscriptions,
  description: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(2000)))
})
export type CreateWebhookEndpointPayload = typeof CreateWebhookEndpointPayload.Type

export type UpdateWebhookEndpointInput = {
  readonly endpointId: WebhookEndpointId
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
  url: Schema.optionalKey(WebhookUrl),
  events: Schema.optionalKey(WebhookSubscriptions),
  enabled: Schema.optionalKey(Schema.Boolean)
})
export type UpdateWebhookEndpointPayload = typeof UpdateWebhookEndpointPayload.Type

type DeleteWebhookEndpointInput = {
  readonly endpointId: WebhookEndpointId
}

type SendTestEventInput = {
  readonly endpointId: WebhookEndpointId
}

/**
 * The synthetic event type a test send dispatches. It is operator vocabulary,
 * not a domain event: it never appears in `WEBHOOK_EVENT_TYPES`, subscriptions
 * do not gate it (the send is already addressed to one endpoint), and receivers
 * see it as the `eventType` of a normally signed delivery.
 */
export const WEBHOOK_TEST_EVENT_TYPE = 'webhook.test_event'

type RotateWebhookSecretInput = {
  readonly endpointId: WebhookEndpointId
}

type WebhookEndpointsInterface = {
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
}

/**
 * Workspace endpoint management: the settings page, REST and MCP surfaces.
 * Delivery history is `WebhookDeliveries`, cross-workspace operator reads are
 * `WebhookDeliveryAdmin`, and queue execution state is `WebhookDispatch`.
 */
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
