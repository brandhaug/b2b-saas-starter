import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { customerAccounts, Database } from '@b2b-saas-starter/db'
import { orUnavailable } from '../internal/unavailable.ts'
import { CustomerAccountNotFound, CustomerIdentity } from './index.ts'

type Account = typeof import('./index.ts').CustomerAccount.Type
export const SeedCustomerIdentity = (
  records: readonly Account[] = []
): Layer.Layer<CustomerIdentity> =>
  Layer.succeed(CustomerIdentity)({
    findById: (customerAccountId) => {
      const account = records.find((record) => record.id === customerAccountId)
      return account
        ? Effect.succeed(account)
        : Effect.fail(new CustomerAccountNotFound({ customerAccountId }))
    }
  })
export const LiveCustomerIdentity: Layer.Layer<CustomerIdentity, never, Database> =
  Layer.effect(
    CustomerIdentity,
    Effect.gen(function* () {
      const db = yield* Database
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
          )
      }
    })
  )
