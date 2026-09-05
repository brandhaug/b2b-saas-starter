import {
  type CreatedWebhookEndpoint,
  type WebhookEndpoint
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { type WebhookDelivery } from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { type WorkspaceViewer } from '@/lib/permissions'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

/**
 * The webhook server functions, in a **client-safe** module — the client-safe
 * half of the `webhooks.effects.ts` split; see apps/web/AGENTS.md for the
 * rule and `scripts/assert-client-boundary.mjs` for the enforcement. Each
 * input is written once, as its Effect Schema: the validator is the single
 * strict decode, and the derived type types both the client stub and the
 * effects handler.
 *
 * The behaviour itself is tested as the plain effects in the effects file
 * (`webhooks.test.ts` imports `webhooks.effects.ts` directly), driven with
 * fixture layers and fixture actors.
 */

const CreateWebhookInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  url: Schema.NonEmptyString,
  // Subscriptions are free-text strings by design (a producer can grow
  // without a migration); the management UI narrows them to the checkbox
  // vocabulary, the wire contract does not.
  events: Schema.NonEmptyArray(Schema.NonEmptyString)
})

const WorkspaceWebhooksInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

/** Rotate-secret and test-event share this shape: one endpoint, by id. */
const EndpointMutationInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  endpointId: Schema.NonEmptyString
})

const UpdateEndpointInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  endpointId: Schema.NonEmptyString,
  url: Schema.optionalKey(Schema.NonEmptyString),
  events: Schema.optionalKey(Schema.NonEmptyArray(Schema.NonEmptyString)),
  enabled: Schema.optionalKey(Schema.Boolean)
})

const ReplayDeliveryInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  deliveryId: Schema.NonEmptyString
})

export type CreateWebhookInput = typeof CreateWebhookInput.Type
export type WorkspaceWebhooksInput = typeof WorkspaceWebhooksInput.Type
export type EndpointMutationInput = typeof EndpointMutationInput.Type
export type UpdateEndpointInput = typeof UpdateEndpointInput.Type
export type ReplayDeliveryInput = typeof ReplayDeliveryInput.Type

export const createWebhookEndpointServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(CreateWebhookInput))
  .handler(async ({ data }): Promise<CreatedWebhookEndpoint> => {
    const { createWebhookEndpointHandler } = await import('./webhooks.effects')
    return createWebhookEndpointHandler(data)
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
 * The webhooks route's loader. `webhook:list` is the page's own read
 * permission and a hard gate.
 */
export const loadWorkspaceWebhooksServerFn = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(WorkspaceWebhooksInput))
  .handler(async ({ data }): Promise<WorkspaceWebhooksPayload> => {
    const { loadWorkspaceWebhooksHandler } = await import('./webhooks.effects')
    return loadWorkspaceWebhooksHandler(data)
  })

export const updateWebhookEndpointServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(UpdateEndpointInput))
  .handler(async ({ data }): Promise<WebhookEndpoint> => {
    const { updateWebhookEndpointHandler } = await import('./webhooks.effects')
    return updateWebhookEndpointHandler(data)
  })

export const rotateWebhookSecretServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(EndpointMutationInput))
  .handler(async ({ data }): Promise<string> => {
    const { rotateWebhookSecretHandler } = await import('./webhooks.effects')
    return rotateWebhookSecretHandler(data)
  })

export const replayWebhookDeliveryServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(ReplayDeliveryInput))
  .handler(async ({ data }): Promise<{ readonly deliveryId: string }> => {
    const { replayWebhookDeliveryHandler } = await import('./webhooks.effects')
    return replayWebhookDeliveryHandler(data)
  })

export const sendTestEventServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(EndpointMutationInput))
  .handler(async ({ data }): Promise<{ readonly deliveryId: string }> => {
    const { sendTestEventHandler } = await import('./webhooks.effects')
    return sendTestEventHandler(data)
  })
