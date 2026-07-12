import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { customerAccounts, Database } from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import {
  CustomerAccountNotFound,
  CustomerIdentity,
  SeedCustomerIdentity
} from './index.ts'

type Account = typeof import('./index.ts').CustomerAccount.Type
export { SeedCustomerIdentity }
export const LiveCustomerIdentity: Layer.Layer<CustomerIdentity, never, Database> =
  Layer.effect(
    CustomerIdentity,
    Effect.gen(function* () {
      const db = yield* Database
      const unavailable = () =>
        Effect.fail(
          new CapabilityUnavailable({
            capability: 'customer-identity',
            reason: 'write_adapter_not_configured'
          })
        )
      return {
        findById: (customerAccountId) =>
          Effect.flatMap(
            orUnavailable('customer-identity')(
              db
                .select()
                .from(customerAccounts)
                .where(eq(customerAccounts.id, customerAccountId))
                .limit(1)
            ),
            ([account]) =>
              account
                ? Effect.succeed({
                    id: account.id,
                    merchantId: account.merchantId,
                    email: account.email,
                    displayName: account.displayName,
                    phone: account.phone
                  })
                : Effect.fail(new CustomerAccountNotFound({ customerAccountId }))
          ),
        verifyAccount: unavailable,
        associateBooking: unavailable,
        lookupMerchantOwnership: unavailable,
        recoverConfirmation: unavailable,
        configureProviderPasscode: unavailable,
        verifyProviderPasscode: unavailable,
        authorizeProviderProof: unavailable
      }
    })
  )
