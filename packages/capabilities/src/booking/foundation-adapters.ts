import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import {
  bookingParties,
  bookingRequests,
  bookingRequestServices,
  Database
} from '@b2b-saas-starter/db'
import { orUnavailable } from '../internal/unavailable.ts'
import { BookingParties, BookingPartyNotFound } from './foundations.ts'

export const SeedBookingParties = (
  records: readonly (typeof import('./foundations.ts').BookingParty.Type)[] = []
): Layer.Layer<BookingParties> =>
  Layer.succeed(BookingParties)({
    findById: (bookingPartyId) => {
      const party = records.find((record) => record.id === bookingPartyId)
      return party
        ? Effect.succeed(party)
        : Effect.fail(new BookingPartyNotFound({ bookingPartyId }))
    }
  })

export const LiveBookingParties: Layer.Layer<BookingParties, never, Database> =
  Layer.effect(
    BookingParties,
    Effect.gen(function* () {
      const db = yield* Database
      return {
        findById: (bookingPartyId) =>
          Effect.gen(function* () {
            const [party] = yield* orUnavailable('booking-parties')(
              db
                .select()
                .from(bookingParties)
                .where(eq(bookingParties.id, bookingPartyId))
                .limit(1)
            )
            if (!party) return yield* new BookingPartyNotFound({ bookingPartyId })
            const requests = yield* orUnavailable('booking-parties')(
              db
                .select()
                .from(bookingRequests)
                .where(eq(bookingRequests.bookingPartyId, bookingPartyId))
            )
            const requestRecords = yield* Effect.all(
              requests.map((request) =>
                Effect.map(
                  orUnavailable('booking-parties')(
                    db
                      .select()
                      .from(bookingRequestServices)
                      .where(eq(bookingRequestServices.bookingRequestId, request.id))
                  ),
                  (services) => ({ request, services })
                )
              )
            )
            return {
              id: party.id,
              bookingSessionId: party.bookingSessionId,
              shopId: party.shopId,
              lifecycle: party.lifecycle,
              currency: party.currency,
              locale: party.locale,
              version: party.version,
              requests: requestRecords.map(({ request, services }) => ({
                id: request.id,
                bookingPartyId: request.bookingPartyId,
                position: request.position,
                providerPreference: request.providerPreference,
                providerId: request.providerId,
                primaryServiceId: request.primaryServiceId,
                serviceIds: services
                  .sort((left, right) => left.position - right.position)
                  .map((service) => service.serviceId),
                holdId: request.holdId,
                customerAccountId: request.customerAccountId,
                customerDetails: request.customerDetailsJson
                  ? (JSON.parse(request.customerDetailsJson) as {
                      name: string
                      email: string
                      phone: string | null
                    })
                  : null,
                startsAt: request.startsAt,
                endsAt: request.endsAt
              }))
            }
          })
      }
    })
  )
