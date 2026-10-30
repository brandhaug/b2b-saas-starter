import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/webhooks'
import {
  CreateWebhookEndpointPayload,
  UpdateWebhookEndpointPayload,
  type WebhookEndpoint
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { type WebhookDelivery } from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { type WorkspaceViewer } from '@/lib/permissions'
import { Schema } from 'effect'

const CreateWebhookInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  url: CreateWebhookEndpointPayload.fields.url,
  events: CreateWebhookEndpointPayload.fields.events
})

const WorkspaceWebhooksInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

const EndpointMutationInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  endpointId: Schema.NonEmptyString
})

const UpdateEndpointInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  endpointId: Schema.NonEmptyString,
  ...UpdateWebhookEndpointPayload.fields
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

export type WorkspaceWebhooksPayload = {
  readonly viewer: WorkspaceViewer | null
  readonly unreadCount: number
  readonly endpoints: ReadonlyArray<
    WebhookEndpoint & {
      readonly deliveries: ReadonlyArray<WebhookDelivery>
    }
  >
}

export const Api = HttpApi.make('web-webhooks').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post(
      'createWebhookEndpointServerFn',
      '/api/web/createWebhookEndpointServerFn',
      {
        payload: CreateWebhookInput,
        success: Responses.createWebhookEndpointServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'loadWorkspaceWebhooksServerFn',
      '/api/web/loadWorkspaceWebhooksServerFn',
      {
        payload: WorkspaceWebhooksInput,
        success: Responses.loadWorkspaceWebhooksServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'updateWebhookEndpointServerFn',
      '/api/web/updateWebhookEndpointServerFn',
      {
        payload: UpdateEndpointInput,
        success: Responses.updateWebhookEndpointServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'rotateWebhookSecretServerFn',
      '/api/web/rotateWebhookSecretServerFn',
      {
        payload: EndpointMutationInput,
        success: Responses.rotateWebhookSecretServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'replayWebhookDeliveryServerFn',
      '/api/web/replayWebhookDeliveryServerFn',
      {
        payload: ReplayDeliveryInput,
        success: Responses.replayWebhookDeliveryServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post('sendTestEventServerFn', '/api/web/sendTestEventServerFn', {
      payload: EndpointMutationInput,
      success: Responses.sendTestEventServerFnResponse,
      error: WebErrors
    }),
    HttpApiEndpoint.post(
      'listWebhookDeliveryAttemptsServerFn',
      '/api/web/listWebhookDeliveryAttemptsServerFn',
      {
        payload: ReplayDeliveryInput,
        success: Responses.listWebhookDeliveryAttemptsServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const createWebhookEndpointServerFn = dataCall(
  browser,
  CreateWebhookInput,
  (client, payload) => client.calls.createWebhookEndpointServerFn({ payload })
)

export const loadWorkspaceWebhooksServerFn = dataCall(
  browser,
  WorkspaceWebhooksInput,
  (client, payload) => client.calls.loadWorkspaceWebhooksServerFn({ payload })
)

export const updateWebhookEndpointServerFn = dataCall(
  browser,
  UpdateEndpointInput,
  (client, payload) => client.calls.updateWebhookEndpointServerFn({ payload })
)

export const rotateWebhookSecretServerFn = dataCall(
  browser,
  EndpointMutationInput,
  (client, payload) => client.calls.rotateWebhookSecretServerFn({ payload })
)

export const replayWebhookDeliveryServerFn = dataCall(
  browser,
  ReplayDeliveryInput,
  (client, payload) => client.calls.replayWebhookDeliveryServerFn({ payload })
)

export const sendTestEventServerFn = dataCall(
  browser,
  EndpointMutationInput,
  (client, payload) => client.calls.sendTestEventServerFn({ payload })
)

export const listWebhookDeliveryAttemptsServerFn = dataCall(
  browser,
  ReplayDeliveryInput,
  (client, payload) => client.calls.listWebhookDeliveryAttemptsServerFn({ payload })
)
