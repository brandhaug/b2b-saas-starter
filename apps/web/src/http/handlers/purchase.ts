import { loadPurchaseHandler } from '../../lib/server/purchase.effects'
import { startCheckoutHandler } from '../../lib/server/billing.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/purchase'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group
    .handle('loadPurchaseServerFn', ({ payload }) =>
      invoke(() => loadPurchaseHandler(payload))
    )
    .handle('continuePurchaseServerFn', ({ payload }) =>
      invoke(() => startCheckoutHandler(payload, payload))
    )
)
export { Api }
