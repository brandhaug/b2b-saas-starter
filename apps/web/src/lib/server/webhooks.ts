import {
  type CreatedWebhookEndpoint,
  WebhookEndpoints,
  type WebhookEndpoint
} from '@b2b-saas-starter/capabilities/src/developer-platform/webhook-endpoints.ts'
import { type WebhookDelivery } from '@b2b-saas-starter/capabilities/src/developer-platform/webhook-delivery-plan.ts'
import { type AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/src/errors.ts'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/src/notifications/notification-feed.ts'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/src/workspace-context.ts'
import { type WorkspaceRole } from '@b2b-saas-starter/capabilities/src/governance/workspace-identity.ts'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Option, Schema, type Scope } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'

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
          events: data.events,
          actorUserId: session.user.id
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
  readonly viewer: { readonly role: WorkspaceRole } | null
  readonly unreadCount: number
  readonly endpoints: readonly (WebhookEndpoint & {
    readonly deliveries: readonly WebhookDelivery[]
  })[]
}

/**
 * `webhook:list` is the page's own read permission and a hard gate.
 */
const webhooksPayload: Effect.Effect<
  WorkspaceWebhooksPayload,
  AuthorizationDenied | CapabilityUnavailable,
  Scope.Scope | WorkspaceContext | WebhookEndpoints | NotificationFeed
> = Effect.gen(function* () {
  yield* requireWorkspacePermission({ webhook: ['list'] })
  const ctx = yield* WorkspaceContext
  const feed = yield* NotificationFeed
  const webhooks = yield* WebhookEndpoints
  const [unreadCount, endpoints] = yield* Effect.all(
    [feed.unreadCount, webhooks.list],
    {
      concurrency: 'unbounded'
    }
  )
  const withDeliveries = yield* Effect.forEach(
    endpoints,
    (endpoint) =>
      Effect.map(
        webhooks.listDeliveries({ endpointId: endpoint.id }),
        (deliveries) => ({ ...endpoint, deliveries })
      ),
    { concurrency: 'unbounded' }
  )
  return {
    viewer: ctx.actor ? { role: ctx.actor.role } : null,
    unreadCount,
    endpoints: withDeliveries
  }
})

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

/**
 * The effect below the session gate: proves the actor may disable
 * (`webhook:disable`, declared → enforced here), then hands the mutation to
 * the capability. Exported so tests drive it against fixture layers without a
 * request or an auth runtime. Disabling an unknown id is not an error — the
 * capability resolves `false` and skips the audit row.
 */
export function disableWebhookEndpoint(input: {
  readonly endpointId: string
  readonly actorUserId: string
}): Effect.Effect<
  boolean,
  AuthorizationDenied | CapabilityUnavailable,
  Scope.Scope | WorkspaceContext | WebhookEndpoints
> {
  return Effect.gen(function* () {
    yield* requireWorkspacePermission({ webhook: ['disable'] })
    const webhooks = yield* WebhookEndpoints
    return yield* webhooks.disable(input)
  })
}

export const disableWebhookEndpointServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeEndpointMutation(input))
  .handler(async ({ data }): Promise<boolean> => {
    const session = await requireRequestSession()
    return runWorkspaceCapabilities(
      data.workspaceSlug,
      disableWebhookEndpoint({
        endpointId: data.endpointId,
        actorUserId: session.user.id
      }),
      { userId: session.user.id }
    )
  })

/**
 * Resolves the new signing secret to show once, or `null` when no endpoint
 * matched in this workspace (no secret is minted in that case). Exported for
 * tests, same seam as `disableWebhookEndpoint`.
 */
export function rotateWebhookSecret(input: {
  readonly endpointId: string
  readonly actorUserId: string
}): Effect.Effect<
  string | null,
  AuthorizationDenied | CapabilityUnavailable,
  Scope.Scope | WorkspaceContext | WebhookEndpoints
> {
  return Effect.gen(function* () {
    yield* requireWorkspacePermission({ webhook: ['rotateSecret'] })
    const webhooks = yield* WebhookEndpoints
    const rotated = yield* webhooks.rotateSecret(input)
    return Option.isSome(rotated) ? rotated.value.signingSecret : null
  })
}

export const rotateWebhookSecretServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeEndpointMutation(input))
  .handler(async ({ data }): Promise<string | null> => {
    const session = await requireRequestSession()
    return runWorkspaceCapabilities(
      data.workspaceSlug,
      rotateWebhookSecret({
        endpointId: data.endpointId,
        actorUserId: session.user.id
      }),
      { userId: session.user.id }
    )
  })
