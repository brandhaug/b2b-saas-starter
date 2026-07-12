import { Context, Effect, Layer, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
import { CustomerAccountId } from '../ids.ts'

export const CustomerAccount = Schema.Struct({
  id: CustomerAccountId,
  subject: Schema.optional(Schema.String),
  /** @deprecated Legacy foundation field; new accounts are platform-wide. */
  merchantId: Schema.optional(Schema.String),
  email: Schema.String,
  displayName: Schema.NullOr(Schema.String),
  phone: Schema.optional(Schema.NullOr(Schema.String)),
  verifiedAt: Schema.optional(Schema.String)
})
export type CustomerAccount = typeof CustomerAccount.Type

export class CustomerAccountNotFound extends Schema.TaggedErrorClass<CustomerAccountNotFound>()(
  'CustomerAccountNotFound',
  { customerAccountId: CustomerAccountId }
) {}
export class CustomerIdentityConflict extends Schema.TaggedErrorClass<CustomerIdentityConflict>()(
  'CustomerIdentityConflict',
  { reason: Schema.String }
) {}
export class ProviderProofRejected extends Schema.TaggedErrorClass<ProviderProofRejected>()(
  'ProviderProofRejected',
  { reason: Schema.String }
) {}

export type CustomerDetailsSnapshot = {
  readonly name: string
  readonly email: string
  readonly phone: string | null
}
export type MerchantOwnership = {
  readonly customerAccountId: string
  readonly merchantId: string
  readonly bookingPartyIds: readonly string[]
  readonly customerDetailsSnapshots: readonly CustomerDetailsSnapshot[]
}
type IdentityFailure =
  | CustomerAccountNotFound
  | CustomerIdentityConflict
  | CapabilityUnavailable

export type CustomerIdentityShape = {
  readonly findById: (
    id: string
  ) => Effect.Effect<CustomerAccount, CustomerAccountNotFound | CapabilityUnavailable>
  readonly verifyAccount: (input: {
    readonly subject: string
    readonly email: string
    readonly displayName: string | null
    readonly now: string
  }) => Effect.Effect<CustomerAccount, CustomerIdentityConflict | CapabilityUnavailable>
  readonly associateBooking: (input: {
    readonly customerAccountId: string
    readonly merchantId: string
    readonly bookingPartyId: string
    readonly confirmationRouteId: string
    readonly confirmationCredential: string
    readonly customerDetails: CustomerDetailsSnapshot
    readonly now: string
  }) => Effect.Effect<void, IdentityFailure>
  readonly lookupMerchantOwnership: (input: {
    readonly customerAccountId: string
    readonly merchantId: string
  }) => Effect.Effect<
    MerchantOwnership,
    CustomerAccountNotFound | CapabilityUnavailable
  >
  readonly recoverConfirmation: (input: {
    readonly customerAccountId: string
    readonly merchantId: string
    readonly confirmationRouteId: string
  }) => Effect.Effect<
    { readonly routeId: string; readonly credential: string },
    CustomerAccountNotFound | CapabilityUnavailable
  >
  readonly configureProviderPasscode: (input: {
    readonly merchantId: string
    readonly providerId: string
    readonly passcode: string
  }) => Effect.Effect<void, CapabilityUnavailable>
  readonly verifyProviderPasscode: (input: {
    readonly merchantId: string
    readonly bookingSessionId: string
    readonly providerId: string
    readonly passcode: string
    readonly now: string
  }) => Effect.Effect<
    { readonly proof: string; readonly expiresAt: string },
    ProviderProofRejected | CapabilityUnavailable
  >
  readonly authorizeProviderProof: (input: {
    readonly proof: string
    readonly bookingSessionId: string
    readonly providerId: string
    readonly now: string
  }) => Effect.Effect<boolean, ProviderProofRejected | CapabilityUnavailable>
}
export class CustomerIdentity extends Context.Service<
  CustomerIdentity,
  CustomerIdentityShape
>()('@b2b-saas-starter/capabilities/CustomerIdentity') {}

type Association = Parameters<CustomerIdentityShape['associateBooking']>[0]
type Proof = {
  readonly bookingSessionId: string
  readonly providerId: string
  readonly expiresAt: string
}
export type SeedCustomerIdentityStore = {
  readonly accounts: Map<string, CustomerAccount>
  readonly subjects: Map<string, string>
  readonly associations: Association[]
  readonly passcodes: Map<string, string>
  readonly proofs: Map<string, Proof>
  nextId: number
}
export const emptySeedCustomerIdentityStore = (): SeedCustomerIdentityStore => ({
  accounts: new Map(),
  subjects: new Map(),
  associations: [],
  passcodes: new Map(),
  proofs: new Map(),
  nextId: 1
})

export const SeedCustomerIdentity = (
  initial: readonly CustomerAccount[] = [],
  store = emptySeedCustomerIdentityStore()
): Layer.Layer<CustomerIdentity> => {
  for (const account of initial) {
    store.accounts.set(account.id, account)
    if (account.subject) store.subjects.set(account.subject, account.id)
  }
  const notFound = (id: string) =>
    new CustomerAccountNotFound({ customerAccountId: id })
  return Layer.succeed(CustomerIdentity)({
    findById: (id) =>
      store.accounts.has(id)
        ? Effect.succeed(store.accounts.get(id)!)
        : Effect.fail(notFound(id)),
    verifyAccount: (input) => {
      const existingId = store.subjects.get(input.subject)
      if (existingId) return Effect.succeed(store.accounts.get(existingId)!)
      const id = `cua_${store.nextId++}`
      const account = {
        id,
        subject: input.subject,
        email: input.email.trim().toLowerCase(),
        displayName: input.displayName,
        verifiedAt: input.now
      }
      store.accounts.set(id, account)
      store.subjects.set(input.subject, id)
      return Effect.succeed(account)
    },
    associateBooking: (input) => {
      if (!store.accounts.has(input.customerAccountId))
        return Effect.fail(notFound(input.customerAccountId))
      const conflict = store.associations.find(
        (item) =>
          item.bookingPartyId === input.bookingPartyId &&
          item.customerAccountId !== input.customerAccountId
      )
      if (conflict)
        return Effect.fail(
          new CustomerIdentityConflict({ reason: 'booking_already_linked' })
        )
      if (
        !store.associations.some((item) => item.bookingPartyId === input.bookingPartyId)
      ) {
        store.associations.push({
          ...input,
          customerDetails: { ...input.customerDetails }
        })
      }
      return Effect.void
    },
    lookupMerchantOwnership: (input) => {
      const facts = store.associations.filter(
        (item) =>
          item.customerAccountId === input.customerAccountId &&
          item.merchantId === input.merchantId
      )
      if (facts.length === 0) return Effect.fail(notFound(input.customerAccountId))
      return Effect.succeed({
        customerAccountId: input.customerAccountId,
        merchantId: input.merchantId,
        bookingPartyIds: facts.map((item) => item.bookingPartyId),
        customerDetailsSnapshots: facts.map((item) => ({ ...item.customerDetails }))
      })
    },
    recoverConfirmation: (input) => {
      const fact = store.associations.find(
        (item) =>
          item.customerAccountId === input.customerAccountId &&
          item.merchantId === input.merchantId &&
          item.confirmationRouteId === input.confirmationRouteId
      )
      return fact
        ? Effect.succeed({
            routeId: fact.confirmationRouteId,
            credential: fact.confirmationCredential
          })
        : Effect.fail(notFound(input.customerAccountId))
    },
    configureProviderPasscode: (input) =>
      Effect.sync(() => {
        store.passcodes.set(`${input.merchantId}:${input.providerId}`, input.passcode)
      }),
    verifyProviderPasscode: (input) => {
      if (
        store.passcodes.get(`${input.merchantId}:${input.providerId}`) !==
        input.passcode
      )
        return Effect.fail(new ProviderProofRejected({ reason: 'invalid_passcode' }))
      const expiresAt = new Date(
        new Date(input.now).getTime() + 5 * 60_000
      ).toISOString()
      const proof = `ppf_${store.nextId++}_${input.bookingSessionId}_${input.providerId}`
      store.proofs.set(proof, {
        bookingSessionId: input.bookingSessionId,
        providerId: input.providerId,
        expiresAt
      })
      return Effect.succeed({ proof, expiresAt })
    },
    authorizeProviderProof: (input) => {
      const proof = store.proofs.get(input.proof)
      return proof &&
        proof.bookingSessionId === input.bookingSessionId &&
        proof.providerId === input.providerId &&
        proof.expiresAt > input.now
        ? Effect.succeed(true)
        : Effect.fail(new ProviderProofRejected({ reason: 'invalid_or_expired_proof' }))
    }
  })
}

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
