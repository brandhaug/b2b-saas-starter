import { type WebhookDeliveryId } from '@b2b-saas-starter/db/ids'
import {
  WebhookEndpoints,
  type WebhookEndpoint,
  type CreatedWebhookEndpoint
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { Effect } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { WorkspaceCaller } from '@b2b-saas-starter/capabilities/workspace-context'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import { workspacePage, type WorkspacePageFrame } from './page-frame'
import {
  type CreateWebhookInput,
  type EndpointMutationInput,
  type ReplayDeliveryInput,
  type UpdateEndpointInput,
  type WorkspaceWebhooksInput,
  type WorkspaceWebhooksPayload
} from './webhooks'
import {
  WEBHOOK_DELIVERY_READ_CONCURRENCY,
  WebhookDeliveries
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-deliveries'

/**
 * `webhook:list` is the page's own read permission and a hard gate.
 */
const webhooksPayload: WorkspacePageFrame<WorkspaceWebhooksPayload> = workspacePage(
  { webhook: ['list'] },
  () =>
    Effect.gen(function* () {
      const webhooks = yield* WebhookEndpoints
      const deliveryLog = yield* WebhookDeliveries
      const endpoints = yield* Effect.forEach(
        yield* webhooks.list,
        (endpoint) =>
          Effect.map(
            deliveryLog.listDeliveries({ endpointId: endpoint.id }),
            (deliveries) => ({
              ...endpoint,
              deliveries
            })
          ),
        { concurrency: WEBHOOK_DELIVERY_READ_CONCURRENCY }
      )
      return { endpoints }
    })
)

export async function loadWorkspaceWebhooksHandler(
  input: WorkspaceWebhooksInput
): Promise<WorkspaceWebhooksPayload> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    webhooksPayload,
    WorkspaceCaller.user(session.user.id)
  )
}

export async function createWebhookEndpointHandler(
  input: CreateWebhookInput
): Promise<CreatedWebhookEndpoint> {
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
    WorkspaceCaller.user(session.user.id)
  )
}

export async function updateWebhookEndpointHandler(
  input: UpdateEndpointInput
): Promise<WebhookEndpoint> {
  const session = await requireRequestSession()
  // Rest-destructuring drops `workspaceSlug` and keeps every optional field
  // exactly as the schema decoded it — absent fields stay absent.
  const { workspaceSlug, ...patch } = input
  return runWorkspaceCapabilities(
    workspaceSlug,
    Effect.gen(function* () {
      // The session gate above proves who is asking; this proves they may.
      // Disabling is `update { enabled: false }` — there is no separate
      // disable mutation to keep in step. An unknown endpoint fails the
      // capability's typed `WebhookEndpointNotFound`, which `callServerFn`
      // folds into the calling form's failure message.
      yield* requireWorkspacePermission({ webhook: ['update'] })
      const webhooks = yield* WebhookEndpoints
      return yield* webhooks.update(patch)
    }),
    WorkspaceCaller.user(session.user.id)
  )
}

export async function rotateWebhookSecretHandler(
  input: EndpointMutationInput
): Promise<string> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      // Resolves the new signing secret to show once. An unknown endpoint
      // fails the capability's typed `WebhookEndpointNotFound` — folded into
      // the panel's failure message like every other rejection.
      yield* requireWorkspacePermission({ webhook: ['rotateSecret'] })
      const webhooks = yield* WebhookEndpoints
      const rotated = yield* webhooks.rotateSecret({ endpointId: input.endpointId })
      return rotated.signingSecret
    }),
    WorkspaceCaller.user(session.user.id)
  )
}

export async function replayWebhookDeliveryHandler(
  input: ReplayDeliveryInput
): Promise<{ readonly deliveryId: WebhookDeliveryId }> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      // Fails with the capability's typed errors
      // (`WebhookDeliveryNotFound` 404, `WebhookDispatchRejected` 409) which
      // `callServerFn` folds into the drawer's failure message.
      yield* requireWorkspacePermission({ webhook: ['replay'] })
      const deliveryLog = yield* WebhookDeliveries
      return yield* deliveryLog.replayDelivery({ deliveryId: input.deliveryId })
    }),
    WorkspaceCaller.user(session.user.id)
  )
}

export async function sendTestEventHandler(
  input: EndpointMutationInput
): Promise<{ readonly deliveryId: WebhookDeliveryId }> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ webhook: ['test'] })
      const webhooks = yield* WebhookEndpoints
      return yield* webhooks.sendTestEvent({ endpointId: input.endpointId })
    }),
    WorkspaceCaller.user(session.user.id)
  )
}

export async function listWebhookDeliveryAttemptsHandler(input: ReplayDeliveryInput) {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ webhook: ['list'] })
      const deliveryLog = yield* WebhookDeliveries
      return yield* deliveryLog.listDeliveryAttempts({ deliveryId: input.deliveryId })
    }),
    WorkspaceCaller.user(session.user.id)
  )
}
