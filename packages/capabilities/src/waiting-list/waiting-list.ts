import { Context, Effect, Layer, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
import { hashSha256 } from '../internal/crypto.ts'

export const WaitingListStatus = Schema.Literals([
  'active',
  'fulfilled',
  'withdrawn',
  'expired'
])
export const AvailabilityOfferStatus = Schema.Literals([
  'pending',
  'accepted',
  'declined',
  'expired',
  'superseded'
])
export const WaitingListProviderPreference = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('any') }),
  Schema.Struct({ kind: Schema.Literal('specific'), providerId: Schema.String })
])
export const WaitingListRequest = Schema.Struct({
  serviceIds: Schema.Array(Schema.String),
  providerPreference: WaitingListProviderPreference,
  from: Schema.String,
  until: Schema.String,
  replacementAppointmentId: Schema.optional(Schema.String),
  replacementConfirmationRouteId: Schema.optional(Schema.String)
})
export const WaitingListCustomer = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  phone: Schema.optional(Schema.String)
})
export const OfferedSlot = Schema.Struct({
  shopId: Schema.String,
  serviceIds: Schema.Array(Schema.String),
  providerId: Schema.String,
  startsAt: Schema.String,
  endsAt: Schema.String
})

export type WaitingListRequest = typeof WaitingListRequest.Type
export type WaitingListCustomer = typeof WaitingListCustomer.Type
export type OfferedSlot = typeof OfferedSlot.Type

export const deriveOfferCandidates = (
  request: WaitingListRequest,
  slots: readonly OfferedSlot[]
): readonly OfferedSlot[] =>
  [...slots]
    .filter(
      (slot) =>
        slot.shopId.length > 0 &&
        request.serviceIds.every((serviceId) => slot.serviceIds.includes(serviceId)) &&
        slot.startsAt >= request.from &&
        slot.endsAt <= request.until &&
        (request.providerPreference.kind === 'any' ||
          slot.providerId === request.providerPreference.providerId)
    )
    .sort(
      (left, right) =>
        left.startsAt.localeCompare(right.startsAt) ||
        left.providerId.localeCompare(right.providerId)
    )

export type WaitingListApplicationRecord = {
  readonly id: string
  readonly shopId: string
  readonly status: typeof WaitingListStatus.Type
  readonly request: WaitingListRequest
  readonly customer: WaitingListCustomer
  readonly createdAt: string
  readonly expiresAt: string
}
export type AvailabilityOffer = {
  readonly id: string
  readonly applicationId: string
  readonly status: typeof AvailabilityOfferStatus.Type
  readonly slot: OfferedSlot
  readonly createdAt: string
  readonly expiresAt: string
  readonly respondedAt: string | null
  readonly bookingSessionId: string | null
}

export class WaitingListInvalid extends Schema.TaggedErrorClass<WaitingListInvalid>()(
  'WaitingListInvalid',
  {
    reason: Schema.Literals([
      'invalid_date_window',
      'services_required',
      'application_inactive',
      'candidate_ineligible'
    ])
  }
) {}
export class WaitingListApplicationUnavailable extends Schema.TaggedErrorClass<WaitingListApplicationUnavailable>()(
  'WaitingListApplicationUnavailable',
  { applicationId: Schema.String }
) {}
/** Deliberately uniform so stale links cannot reveal application or offer state. */
export class AvailabilityOfferUnavailable extends Schema.TaggedErrorClass<AvailabilityOfferUnavailable>()(
  'AvailabilityOfferUnavailable',
  { message: Schema.String }
) {}
export class PendingOfferExists extends Schema.TaggedErrorClass<PendingOfferExists>()(
  'PendingOfferExists',
  { applicationId: Schema.String }
) {}

export type OfferBookingResult = {
  readonly bookingSessionId: string
  readonly timeSlotHoldId: string
  readonly routeId: string
  readonly capability: string
  readonly purpose: 'new-booking' | 'appointment-replacement'
  readonly replacementAppointmentId?: string
}
export type DeliveredAvailabilityOffer = {
  readonly offer: AvailabilityOffer
  readonly capability: string
  readonly customer: WaitingListCustomer
  readonly merchantSlug: string
}
export class OfferBooking extends Context.Service<
  OfferBooking,
  {
    readonly createSessionWithHold: (input: {
      readonly application: WaitingListApplicationRecord
      readonly offer: AvailabilityOffer
      readonly now: string
    }) => Effect.Effect<OfferBookingResult, CapabilityUnavailable>
  }
>()('@b2b-saas-starter/capabilities/OfferBooking') {}

export const SeedOfferBooking: Layer.Layer<OfferBooking> = Layer.succeed(OfferBooking)({
  createSessionWithHold: () => {
    const suffix = crypto.randomUUID().replaceAll('-', '')
    return Effect.succeed({
      bookingSessionId: `bsn_${suffix}`,
      timeSlotHoldId: `hld_${suffix}`,
      routeId: `brt_${suffix}`,
      capability: suffix,
      purpose: 'new-booking'
    })
  }
})

type WaitingListError =
  | WaitingListInvalid
  | WaitingListApplicationUnavailable
  | PendingOfferExists
  | AvailabilityOfferUnavailable
  | CapabilityUnavailable
export type WaitingListShape = {
  readonly apply: (input: {
    id: string
    merchantSlug: string
    shopId: string
    capability: string
    request: WaitingListRequest
    customer: WaitingListCustomer
    now: string
    expiresAt: string
  }) => Effect.Effect<
    WaitingListApplicationRecord,
    WaitingListInvalid | CapabilityUnavailable
  >
  readonly withdraw: (
    applicationId: string,
    capability: string,
    now: string
  ) => Effect.Effect<
    WaitingListApplicationRecord,
    WaitingListInvalid | WaitingListApplicationUnavailable | CapabilityUnavailable
  >
  readonly inspectApplication: (
    applicationId: string,
    capability: string,
    now: string
  ) => Effect.Effect<
    WaitingListApplicationRecord,
    WaitingListApplicationUnavailable | CapabilityUnavailable
  >
  readonly offer: (input: {
    id: string
    applicationId: string
    slot: OfferedSlot
    capability: string
    now: string
    expiresAt: string
  }) => Effect.Effect<AvailabilityOffer, WaitingListError>
  readonly inspectOffer: (
    offerId: string,
    capability: string,
    now: string
  ) => Effect.Effect<
    AvailabilityOffer,
    AvailabilityOfferUnavailable | CapabilityUnavailable
  >
  readonly exchangeOfferAccess: (input: {
    offerId: string
    presentedCapability: string
    cookieCapability: string
    now: string
  }) => Effect.Effect<
    AvailabilityOffer,
    AvailabilityOfferUnavailable | CapabilityUnavailable
  >
  readonly declineOffer: (
    offerId: string,
    capability: string,
    now: string
  ) => Effect.Effect<
    AvailabilityOffer,
    AvailabilityOfferUnavailable | CapabilityUnavailable
  >
  readonly acceptOffer: (
    offerId: string,
    capability: string,
    now: string
  ) => Effect.Effect<
    OfferBookingResult,
    AvailabilityOfferUnavailable | CapabilityUnavailable
  >
  readonly expire: (
    now: string
  ) => Effect.Effect<{ applications: number; offers: number }, CapabilityUnavailable>
  readonly deliverAvailable: (
    now: string
  ) => Effect.Effect<readonly DeliveredAvailabilityOffer[], WaitingListError>
}
export class WaitingList extends Context.Service<WaitingList, WaitingListShape>()(
  '@b2b-saas-starter/capabilities/WaitingList'
) {}

export type SeedWaitingListStore = {
  readonly applications: Map<string, WaitingListApplicationRecord>
  readonly applicationCapabilityHashes: Map<string, string>
  readonly offers: Map<string, AvailabilityOffer & { capabilityHash: string }>
}
export const emptySeedWaitingListStore = (): SeedWaitingListStore => ({
  applications: new Map(),
  applicationCapabilityHashes: new Map(),
  offers: new Map()
})
const unavailable = () =>
  new AvailabilityOfferUnavailable({ message: 'Availability Offer unavailable' })
const activeAt = (offer: AvailabilityOffer, now: string) =>
  offer.status === 'pending' && offer.expiresAt > now

export const SeedWaitingList = (
  store: SeedWaitingListStore
): Layer.Layer<WaitingList, never, OfferBooking> =>
  Layer.effect(
    WaitingList,
    Effect.gen(function* () {
      const booking = yield* OfferBooking
      const authorize = (offerId: string, capability: string, now: string) =>
        Effect.gen(function* () {
          const offer = store.offers.get(offerId)
          const capabilityHash = yield* Effect.promise(() => hashSha256(capability))
          return offer &&
            offer.capabilityHash === capabilityHash &&
            activeAt(offer, now)
            ? offer
            : null
        })
      const authorizeApplication = (
        applicationId: string,
        capability: string,
        now: string
      ) =>
        Effect.gen(function* () {
          const application = store.applications.get(applicationId)
          const capabilityHash = yield* Effect.promise(() => hashSha256(capability))
          return application &&
            application.expiresAt > now &&
            store.applicationCapabilityHashes.get(applicationId) === capabilityHash
            ? application
            : null
        })
      return {
        apply: (input) =>
          Effect.gen(function* () {
            if (input.request.serviceIds.length === 0)
              return yield* new WaitingListInvalid({ reason: 'services_required' })
            if (
              input.request.from >= input.request.until ||
              input.expiresAt <= input.now
            )
              return yield* new WaitingListInvalid({ reason: 'invalid_date_window' })
            const { now, merchantSlug: _merchantSlug, capability, ...values } = input
            const application: WaitingListApplicationRecord = {
              ...values,
              createdAt: now,
              status: 'active'
            }
            store.applications.set(application.id, application)
            store.applicationCapabilityHashes.set(
              application.id,
              yield* Effect.promise(() => hashSha256(capability))
            )
            return application
          }),
        withdraw: (applicationId, capability, now) =>
          Effect.gen(function* () {
            const application = store.applications.get(applicationId)
            const capabilityHash = yield* Effect.promise(() => hashSha256(capability))
            if (
              !application ||
              store.applicationCapabilityHashes.get(applicationId) !== capabilityHash
            )
              return yield* new WaitingListApplicationUnavailable({ applicationId })
            if (application.status !== 'active')
              return yield* new WaitingListInvalid({ reason: 'application_inactive' })
            const withdrawn = { ...application, status: 'withdrawn' as const }
            store.applications.set(applicationId, withdrawn)
            for (const [id, offer] of store.offers)
              if (offer.applicationId === applicationId && activeAt(offer, now))
                store.offers.set(id, {
                  ...offer,
                  status: 'superseded',
                  respondedAt: now
                })
            return withdrawn
          }),
        inspectApplication: (applicationId, capability, now) =>
          Effect.flatMap(
            authorizeApplication(applicationId, capability, now),
            (application) =>
              application
                ? Effect.succeed(application)
                : Effect.fail(new WaitingListApplicationUnavailable({ applicationId }))
          ),
        offer: (input) =>
          Effect.gen(function* () {
            const application = store.applications.get(input.applicationId)
            if (!application)
              return yield* new WaitingListApplicationUnavailable({
                applicationId: input.applicationId
              })
            if (application.status !== 'active' || application.expiresAt <= input.now)
              return yield* new WaitingListInvalid({ reason: 'application_inactive' })
            const existing = store.offers.get(input.id)
            if (existing?.applicationId === input.applicationId) return existing
            for (const offer of store.offers.values())
              if (
                offer.applicationId === input.applicationId &&
                activeAt(offer, input.now)
              )
                return yield* new PendingOfferExists({
                  applicationId: input.applicationId
                })
            const { now, capability, ...values } = input
            const offer: AvailabilityOffer & { capabilityHash: string } = {
              ...values,
              capabilityHash: yield* Effect.promise(() => hashSha256(capability)),
              createdAt: now,
              status: 'pending',
              respondedAt: null,
              bookingSessionId: null
            }
            store.offers.set(input.id, offer)
            return offer
          }),
        inspectOffer: (id, capability, now) =>
          Effect.flatMap(authorize(id, capability, now), (offer) =>
            offer ? Effect.succeed(offer) : Effect.fail(unavailable())
          ),
        exchangeOfferAccess: (input) =>
          Effect.gen(function* () {
            const offer = yield* authorize(
              input.offerId,
              input.presentedCapability,
              input.now
            )
            if (!offer) return yield* unavailable()
            store.offers.set(input.offerId, {
              ...offer,
              capabilityHash: yield* Effect.promise(() =>
                hashSha256(input.cookieCapability)
              )
            })
            return offer
          }),
        declineOffer: (id, capability, now) =>
          Effect.gen(function* () {
            const offer = yield* authorize(id, capability, now)
            if (!offer) return yield* unavailable()
            const declined = { ...offer, status: 'declined' as const, respondedAt: now }
            store.offers.set(id, declined)
            return declined
          }),
        acceptOffer: (id, capability, now) =>
          Effect.gen(function* () {
            const offer = yield* authorize(id, capability, now)
            if (!offer) return yield* unavailable()
            const application = store.applications.get(offer.applicationId)
            if (!application || application.status !== 'active')
              return yield* unavailable()
            // Claim before yielding to the booking port so concurrent accepts cannot
            // both create a session. Roll back the claim if booking fails.
            store.offers.set(id, {
              ...offer,
              status: 'accepted',
              respondedAt: now
            })
            const result = yield* booking
              .createSessionWithHold({ application, offer, now })
              .pipe(
                Effect.tapError(() => Effect.sync(() => store.offers.set(id, offer)))
              )
            store.offers.set(id, {
              ...offer,
              status: 'accepted',
              respondedAt: now,
              bookingSessionId: result.bookingSessionId
            })
            store.applications.set(application.id, {
              ...application,
              status: 'fulfilled'
            })
            return result
          }),
        expire: (now) =>
          Effect.sync(() => {
            let applications = 0,
              offers = 0
            for (const [id, offer] of store.offers)
              if (offer.status === 'pending' && offer.expiresAt <= now) {
                store.offers.set(id, { ...offer, status: 'expired' })
                offers++
              }
            for (const [id, application] of store.applications)
              if (application.status === 'active' && application.expiresAt <= now) {
                store.applications.set(id, { ...application, status: 'expired' })
                for (const [offerId, offer] of store.offers)
                  if (offer.applicationId === id && offer.status === 'pending') {
                    store.offers.set(offerId, {
                      ...offer,
                      status: 'superseded',
                      respondedAt: now
                    })
                    offers++
                  }
                applications++
              }
            return { applications, offers }
          }),
        deliverAvailable: () => Effect.succeed([])
      }
    })
  )
