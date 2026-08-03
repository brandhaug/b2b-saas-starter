import { Context, Effect, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
import { BookingPartyId, BookingRequestId, ShopId } from '../ids.ts'

export const BookingPartyLifecycle = Schema.Literals([
  'active',
  'confirming',
  'confirmed',
  'expired',
  'abandoned'
])
export const BookingGuestDetails = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  phone: Schema.NullOr(Schema.String)
})
export const BookingRequest = Schema.Struct({
  id: BookingRequestId,
  bookingPartyId: BookingPartyId,
  position: Schema.Number,
  providerPreference: Schema.NullOr(Schema.Literals(['specific', 'any'])),
  providerId: Schema.NullOr(Schema.String),
  primaryServiceId: Schema.NullOr(Schema.String),
  serviceIds: Schema.Array(Schema.String),
  holdId: Schema.NullOr(Schema.String),
  holdExpiresAt: Schema.optional(Schema.NullOr(Schema.String)),
  customerAccountId: Schema.NullOr(Schema.String),
  customerDetails: Schema.NullOr(BookingGuestDetails),
  startsAt: Schema.NullOr(Schema.String),
  endsAt: Schema.NullOr(Schema.String)
})
export const BookingParty = Schema.Struct({
  id: BookingPartyId,
  bookingSessionId: Schema.String,
  shopId: ShopId,
  activeRequestId: Schema.optional(Schema.NullOr(BookingRequestId)),
  lifecycle: BookingPartyLifecycle,
  currency: Schema.String,
  locale: Schema.String,
  version: Schema.Number,
  requests: Schema.Array(BookingRequest)
})
export type BookingParty = typeof BookingParty.Type
export type BookingRequest = typeof BookingRequest.Type

export const BookingPartyContinuation = Schema.Struct({
  requestId: BookingRequestId,
  position: Schema.Number,
  step: Schema.Literals(['provider', 'services', 'time', 'guest'])
})
export type BookingPartyContinuation = typeof BookingPartyContinuation.Type

export const BookingRequestMaterial = Schema.Struct({
  providerPreference: Schema.optional(
    Schema.NullOr(Schema.Literals(['specific', 'any']))
  ),
  providerId: Schema.optional(Schema.NullOr(Schema.String)),
  primaryServiceId: Schema.optional(Schema.NullOr(Schema.String)),
  serviceIds: Schema.optional(Schema.Array(Schema.String)),
  customerDetails: Schema.optional(BookingRequest.fields.customerDetails)
})
export type BookingRequestMaterial = typeof BookingRequestMaterial.Type
export class BookingPartyConflict extends Schema.TaggedErrorClass<BookingPartyConflict>()(
  'BookingPartyConflict',
  { bookingPartyId: Schema.String, expectedVersion: Schema.Number }
) {}

export class BookingPartyNotFound extends Schema.TaggedErrorClass<BookingPartyNotFound>()(
  'BookingPartyNotFound',
  { bookingPartyId: BookingPartyId }
) {}

export type BookingPartiesShape = {
  readonly findForSession: (
    bookingSessionId: string
  ) => Effect.Effect<BookingParty, BookingPartyNotFound | CapabilityUnavailable>
  readonly findById: (
    bookingPartyId: string
  ) => Effect.Effect<
    typeof BookingParty.Type,
    BookingPartyNotFound | CapabilityUnavailable
  >
  readonly addRequest: (
    bookingPartyId: string,
    expectedVersion: number,
    now: string
  ) => Effect.Effect<
    BookingParty,
    BookingPartyNotFound | BookingPartyConflict | CapabilityUnavailable
  >
  readonly removeRequest: (
    bookingPartyId: string,
    requestId: string,
    expectedVersion: number,
    now: string
  ) => Effect.Effect<
    BookingParty,
    BookingPartyNotFound | BookingPartyConflict | CapabilityUnavailable
  >
  readonly reorderRequests: (
    bookingPartyId: string,
    requestIds: readonly string[],
    expectedVersion: number,
    now: string
  ) => Effect.Effect<
    BookingParty,
    BookingPartyNotFound | BookingPartyConflict | CapabilityUnavailable
  >
  readonly updateRequest: (
    bookingPartyId: string,
    requestId: string,
    material: BookingRequestMaterial,
    expectedVersion: number,
    now: string
  ) => Effect.Effect<
    BookingParty,
    BookingPartyNotFound | BookingPartyConflict | CapabilityUnavailable
  >
  readonly activateRequest: (
    bookingPartyId: string,
    requestId: string,
    expectedVersion: number,
    now: string
  ) => Effect.Effect<
    BookingParty,
    BookingPartyNotFound | BookingPartyConflict | CapabilityUnavailable
  >
  readonly continuation: (
    bookingPartyId: string,
    now: string
  ) => Effect.Effect<
    BookingPartyContinuation | null,
    BookingPartyNotFound | CapabilityUnavailable
  >
}

export const bookingPartyContinuation = (
  party: BookingParty,
  now: string
): BookingPartyContinuation | null => {
  for (const request of [...party.requests].sort((a, b) => a.position - b.position)) {
    const step = bookingRequestIncompleteStep(request, now)
    if (step) return { requestId: request.id, position: request.position, step }
  }
  return null
}

export const bookingRequestIncompleteStep = (request: BookingRequest, now: string) => {
  if (!request.providerPreference) return 'provider' as const
  if (!request.primaryServiceId || request.serviceIds.length === 0)
    return 'services' as const
  if (
    !request.holdId ||
    !request.startsAt ||
    !request.endsAt ||
    !request.holdExpiresAt ||
    request.holdExpiresAt <= now
  )
    return 'time' as const
  if (!request.customerDetails) return 'guest' as const
  return null
}

export const bookingRequestIsComplete = (request: BookingRequest, now: string) =>
  bookingRequestIncompleteStep(request, now) === null

export class BookingParties extends Context.Service<
  BookingParties,
  BookingPartiesShape
>()('@b2b-saas-starter/capabilities/BookingParties') {}
