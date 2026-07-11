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
export const BookingRequest = Schema.Struct({
  id: BookingRequestId,
  bookingPartyId: BookingPartyId,
  position: Schema.Number,
  providerPreference: Schema.NullOr(Schema.Literals(['specific', 'any'])),
  providerId: Schema.NullOr(Schema.String),
  primaryServiceId: Schema.NullOr(Schema.String),
  serviceIds: Schema.Array(Schema.String),
  holdId: Schema.NullOr(Schema.String),
  customerAccountId: Schema.NullOr(Schema.String),
  customerDetails: Schema.NullOr(
    Schema.Struct({
      name: Schema.String,
      email: Schema.String,
      phone: Schema.NullOr(Schema.String)
    })
  ),
  startsAt: Schema.NullOr(Schema.String),
  endsAt: Schema.NullOr(Schema.String)
})
export const BookingParty = Schema.Struct({
  id: BookingPartyId,
  bookingSessionId: Schema.String,
  shopId: ShopId,
  lifecycle: BookingPartyLifecycle,
  currency: Schema.String,
  locale: Schema.String,
  version: Schema.Number,
  requests: Schema.Array(BookingRequest)
})
export class BookingPartyConflict extends Schema.TaggedErrorClass<BookingPartyConflict>()(
  'BookingPartyConflict',
  { bookingPartyId: Schema.String, expectedVersion: Schema.Number }
) {}

export class BookingPartyNotFound extends Schema.TaggedErrorClass<BookingPartyNotFound>()(
  'BookingPartyNotFound',
  { bookingPartyId: BookingPartyId }
) {}

export type BookingPartiesShape = {
  readonly findById: (
    bookingPartyId: string
  ) => Effect.Effect<
    typeof BookingParty.Type,
    BookingPartyNotFound | CapabilityUnavailable
  >
}

export class BookingParties extends Context.Service<
  BookingParties,
  BookingPartiesShape
>()('@b2b-saas-starter/capabilities/BookingParties') {}
