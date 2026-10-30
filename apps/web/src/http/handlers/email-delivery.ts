import {
  loadOwnEmailDeliveryHandler,
  loadSystemEmailDeliveryHandler
} from '../../lib/server/email-delivery.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/email-delivery'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group
    .handle('loadOwnEmailDeliveryServerFn', () =>
      invoke(() => loadOwnEmailDeliveryHandler())
    )
    .handle('loadSystemEmailDeliveryServerFn', () =>
      invoke(() => loadSystemEmailDeliveryHandler())
    )
)
export { Api }
