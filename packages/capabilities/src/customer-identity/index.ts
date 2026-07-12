import { Context, Effect, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
import { BookingPartyId, CustomerAccountId } from '../ids.ts'

const NonEmpty = Schema.String.check(Schema.isMinLength(1))
export const CustomerIdentityProvider = Schema.Literals(['google', 'apple'])
export type CustomerIdentityProvider = typeof CustomerIdentityProvider.Type

export const CustomerAccount = Schema.Struct({
  id: CustomerAccountId,
  provider: CustomerIdentityProvider,
  providerSubject: NonEmpty,
  email: NonEmpty,
  displayName: Schema.NullOr(Schema.String),
  verifiedAt: Schema.String
})
export type CustomerAccount = typeof CustomerAccount.Type

export const VerifiedCustomerPrincipal = Schema.Struct({
  provider: CustomerIdentityProvider,
  providerSubject: NonEmpty,
  email: NonEmpty,
  emailVerified: Schema.Literal(true),
  displayName: Schema.NullOr(Schema.String)
})
export type VerifiedCustomerPrincipal = typeof VerifiedCustomerPrincipal.Type

export const CustomerAccountSession = Schema.Struct({
  id: NonEmpty,
  customerAccountId: CustomerAccountId,
  expiresAt: Schema.String
})
export type CustomerAccountSession = typeof CustomerAccountSession.Type

export const CustomerDetailsSnapshot = Schema.Struct({
  name: NonEmpty,
  email: NonEmpty,
  phone: Schema.NullOr(Schema.String)
})
export type CustomerDetailsSnapshot = typeof CustomerDetailsSnapshot.Type

export const CustomerBookingAssociation = Schema.Struct({
  customerAccountId: CustomerAccountId,
  merchantId: NonEmpty,
  bookingPartyId: BookingPartyId,
  confirmationRouteId: NonEmpty,
  customerDetails: CustomerDetailsSnapshot,
  associatedAt: Schema.String
})
export type CustomerBookingAssociation = typeof CustomerBookingAssociation.Type

export const VerifiedContinuation = Schema.Struct({
  merchantId: NonEmpty,
  bookingPartyId: BookingPartyId,
  confirmationRouteId: NonEmpty
})
export type VerifiedContinuation = typeof VerifiedContinuation.Type

export class CustomerIdentityNotFound extends Schema.TaggedErrorClass<CustomerIdentityNotFound>()(
  'CustomerIdentityNotFound',
  {}
) {}
export class CustomerIdentityRejected extends Schema.TaggedErrorClass<CustomerIdentityRejected>()(
  'CustomerIdentityRejected',
  {
    reason: Schema.Literals([
      'unverified_principal',
      'session_expired',
      'booking_already_linked'
    ])
  }
) {}

type Failure =
  | CustomerIdentityNotFound
  | CustomerIdentityRejected
  | CapabilityUnavailable

export type CustomerIdentityShape = {
  readonly establishSession: (input: {
    readonly principal: VerifiedCustomerPrincipal
    readonly now: string
    readonly expiresAt: string
  }) => Effect.Effect<
    CustomerAccountSession,
    CustomerIdentityRejected | CapabilityUnavailable
  >
  readonly findAccount: (
    session: CustomerAccountSession,
    now: string
  ) => Effect.Effect<CustomerAccount, Failure>
  readonly associateBooking: (input: {
    readonly session: CustomerAccountSession
    readonly merchantId: string
    readonly bookingPartyId: string
    readonly confirmationRouteId: string
    readonly customerDetails: CustomerDetailsSnapshot
    readonly now: string
  }) => Effect.Effect<void, Failure>
  readonly listMerchantOwnership: (input: {
    readonly session: CustomerAccountSession
    readonly merchantId: string
    readonly now: string
  }) => Effect.Effect<readonly CustomerBookingAssociation[], Failure>
  readonly recoverContinuation: (input: {
    readonly session: CustomerAccountSession
    readonly merchantId: string
    readonly confirmationRouteId: string
    readonly now: string
  }) => Effect.Effect<VerifiedContinuation, Failure>
}

export class CustomerIdentity extends Context.Service<
  CustomerIdentity,
  CustomerIdentityShape
>()('@b2b-saas-starter/capabilities/CustomerIdentity') {}

const ConfirmedBookingAssociation = Schema.Struct({
  appointment: Schema.Struct({
    merchantId: Schema.String,
    snapshot: Schema.Struct({ customerDetails: CustomerDetailsSnapshot })
  }),
  access: Schema.Struct({
    bookingPartyId: Schema.NullOr(BookingPartyId),
    routeId: Schema.String
  })
})

/** Optional identity enrichment never changes the committed Booking outcome. */
export const associateVerifiedBooking = <A>(input: {
  readonly principal: VerifiedCustomerPrincipal | null
  readonly confirmation: A
  readonly now: string
}): Effect.Effect<A, never, CustomerIdentity> =>
  Effect.gen(function* () {
    if (!input.principal) return input.confirmation
    const decoded = yield* Effect.option(
      Schema.decodeUnknownEffect(ConfirmedBookingAssociation)(input.confirmation)
    )
    if (decoded._tag === 'None' || !decoded.value.access.bookingPartyId)
      return input.confirmation
    const identity = yield* CustomerIdentity
    const session = yield* identity.establishSession({
      principal: input.principal,
      now: input.now,
      expiresAt: new Date(Date.parse(input.now) + 30 * 24 * 60 * 60_000).toISOString()
    })
    yield* identity.associateBooking({
      session,
      merchantId: decoded.value.appointment.merchantId,
      bookingPartyId: decoded.value.access.bookingPartyId,
      confirmationRouteId: decoded.value.access.routeId,
      customerDetails: decoded.value.appointment.snapshot.customerDetails,
      now: input.now
    })
    return input.confirmation
  }).pipe(Effect.catch(() => Effect.succeed(input.confirmation)))

export type CustomerIdentityProviderState =
  | 'disabled'
  | 'needs_configuration'
  | 'configured'
export const customerIdentityProviderStates = (config: {
  readonly googleEnabled?: boolean
  readonly googleClientId?: string
  readonly googleClientSecret?: string
  readonly appleEnabled?: boolean
  readonly appleClientId?: string
  readonly appleClientSecret?: string
}): {
  readonly google: CustomerIdentityProviderState
  readonly apple: CustomerIdentityProviderState
} => {
  const state = (
    enabled: boolean | undefined,
    id: string | undefined,
    secret: string | undefined
  ): CustomerIdentityProviderState =>
    !enabled
      ? 'disabled'
      : id?.trim() && secret?.trim()
        ? 'configured'
        : 'needs_configuration'
  return {
    google: state(
      config.googleEnabled,
      config.googleClientId,
      config.googleClientSecret
    ),
    apple: state(config.appleEnabled, config.appleClientId, config.appleClientSecret)
  }
}
