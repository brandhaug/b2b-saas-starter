import {
  appointmentAuthorizationInventory,
  classifyAppointmentRestrictedMutation
} from './booking/restricted-access-policy.ts'
import {
  makeAuthorizationMatrix,
  type AuthorizationCapabilityInventory,
  type DomainMutationRequest,
  type SharedCommandInput
} from './foundation/index.ts'
import {
  classifySubscriptionRestrictedMutation,
  subscriptionAuthorizationInventory
} from './subscriptions/restricted-access-policy.ts'

const ownerCapability = (
  capability: string,
  operations: AuthorizationCapabilityInventory['operations']
): AuthorizationCapabilityInventory => ({ capability, operations })

export const merchantCapabilityAuthorizationInventory = [
  ownerCapability('merchant-catalog', [
    'read',
    'mutation',
    'search',
    'bulk-operation',
    'export'
  ]),
  ownerCapability('scheduling', ['read', 'mutation', 'search', 'bulk-operation']),
  appointmentAuthorizationInventory,
  ownerCapability('customer-directory', [
    'read',
    'mutation',
    'search',
    'bulk-operation',
    'export'
  ]),
  subscriptionAuthorizationInventory,
  ownerCapability('notifications', [
    'read',
    'mutation',
    'search',
    'bulk-operation',
    'callback',
    'queued-action'
  ]),
  ownerCapability('waiting-list', [
    'read',
    'mutation',
    'search',
    'bulk-operation',
    'queued-action'
  ]),
  ownerCapability('walk-ins', ['read', 'mutation', 'search', 'bulk-operation']),
  ownerCapability('reporting-export', ['read', 'search', 'export', 'queued-action']),
  ownerCapability('privacy-request', [
    'read',
    'mutation',
    'search',
    'export',
    'queued-action'
  ]),
  ownerCapability('developer-platform', [
    'read',
    'mutation',
    'search',
    'callback',
    'queued-action'
  ]),
  ownerCapability('pricing', ['read', 'mutation']),
  ownerCapability('payments', ['read', 'mutation', 'callback']),
  ownerCapability('gift-cards', ['read', 'mutation']),
  ownerCapability('customer-identity', ['read', 'mutation', 'search']),
  ownerCapability('customer-engagement', ['read', 'mutation', 'search']),
  ownerCapability('scheduled-work', ['read', 'mutation', 'search', 'queued-action']),
  ownerCapability('operations', ['read', 'mutation', 'search', 'bulk-operation'])
] as const satisfies readonly AuthorizationCapabilityInventory[]

export const authorizationMatrix = makeAuthorizationMatrix(
  merchantCapabilityAuthorizationInventory
)

export const classifyRestrictedMutation = (
  input: SharedCommandInput,
  request: DomainMutationRequest | undefined,
  context: { readonly resourceExists: boolean }
) =>
  classifyAppointmentRestrictedMutation(input, request, context) ||
  classifySubscriptionRestrictedMutation(input, request, context)
