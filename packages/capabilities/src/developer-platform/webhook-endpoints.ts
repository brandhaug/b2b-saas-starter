import { Context, Effect, Schema, type Option } from 'effect'

import { type CapabilityUnavailable, type PlanLimitExceeded } from '../errors.ts'
import { literalTuple } from '../internal/literal-tuple.ts'
import { type ListPageInput, type Page } from '../internal/keyset-cursor.ts'
import {
  type ListWebhookDeliveriesInput,
  type WebhookDelivery,
  type WebhookDeliveryAttemptInput
} from './webhook-delivery-plan.ts'
import { validateWebhookUrl, InvalidWebhookUrl } from './webhook-url.ts'
import { type WorkspaceContext } from '../workspace-context.ts'

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

export type DisableWebhookEndpointInput = {
  readonly endpointId: string
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
   * The paged read the REST and MCP list surfaces serve (ADR 0054). The wire
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

  /** Resolves `true` when an endpoint was disabled, `false` when nothing matched. */
  readonly disable: (
    input: DisableWebhookEndpointInput
  ) => Effect.Effect<boolean, CapabilityUnavailable, WorkspaceContext>
  /**
   * Resolves `Option.some({ signingSecret })` with the newly persisted secret,
   * or `Option.none()` when no endpoint matched in this workspace (no secret
   * is minted in that case).
   */
  readonly rotateSecret: (
    input: RotateWebhookSecretInput
  ) => Effect.Effect<
    Option.Option<{ readonly signingSecret: string }>,
    CapabilityUnavailable,
    WorkspaceContext
  >

  /**
   * Background-worker surface — no `WorkspaceContext` exists on the queue
   * consumer, so the workspace ID travels in the queue message (stamped by
   * `WebhookPublisher` from the producing request's context) and is verified
   * here: the lookup filters on `(endpointId, workspaceId)` and resolves
   * `null` on a cross-workspace mismatch, so a forged or misrouted message
   * never yields another workspace's signing secret.
   */
  readonly getDispatchTarget: (
    endpointId: string,
    workspaceId: string
  ) => Effect.Effect<
    {
      readonly id: string
      readonly url: string
      readonly signingSecret: string
    } | null,
    CapabilityUnavailable
  >

  readonly recordDeliveryAttempt: (
    input: WebhookDeliveryAttemptInput
  ) => Effect.Effect<void, CapabilityUnavailable>

  /**
   * Terminal delivery rows for outcomes that never dispatched (the SSRF guard
   * rejected the endpoint URL at dispatch time) or exhausted the queue (dead
   * letter). The capability owns the whole row — delivery id minting, the
   * timestamp, and the terminal audit event batched with it — so callers hand
   * over only what the queue message carries and cannot assemble a half-shaped
   * attempt input.
   */
  readonly recordTerminalDeliveryAttempt: (input: {
    readonly endpointId: string
    readonly workspaceId: string
    readonly eventType: string
    readonly attempts: number
    readonly status: 'failed_permanent' | 'dead_lettered'
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
