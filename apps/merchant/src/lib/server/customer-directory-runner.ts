import { Effect, Layer } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db'
import {
  CustomerDirectory,
  type CustomerDirectoryError
} from '@b2b-saas-starter/capabilities/customer-directory'
import {
  liveMerchantContext,
  MerchantContext
} from '@b2b-saas-starter/capabilities/merchant-catalog'
import { CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'

type CustomerDirectoryDatabase = Parameters<typeof layerFromD1>[0]

export const runCustomerDirectoryRequest = <A>(input: {
  readonly db: CustomerDirectoryDatabase | undefined
  readonly userId: string
  readonly fingerprintKey: string
  readonly effect: Effect.Effect<
    A,
    CustomerDirectoryError,
    CustomerDirectory | MerchantContext
  >
}): Promise<A> => {
  if (!input.db)
    return Effect.runPromise(
      Effect.fail(
        new CapabilityUnavailable({
          capability: 'customer-directory',
          reason: 'Merchant App D1 binding is unavailable.'
        })
      )
    )

  const context = liveMerchantContext(input.userId).pipe(
    Layer.provide(layerFromD1(input.db))
  )
  return Effect.runPromise(
    Effect.provide(
      input.effect,
      Layer.merge(
        selectCapabilitiesLayer({
          DB: input.db,
          CUSTOMER_DIRECTORY_FINGERPRINT_KEY: input.fingerprintKey
        }),
        context
      )
    )
  )
}
