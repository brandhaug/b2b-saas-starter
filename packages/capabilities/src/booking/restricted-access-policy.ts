import type {
  AuthorizationCapabilityInventory,
  DomainMutationRequest,
  SharedCommandInput
} from '../foundation/index.ts'

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
        appointmentId: Schema.String.check(Schema.isMinLength(1)),
        action: Schema.Literals(['cancel', 'reschedule', 'complete', 'no-show'])
      })
    )(JSON.parse(request.payloadJson))
    return payload.appointmentId === input.aggregateId
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
import { Schema } from 'effect'
