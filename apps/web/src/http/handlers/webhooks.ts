import {
  createWebhookEndpointHandler,
  loadWorkspaceWebhooksHandler,
  updateWebhookEndpointHandler,
  rotateWebhookSecretHandler,
  replayWebhookDeliveryHandler,
  sendTestEventHandler,
  listWebhookDeliveryAttemptsHandler
} from '../../lib/server/webhooks.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/webhooks'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group
    .handle('createWebhookEndpointServerFn', ({ payload }) =>
      invoke(() => createWebhookEndpointHandler(payload))
    )
    .handle('loadWorkspaceWebhooksServerFn', ({ payload }) =>
      invoke(() => loadWorkspaceWebhooksHandler(payload))
    )
    .handle('updateWebhookEndpointServerFn', ({ payload }) =>
      invoke(() => updateWebhookEndpointHandler(payload))
    )
    .handle('rotateWebhookSecretServerFn', ({ payload }) =>
      invoke(() => rotateWebhookSecretHandler(payload))
    )
    .handle('replayWebhookDeliveryServerFn', ({ payload }) =>
      invoke(() => replayWebhookDeliveryHandler(payload))
    )
    .handle('sendTestEventServerFn', ({ payload }) =>
      invoke(() => sendTestEventHandler(payload))
    )
    .handle('listWebhookDeliveryAttemptsServerFn', ({ payload }) =>
      invoke(() => listWebhookDeliveryAttemptsHandler(payload))
    )
)
export { Api }
