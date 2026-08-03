import type { CustomerConfirmation } from '@b2b-saas-starter/capabilities/booking'
import type { StoredAppointmentSnapshot } from '@b2b-saas-starter/db'
import { Schema } from 'effect'

const PresentationService = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(['primary', 'additional']),
  name: Schema.String,
  durationMinutes: Schema.Number,
  priceMinor: Schema.Number,
  currency: Schema.String
})

const PresentationSnapshot = Schema.Struct({
  startsAt: Schema.String,
  endsAt: Schema.String,
  providerPreference: Schema.Union([
    Schema.Struct({ kind: Schema.Literal('any') }),
    Schema.Struct({ kind: Schema.Literal('specific'), providerId: Schema.String })
  ]),
  assignedProvider: Schema.Struct({ id: Schema.String, displayName: Schema.String }),
  services: Schema.Array(PresentationService),
  durationMinutes: Schema.Number,
  currency: Schema.String,
  totalMinor: Schema.Number,
  merchantTimezone: Schema.String,
  checkoutPath: Schema.Literals(['pay_in_person', 'online_payment']),
  policyAcceptance: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        policyId: Schema.String,
        disclosure: Schema.String,
        acceptedAt: Schema.String
      })
    )
  ),
  cancellationPolicy: Schema.optional(
    Schema.Struct({
      id: Schema.String,
      version: Schema.Number,
      cancellableUntilMinutesBeforeStart: Schema.Number
    })
  )
})

const PresentationAdjustment = Schema.Struct({
  kind: Schema.Literals(['tax', 'fee']),
  amountMinor: Schema.Number
})

const PresentationAppointment = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(['scheduled', 'completed', 'cancelled', 'no_show']),
  startsAt: Schema.String,
  endsAt: Schema.String,
  snapshot: PresentationSnapshot,
  adjustments: Schema.Array(PresentationAdjustment)
})

export const BookingConfirmationPresentation = Schema.Struct({
  routeId: Schema.String,
  status: Schema.Literals(['scheduled', 'completed', 'cancelled', 'no_show']),
  startsAt: Schema.String,
  endsAt: Schema.String,
  locale: Schema.Literals(['en', 'es', 'fr', 'ro']),
  customerFirstName: Schema.String,
  snapshot: PresentationSnapshot,
  appointments: Schema.Array(PresentationAppointment),
  shop: Schema.Struct({
    publicName: Schema.String,
    coverPhotoUrl: Schema.optional(Schema.String),
    addressLines: Schema.optional(Schema.Array(Schema.String)),
    coordinates: Schema.optional(
      Schema.Struct({ latitude: Schema.Number, longitude: Schema.Number })
    )
  })
})

export type BookingConfirmationPresentation =
  typeof BookingConfirmationPresentation.Type

type PresentationSnapshotSource = CustomerConfirmation['snapshot'] & {
  readonly policyAcceptance?: StoredAppointmentSnapshot['policyAcceptance'] | undefined
  readonly cancellationPolicy?:
    | StoredAppointmentSnapshot['cancellationPolicy']
    | undefined
}

const presentSnapshot = (
  snapshot: PresentationSnapshotSource
): typeof PresentationSnapshot.Type => ({
  startsAt: snapshot.startsAt,
  endsAt: snapshot.endsAt,
  providerPreference: snapshot.providerPreference,
  assignedProvider: snapshot.assignedProvider,
  services: snapshot.services,
  durationMinutes: snapshot.durationMinutes,
  currency: snapshot.currency,
  totalMinor: snapshot.totalMinor,
  merchantTimezone: snapshot.merchantTimezone,
  checkoutPath: snapshot.checkoutPath,
  ...(snapshot.policyAcceptance !== undefined
    ? { policyAcceptance: snapshot.policyAcceptance }
    : {}),
  ...(snapshot.cancellationPolicy
    ? { cancellationPolicy: snapshot.cancellationPolicy }
    : {})
})

export const presentBookingConfirmation = (
  confirmation: CustomerConfirmation
): BookingConfirmationPresentation => ({
  routeId: confirmation.routeId,
  status: confirmation.status,
  startsAt: confirmation.startsAt,
  endsAt: confirmation.endsAt,
  locale: confirmation.locale,
  customerFirstName:
    confirmation.snapshot.customerDetails.name.trim().split(/\s+/)[0] ?? '',
  snapshot: presentSnapshot(confirmation.snapshot),
  appointments: confirmation.appointments.map((appointment) => ({
    id: appointment.id,
    status: appointment.status,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    snapshot: presentSnapshot(appointment.snapshot),
    adjustments: appointment.adjustments ?? []
  })),
  shop: {
    publicName: confirmation.shop.publicName,
    ...(confirmation.shop.coverPhotoUrl
      ? { coverPhotoUrl: confirmation.shop.coverPhotoUrl }
      : {}),
    ...(confirmation.shop.addressLines
      ? { addressLines: confirmation.shop.addressLines }
      : {}),
    ...(confirmation.shop.coordinates
      ? { coordinates: confirmation.shop.coordinates }
      : {})
  }
})
