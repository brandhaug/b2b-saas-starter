import { type AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import {
  WebhookEndpoints,
  type UpdateWebhookEndpointInput,
  type WebhookEndpoint,
  type CreatedWebhookEndpoint,
  type WebhookDispatchRejected,
  type WebhookEndpointNotFound,
  type WebhookDeliveryNotFound
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { type InvalidWebhookUrl } from '@b2b-saas-starter/capabilities/developer-platform/webhook-url'
import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { Effect, Schema, type Scope } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import { unreadCount, workspacePage, type WorkspacePageFrame } from './page-frame'
import { type WorkspaceWebhooksPayload } from './webhooks'

/**
 * The webhook effects, the payload assembly and their server-only wiring,
 * reached only through dynamic `import()` inside the handlers of
 * `webhooks.ts`: handler bodies are stripped from the client build, so this
 * graph ships to the server alone. `webhooks.ts` holds the client-safe half
 * and the reason for the split.
 *
 * The mutation effects are exported taking only the mutation input, so what
 * is testable without a request or an auth runtime is exactly the behaviour:
 * the permission gates and the hand-off to the capability (typed 404
 * included) — `webhooks.test.ts` drives them against fixture layers.
 */

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

/** The webhooks route's loader, as a plain function for tests. */
export function loadWorkspaceWebhooks(input: {
  readonly workspaceSlug: string
  readonly userId: string
}): Promise<WorkspaceWebhooksPayload> {
  return runWorkspaceCapabilities(input.workspaceSlug, webhooksPayload, {
    userId: input.userId
  })
}

/**
 * The server functions' input schemas, decoded here rather than in
 * `webhooks.ts`: the client stub never runs validators, and a module-level
 * Schema construct in the client-safe file would drag the Effect Schema
 * chunk onto every page. All input constraints live in the schema — no
 * imperative re-validation.
 */
const CreateWebhookInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  url: Schema.NonEmptyString,
  events: Schema.NonEmptyArray(Schema.NonEmptyString)
})

const decodeCreateInput = Schema.decodeUnknownSync(CreateWebhookInput)

const WorkspaceWebhooksInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

const decodeWebhooksInput = Schema.decodeUnknownSync(WorkspaceWebhooksInput)

const EndpointMutationSchema = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  endpointId: Schema.NonEmptyString
})

const decodeEndpointMutation = Schema.decodeUnknownSync(EndpointMutationSchema)

const UpdateEndpointInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  endpointId: Schema.NonEmptyString,
  url: Schema.optionalKey(Schema.NonEmptyString),
  events: Schema.optionalKey(Schema.NonEmptyArray(Schema.NonEmptyString)),
  enabled: Schema.optionalKey(Schema.Boolean)
})

const decodeUpdateEndpoint = Schema.decodeUnknownSync(UpdateEndpointInput)

const ReplayDeliveryInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  deliveryId: Schema.NonEmptyString
})

const decodeReplayDelivery = Schema.decodeUnknownSync(ReplayDeliveryInput)

const SendTestEventInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  endpointId: Schema.NonEmptyString
})

const decodeSendTestEvent = Schema.decodeUnknownSync(SendTestEventInput)

export async function createWebhookEndpointHandler(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
  data: unknown
): Promise<CreatedWebhookEndpoint> {
  const input = decodeCreateInput(data)
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      // The session gate above proves who is asking; this proves they may.
      yield* requireWorkspacePermission({ webhook: ['create'] })
      const webhooks = yield* WebhookEndpoints
      // The entitlement gate and webhook fan-out live inside the capability,
      // below the interface — identical for every surface.
      return yield* webhooks.create({
        url: input.url,
        events: input.events
      })
    }),
    { userId: session.user.id }
  )
}

export async function loadWorkspaceWebhooksHandler(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
  data: unknown
): Promise<WorkspaceWebhooksPayload> {
  const input = decodeWebhooksInput(data)
  const session = await requireRequestSession()
  return loadWorkspaceWebhooks({
    workspaceSlug: input.workspaceSlug,
    userId: session.user.id
  })
}

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
    // The patch is the input: the gate above is the only decision this effect
    // adds, and the capability's own input contract types the patch's
    // optionality — absent fields stay absent.
    return yield* webhooks.update(input)
  })
}

export async function updateWebhookEndpointHandler(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
  data: unknown
): Promise<WebhookEndpoint> {
  const input = decodeUpdateEndpoint(data)
  const session = await requireRequestSession()
  // Rest-destructuring drops `workspaceSlug` and keeps every optional field
  // exactly as the schema decoded it — absent fields stay absent.
  const { workspaceSlug, ...patch } = input
  return runWorkspaceCapabilities(workspaceSlug, updateWebhookEndpoint(patch), {
    userId: session.user.id
  })
}

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

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
export async function rotateWebhookSecretHandler(data: unknown): Promise<string> {
  const input = decodeEndpointMutation(data)
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    rotateWebhookSecret({
      endpointId: input.endpointId
    }),
    { userId: session.user.id }
  )
}

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

export async function replayWebhookDeliveryHandler(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
  data: unknown
): Promise<{ readonly deliveryId: string }> {
  const input = decodeReplayDelivery(data)
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    replayWebhookDelivery({ deliveryId: input.deliveryId }),
    { userId: session.user.id }
  )
}

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

export async function sendTestEventHandler(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
  data: unknown
): Promise<{ readonly deliveryId: string }> {
  const input = decodeSendTestEvent(data)
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    sendTestEvent({ endpointId: input.endpointId }),
    { userId: session.user.id }
  )
}
