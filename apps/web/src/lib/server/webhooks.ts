import {
  type CreatedWebhookEndpoint,
  type UpdateWebhookEndpointInput,
  type WebhookDispatchRejected,
  type WebhookEndpointNotFound,
  type WebhookDeliveryNotFound,
  WebhookEndpoints,
  type WebhookEndpoint
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { type WebhookDelivery } from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { type AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { type InvalidWebhookUrl } from '@b2b-saas-starter/capabilities/developer-platform/webhook-url'
import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { type WorkspaceViewer } from '@/lib/permissions'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Schema, type Scope } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import { unreadCount, workspacePage, type WorkspacePageFrame } from './page-frame'

// All input constraints live in the schema — no imperative re-validation.
const CreateWebhookInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  url: Schema.NonEmptyString,
  events: Schema.NonEmptyArray(Schema.NonEmptyString)
})

const decodeCreateInput = Schema.decodeUnknownSync(CreateWebhookInput)

export const createWebhookEndpointServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeCreateInput(input))
  .handler(async ({ data }): Promise<CreatedWebhookEndpoint> => {
    const session = await requireRequestSession()
    return runWorkspaceCapabilities(
      data.workspaceSlug,
      Effect.gen(function* () {
        // The session gate above proves who is asking; this proves they may.
        yield* requireWorkspacePermission({ webhook: ['create'] })
        const webhooks = yield* WebhookEndpoints
        // The entitlement gate and webhook fan-out live inside the capability,
        // below the interface — identical for every surface.
        return yield* webhooks.create({
          url: data.url,
          events: data.events
        })
      }),
      { userId: session.user.id }
    )
  })

/**
 * The webhooks payload.
 *
 * Like tokens, reading webhooks is itself a permission: `webhook:list` is
 * withheld from a plain `member`, so the page hard-gates on it — a member
 * meeting the URL directly gets the denial, not an empty list. Deliveries are
 * fetched per endpoint so each endpoint card can show its recent attempts.
 */
export type WorkspaceWebhooksPayload = {
  readonly viewer: WorkspaceViewer | null
  readonly unreadCount: number
  readonly endpoints: ReadonlyArray<
    WebhookEndpoint & {
      readonly deliveries: ReadonlyArray<WebhookDelivery>
    }
  >
}

/**
 * `webhook:list` is the page's own read permission and a hard gate.
 */
const webhooksPayload: WorkspacePageFrame<WorkspaceWebhooksPayload> = workspacePage(
  { webhook: ['list'] },
  () =>
    Effect.gen(function* () {
      const webhooks = yield* WebhookEndpoints
      const segment = yield* Effect.all(
        { unreadCount, endpoints: webhooks.list },
        { concurrency: 'unbounded' }
      )
      const endpoints = yield* Effect.forEach(
        segment.endpoints,
        (endpoint) =>
          Effect.map(
            webhooks.listDeliveries({ endpointId: endpoint.id }),
            (deliveries) => ({ ...endpoint, deliveries })
          ),
        { concurrency: 'unbounded' }
      )
      return { unreadCount: segment.unreadCount, endpoints }
    })
)

/** The webhooks route's loader. */
export function loadWorkspaceWebhooks(input: {
  readonly workspaceSlug: string
  readonly userId: string
}): Promise<WorkspaceWebhooksPayload> {
  return runWorkspaceCapabilities(input.workspaceSlug, webhooksPayload, {
    userId: input.userId
  })
}

// All input constraints live in the schema — no imperative re-validation.
const EndpointMutationSchema = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  endpointId: Schema.NonEmptyString
})

const decodeEndpointMutation = Schema.decodeUnknownSync(EndpointMutationSchema)

// All input constraints live in the schema — no imperative re-validation.
const UpdateEndpointInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  endpointId: Schema.NonEmptyString,
  url: Schema.optionalKey(Schema.NonEmptyString),
  events: Schema.optionalKey(Schema.NonEmptyArray(Schema.NonEmptyString)),
  enabled: Schema.optionalKey(Schema.Boolean)
})

const decodeUpdateEndpoint = Schema.decodeUnknownSync(UpdateEndpointInput)

/**
 * The effect below the session gate: proves the actor may update
 * (`webhook:update`), then hands the patch to the capability. Disabling is
 * `update { enabled: false }` — there is no separate disable mutation to keep
 * in step. Exported so tests drive it against fixture layers without a
 * request or an auth runtime; an unknown endpoint fails the capability's
 * typed `WebhookEndpointNotFound`, which `callServerFn` folds into the
 * calling form's failure message.
 */
export function updateWebhookEndpoint(
  input: UpdateWebhookEndpointInput
): Effect.Effect<
  WebhookEndpoint,
  | AuthorizationDenied
  | CapabilityUnavailable
  | InvalidWebhookUrl
  | WebhookEndpointNotFound,
  Scope.Scope | WorkspaceContext | WebhookEndpoints
> {
  return Effect.gen(function* () {
    yield* requireWorkspacePermission({ webhook: ['update'] })
    const webhooks = yield* WebhookEndpoints
    const patch: UpdateWebhookEndpointInput = { endpointId: input.endpointId }
    if (input.url !== undefined) {
      patch.url = input.url
    }
    if (input.events !== undefined) {
      patch.events = [...input.events]
    }
    if (input.enabled !== undefined) {
      patch.enabled = input.enabled
    }
    return yield* webhooks.update(patch)
  })
}

export const updateWebhookEndpointServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeUpdateEndpoint(input))
  .handler(async ({ data }): Promise<WebhookEndpoint> => {
    const session = await requireRequestSession()
    // Statements, not a conditional spread: an absent field stays absent. The
    // capability's own input contract types the patch.
    const input: UpdateWebhookEndpointInput = { endpointId: data.endpointId }
    if (data.url !== undefined) {
      input.url = data.url
    }
    if (data.events !== undefined) {
      input.events = data.events
    }
    if (data.enabled !== undefined) {
      input.enabled = data.enabled
    }
    return runWorkspaceCapabilities(data.workspaceSlug, updateWebhookEndpoint(input), {
      userId: session.user.id
    })
  })

/**
 * Resolves the new signing secret to show once. An unknown endpoint fails the
 * capability's typed `WebhookEndpointNotFound` — folded into the panel's
 * failure message like every other rejection. Exported for tests, same seam
 * as `updateWebhookEndpoint`.
 */
export function rotateWebhookSecret(input: {
  readonly endpointId: string
}): Effect.Effect<
  string,
  AuthorizationDenied | CapabilityUnavailable | WebhookEndpointNotFound,
  Scope.Scope | WorkspaceContext | WebhookEndpoints
> {
  return Effect.gen(function* () {
    yield* requireWorkspacePermission({ webhook: ['rotateSecret'] })
    const webhooks = yield* WebhookEndpoints
    const rotated = yield* webhooks.rotateSecret(input)
    return rotated.signingSecret
  })
}

export const rotateWebhookSecretServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeEndpointMutation(input))
  .handler(async ({ data }): Promise<string> => {
    const session = await requireRequestSession()
    return runWorkspaceCapabilities(
      data.workspaceSlug,
      rotateWebhookSecret({
        endpointId: data.endpointId
      }),
      { userId: session.user.id }
    )
  })

// All input constraints live in the schema — no imperative re-validation.
const ReplayDeliveryInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  deliveryId: Schema.NonEmptyString
})

const decodeReplayDelivery = Schema.decodeUnknownSync(ReplayDeliveryInput)

/**
 * The effect below the session gate for a replay. Fails with the capability's
 * typed errors (`WebhookDeliveryNotFound` 404, `WebhookDispatchRejected` 409)
 * which `callServerFn` folds into the drawer's failure message.
 */
export function replayWebhookDelivery(input: {
  readonly deliveryId: string
}): Effect.Effect<
  { readonly deliveryId: string },
  | AuthorizationDenied
  | CapabilityUnavailable
  | WebhookDeliveryNotFound
  | WebhookDispatchRejected,
  Scope.Scope | WorkspaceContext | WebhookEndpoints
> {
  return Effect.gen(function* () {
    yield* requireWorkspacePermission({ webhook: ['replay'] })
    const webhooks = yield* WebhookEndpoints
    return yield* webhooks.replayDelivery(input)
  })
}

export const replayWebhookDeliveryServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeReplayDelivery(input))
  .handler(async ({ data }): Promise<{ readonly deliveryId: string }> => {
    const session = await requireRequestSession()
    return runWorkspaceCapabilities(
      data.workspaceSlug,
      replayWebhookDelivery({ deliveryId: data.deliveryId }),
      { userId: session.user.id }
    )
  })

// All input constraints live in the schema — no imperative re-validation.
const SendTestEventInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  endpointId: Schema.NonEmptyString
})

const decodeSendTestEvent = Schema.decodeUnknownSync(SendTestEventInput)

/** Same seam as `replayWebhookDelivery`, for the endpoint-level test send. */
export function sendTestEvent(input: {
  readonly endpointId: string
}): Effect.Effect<
  { readonly deliveryId: string },
  | AuthorizationDenied
  | CapabilityUnavailable
  | WebhookEndpointNotFound
  | WebhookDispatchRejected,
  Scope.Scope | WorkspaceContext | WebhookEndpoints
> {
  return Effect.gen(function* () {
    yield* requireWorkspacePermission({ webhook: ['test'] })
    const webhooks = yield* WebhookEndpoints
    return yield* webhooks.sendTestEvent(input)
  })
}

export const sendTestEventServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeSendTestEvent(input))
  .handler(async ({ data }): Promise<{ readonly deliveryId: string }> => {
    const session = await requireRequestSession()
    return runWorkspaceCapabilities(
      data.workspaceSlug,
      sendTestEvent({ endpointId: data.endpointId }),
      { userId: session.user.id }
    )
  })
