import {
  loadWorkspaceBillingHandler,
  loadPublicPricingHandler,
  startCheckoutHandler,
  startPortalSessionHandler,
  reconcileCheckoutReturnHandler,
  selectBillingResourcesHandler
} from '../../lib/server/billing.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/billing'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group
    .handle('loadWorkspaceBillingServerFn', ({ payload }) =>
      invoke(() => loadWorkspaceBillingHandler(payload))
    )
    .handle('loadPublicPricingServerFn', () => invoke(() => loadPublicPricingHandler()))
    .handle('startCheckoutServerFn', ({ payload }) =>
      invoke(() => startCheckoutHandler(payload))
    )
    .handle('startPortalSessionServerFn', ({ payload }) =>
      invoke(() => startPortalSessionHandler(payload))
    )
    .handle('reconcileCheckoutReturnServerFn', ({ payload }) =>
      invoke(() => reconcileCheckoutReturnHandler(payload))
    )
    .handle('selectBillingResourcesServerFn', ({ payload }) =>
      invoke(() => selectBillingResourcesHandler(payload))
    )
)
export { Api }
