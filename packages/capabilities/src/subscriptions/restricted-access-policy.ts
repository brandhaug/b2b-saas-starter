import type {
  AuthorizationCapabilityInventory,
  DomainMutationRequest,
  SharedCommandInput
} from '../foundation/index.ts'

export const subscriptionRestrictedAccessPolicy = {
  capability: 'merchant-subscription',
  operation: 'mutation',
  exception: 'billing-recovery',
  requestKind: 'merchant-subscription-billing-recovery'
} as const

export const classifySubscriptionRestrictedMutation = (
  input: SharedCommandInput,
  request: DomainMutationRequest | undefined,
  context: { readonly resourceExists: boolean }
) => {
  if (
    input.capability !== subscriptionRestrictedAccessPolicy.capability ||
    input.operation !== subscriptionRestrictedAccessPolicy.operation ||
    request?.kind !== subscriptionRestrictedAccessPolicy.requestKind ||
    !context.resourceExists
  )
    return false
  try {
    const payload = Schema.decodeUnknownSync(
      Schema.Struct({
        subscriptionId: Schema.String.check(Schema.isMinLength(1)),
        action: Schema.Literals(['retry-payment', 'update-payment-method'])
      })
    )(JSON.parse(request.payloadJson))
    return payload.subscriptionId === input.aggregateId
  } catch {
    return false
  }
}

export const subscriptionAuthorizationInventory = {
  capability: 'merchant-subscription',
  operations: ['read', 'mutation', 'callback', 'queued-action'],
  restrictedExceptions: {
    mutation: [subscriptionRestrictedAccessPolicy.exception]
  }
} as const satisfies AuthorizationCapabilityInventory
import { Schema } from 'effect'
