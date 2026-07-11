import { Context, Effect, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
import { CustomerAccountId } from '../ids.ts'

export const CustomerAccount = Schema.Struct({
  id: CustomerAccountId,
  merchantId: Schema.String,
  email: Schema.String,
  displayName: Schema.NullOr(Schema.String),
  phone: Schema.NullOr(Schema.String)
})
export class CustomerAccountNotFound extends Schema.TaggedErrorClass<CustomerAccountNotFound>()(
  'CustomerAccountNotFound',
  { customerAccountId: CustomerAccountId }
) {}
export type CustomerIdentityShape = {
  readonly findById: (
    customerAccountId: string
  ) => Effect.Effect<
    typeof CustomerAccount.Type,
    CustomerAccountNotFound | CapabilityUnavailable
  >
}
export class CustomerIdentity extends Context.Service<
  CustomerIdentity,
  CustomerIdentityShape
>()('@b2b-saas-starter/capabilities/CustomerIdentity') {}
