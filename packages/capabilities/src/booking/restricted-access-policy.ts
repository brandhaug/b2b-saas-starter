import { Schema } from 'effect'
import type {
  AuthorizationCapabilityInventory,
  DomainMutationRequest,
  SharedCommandInput
} from '../foundation/index.ts'
import { appointmentSubscriptionOperation } from './appointment-subscription-access.ts'

export const appointmentRestrictedAccessPolicy = {
  capability: 'appointment',
  operation: 'mutation',
  exception: 'existing-commitment',
  requestKind: 'appointment-existing-commitment'
} as const

export const classifyAppointmentRestrictedMutation = (
  input: SharedCommandInput,
  request: DomainMutationRequest | undefined,
  context: { readonly resourceExists: boolean }
) => {
  if (
    input.capability !== appointmentRestrictedAccessPolicy.capability ||
    input.operation !== appointmentRestrictedAccessPolicy.operation ||
    request?.kind !== appointmentRestrictedAccessPolicy.requestKind ||
    !context.resourceExists
  )
    return false
  try {
    const payload = Schema.decodeUnknownSync(
      Schema.Struct({
        appointmentId: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
        bookingPartyId: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
        action: Schema.Literals([
          'merchant-create',
          'record-completed',
          'edit',
          'reschedule',
          'cancel',
          'complete',
          'no-show',
          'outcome-correction',
          'external-collection',
          'whole-party-cancel'
        ])
      })
    )(JSON.parse(request.payloadJson))
    const targetId = payload.appointmentId ?? payload.bookingPartyId
    return (
      targetId === input.aggregateId &&
      appointmentSubscriptionOperation(payload.action) === 'existing-commitment'
    )
  } catch {
    return false
  }
}

export const appointmentAuthorizationInventory = {
  capability: 'appointment',
  operations: [
    'read',
    'mutation',
    'search',
    'bulk-operation',
    'export',
    'callback',
    'queued-action'
  ],
  restrictedExceptions: {
    mutation: [appointmentRestrictedAccessPolicy.exception]
  }
} as const satisfies AuthorizationCapabilityInventory
