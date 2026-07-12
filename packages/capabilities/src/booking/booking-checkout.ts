import { Context, Effect, Layer, Schema } from 'effect'
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm'
import {
  batch,
  brands,
  bookingParties,
  bookingRequests,
  bookingSessions,
  checkoutPolicies,
  Database,
  marketingConsents,
  policyAcceptances,
  shops,
  timeSlotHolds
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import {
  PricingQuote,
  PricingQuotes,
  type PricingError,
  type PricingQuotesShape,
  type QuoteMaterial
} from '../pricing/index.ts'
import {
  BookingParties,
  BookingParty,
  BookingPartyConflict,
  BookingPartyNotFound,
  bookingRequestIsComplete,
  type BookingPartiesShape
} from './foundations.ts'
import type { SeedBookingSchedulingStore } from './booking-scheduling.ts'
import { BookingQuote } from './booking-scheduling.ts'
import type { BookingSession } from './booking-sessions.ts'

export const CustomerDetails = Schema.Struct({
  name: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(120),
    Schema.isPattern(/^\S(?:.*\S)?$/)
  ),
  email: Schema.String.check(
    Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
    Schema.isMaxLength(254)
  ),
  phone: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(16), Schema.isPattern(/^\+[1-9]\d{7,14}$/))
  )
})
export type CustomerDetails = typeof CustomerDetails.Type

export const CustomerDetailsField = Schema.Literals(['name', 'email', 'phone'])
export const CustomerDetailsErrorCode = Schema.Literals([
  'name_required',
  'name_too_long',
  'email_invalid',
  'phone_invalid'
])
export const CustomerDetailsIssue = Schema.Struct({
  field: CustomerDetailsField,
  code: CustomerDetailsErrorCode
})
export type CustomerDetailsIssue = typeof CustomerDetailsIssue.Type

export class CustomerDetailsInvalid extends Schema.TaggedErrorClass<CustomerDetailsInvalid>()(
  'CustomerDetailsInvalid',
  { issues: Schema.Array(CustomerDetailsIssue) }
) {}

const normalizeCustomerDetailsSync = (
  input: {
    readonly name: string
    readonly email: string
    readonly phone: string | null
  },
  defaultCountry?: CountryCode
): CustomerDetails => {
  const name = input.name.trim().replace(/\s+/g, ' ')
  const email = input.email.trim().toLowerCase()
  const rawPhone = input.phone?.trim() || null
  const parsedPhone = rawPhone
    ? parsePhoneNumberFromString(rawPhone, defaultCountry)
    : undefined
  const phone = parsedPhone?.isValid() ? parsedPhone.number : null
  const issues: CustomerDetailsIssue[] = []
  if (!name) issues.push({ field: 'name', code: 'name_required' })
  else if (name.length > 120) issues.push({ field: 'name', code: 'name_too_long' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    issues.push({ field: 'email', code: 'email_invalid' })
  if (rawPhone && !phone) issues.push({ field: 'phone', code: 'phone_invalid' })
  if (issues.length > 0) throw new CustomerDetailsInvalid({ issues })
  return { name, email, phone }
}

export const normalizeCustomerDetails = (
  input: Parameters<typeof normalizeCustomerDetailsSync>[0],
  defaultCountry?: CountryCode
): Effect.Effect<CustomerDetails, CustomerDetailsInvalid> =>
  Effect.try({
    try: () => normalizeCustomerDetailsSync(input, defaultCountry),
    catch: (error) =>
      error instanceof CustomerDetailsInvalid
        ? error
        : new CustomerDetailsInvalid({ issues: [] })
  })

export const CheckoutPolicy = Schema.Struct({
  id: Schema.String,
  scope: Schema.Literals(['merchant', 'brand', 'shop']),
  scopeId: Schema.String,
  kind: Schema.String,
  version: Schema.Number,
  disclosure: Schema.String,
  effectiveAt: Schema.String,
  retiredAt: Schema.NullOr(Schema.String)
})
export type CheckoutPolicy = typeof CheckoutPolicy.Type

export const resolveCheckoutPolicy = (
  policies: readonly CheckoutPolicy[],
  input: {
    readonly merchantId: string
    readonly brandId: string
    readonly shopId: string
    readonly now: string
  }
): CheckoutPolicy | null => {
  const identities = [
    ['shop', input.shopId],
    ['brand', input.brandId],
    ['merchant', input.merchantId]
  ] as const
  for (const [scope, scopeId] of identities) {
    const resolved = policies
      .filter(
        (policy) =>
          policy.scope === scope &&
          policy.scopeId === scopeId &&
          policy.effectiveAt <= input.now &&
          (!policy.retiredAt || policy.retiredAt > input.now)
      )
      .sort((a, b) => b.version - a.version)[0]
    if (resolved) return resolved
  }
  return null
}

export const CheckoutPolicyAcceptance = Schema.Struct({
  policyId: Schema.String,
  version: Schema.Number,
  disclosure: Schema.String,
  acceptedAt: Schema.String
})
export type CheckoutPolicyAcceptance = typeof CheckoutPolicyAcceptance.Type

export const acceptCheckoutPolicy = (
  policy: CheckoutPolicy,
  acceptedAt: string,
  existing?: CheckoutPolicyAcceptance | null
): CheckoutPolicyAcceptance =>
  existing &&
  existing.policyId === policy.id &&
  existing.version === policy.version &&
  existing.disclosure === policy.disclosure
    ? existing
    : {
        policyId: policy.id,
        version: policy.version,
        disclosure: policy.disclosure,
        acceptedAt
      }
export const MarketingConsent = Schema.Struct({
  personId: Schema.String,
  channel: Schema.Literals(['email', 'sms']),
  granted: Schema.Boolean,
  policyVersion: Schema.String,
  recordedAt: Schema.String
})
export type MarketingConsent = typeof MarketingConsent.Type
export const PartyCheckoutReview = Schema.Struct({
  requests: Schema.Array(
    Schema.Struct({ id: Schema.String, complete: Schema.Boolean })
  ),
  acceptedQuote: Schema.Struct({ id: Schema.String, acceptedAt: Schema.String }),
  policyAcceptance: Schema.NullOr(CheckoutPolicyAcceptance),
  marketingConsents: Schema.Array(MarketingConsent),
  readyToConfirm: Schema.Literal(true)
})
export type PartyCheckoutReview = typeof PartyCheckoutReview.Type

export const CheckoutPreparation = Schema.Struct({
  party: BookingParty,
  quote: Schema.NullOr(PricingQuote),
  policy: Schema.NullOr(CheckoutPolicy),
  policyAcceptance: Schema.NullOr(CheckoutPolicyAcceptance),
  marketingConsents: Schema.Array(MarketingConsent)
})
export type CheckoutPreparation = typeof CheckoutPreparation.Type

export class CheckoutReviewUnavailable extends Schema.TaggedErrorClass<CheckoutReviewUnavailable>()(
  'CheckoutReviewUnavailable',
  {
    reason: Schema.Literals([
      'request_incomplete',
      'quote_unaccepted',
      'policy_unaccepted'
    ])
  }
) {}

export class CheckoutCommandRejected extends Schema.TaggedErrorClass<CheckoutCommandRejected>()(
  'CheckoutCommandRejected',
  {
    reason: Schema.Literals(['quote_missing', 'policy_changed', 'person_not_found'])
  }
) {}

export const buildCheckoutReview = (input: {
  readonly requests: readonly { readonly id: string; readonly complete: boolean }[]
  readonly acceptedQuote: { readonly id: string; readonly acceptedAt: string } | null
  readonly policy?: CheckoutPolicy | null
  readonly policyAcceptance: typeof CheckoutPolicyAcceptance.Type | null
  readonly marketingConsents: readonly (typeof MarketingConsent.Type)[]
}): Effect.Effect<PartyCheckoutReview, CheckoutReviewUnavailable> => {
  if (
    input.requests.length === 0 ||
    input.requests.some((request) => !request.complete)
  )
    return Effect.fail(new CheckoutReviewUnavailable({ reason: 'request_incomplete' }))
  if (!input.acceptedQuote)
    return Effect.fail(new CheckoutReviewUnavailable({ reason: 'quote_unaccepted' }))
  if (
    input.policy &&
    (!input.policyAcceptance ||
      input.policyAcceptance.policyId !== input.policy.id ||
      input.policyAcceptance.version !== input.policy.version ||
      input.policyAcceptance.disclosure !== input.policy.disclosure)
  )
    return Effect.fail(new CheckoutReviewUnavailable({ reason: 'policy_unaccepted' }))
  return Effect.succeed({
    requests: [...input.requests],
    acceptedQuote: input.acceptedQuote,
    policyAcceptance: input.policyAcceptance,
    marketingConsents: [...input.marketingConsents],
    readyToConfirm: true
  })
}

export const CheckoutReview = Schema.Struct({
  customerDetails: CustomerDetails,
  checkoutPath: Schema.Literal('pay_in_person'),
  holdExpiresAt: Schema.String,
  quote: BookingQuote
})
export type CheckoutReview = typeof CheckoutReview.Type

export class CheckoutUnavailable extends Schema.TaggedErrorClass<CheckoutUnavailable>()(
  'CheckoutUnavailable',
  {
    reason: Schema.Literals(['hold_expired', 'details_missing']),
    message: Schema.String
  }
) {}

type Failure = CheckoutUnavailable | CapabilityUnavailable
type PartyFailure =
  | Failure
  | BookingPartyConflict
  | BookingPartyNotFound
  | PricingError
  | CheckoutReviewUnavailable
  | CheckoutCommandRejected
export type BookingCheckoutFailure = PartyFailure
export type BookingCheckoutShape = {
  readonly saveCustomerDetails: (
    session: BookingSession,
    details: CustomerDetails,
    input: { readonly now: string }
  ) => Effect.Effect<CheckoutReview, PartyFailure>
  readonly review: (
    session: BookingSession,
    input: { readonly now: string }
  ) => Effect.Effect<CheckoutReview, Failure>
  readonly prepare: (
    session: BookingSession,
    input: { readonly now: string }
  ) => Effect.Effect<CheckoutPreparation, PartyFailure>
  readonly acceptQuote: (
    session: BookingSession,
    input: { readonly quoteId: string; readonly now: string }
  ) => Effect.Effect<typeof PricingQuote.Type, PartyFailure>
  readonly acceptPolicy: (
    session: BookingSession,
    input: { readonly policyId: string; readonly now: string }
  ) => Effect.Effect<CheckoutPolicyAcceptance, PartyFailure>
  readonly recordMarketingConsent: (
    session: BookingSession,
    input: {
      readonly personId: string
      readonly channel: 'email' | 'sms'
      readonly granted: boolean
      readonly policyVersion: string
      readonly now: string
    }
  ) => Effect.Effect<typeof MarketingConsent.Type, PartyFailure>
  readonly reviewParty: (
    session: BookingSession,
    input: { readonly now: string }
  ) => Effect.Effect<PartyCheckoutReview, PartyFailure>
}

export class BookingCheckout extends Context.Service<
  BookingCheckout,
  BookingCheckoutShape
>()('@b2b-saas-starter/capabilities/BookingCheckout') {}

const unavailable = (reason: CheckoutUnavailable['reason']) =>
  new CheckoutUnavailable({
    reason,
    message:
      reason === 'hold_expired'
        ? 'Your held time is no longer available'
        : 'Add your details to continue'
  })

type CheckoutFactsRepository = {
  readonly topology: (
    party: typeof BookingParty.Type
  ) => Effect.Effect<
    { readonly merchantId: string; readonly brandId: string },
    CapabilityUnavailable
  >
  readonly policies: () => Effect.Effect<
    readonly CheckoutPolicy[],
    CapabilityUnavailable
  >
  readonly acceptance: (
    partyId: string
  ) => Effect.Effect<CheckoutPolicyAcceptance | null, CapabilityUnavailable>
  readonly saveAcceptance: (
    partyId: string,
    policy: CheckoutPolicy,
    now: string
  ) => Effect.Effect<CheckoutPolicyAcceptance, CapabilityUnavailable>
  readonly consents: (
    partyId: string
  ) => Effect.Effect<readonly (typeof MarketingConsent.Type)[], CapabilityUnavailable>
  readonly saveConsent: (
    party: typeof BookingParty.Type,
    consent: typeof MarketingConsent.Type
  ) => Effect.Effect<typeof MarketingConsent.Type, CapabilityUnavailable>
  readonly quoteMaterial: (
    party: typeof BookingParty.Type,
    policy: CheckoutPolicy | null,
    now: string
  ) => Effect.Effect<QuoteMaterial | null, CapabilityUnavailable>
}

const partyCheckoutWorkflow = (
  parties: BookingPartiesShape,
  pricing: PricingQuotesShape,
  repository: CheckoutFactsRepository
) => {
  const currentPolicy = (party: typeof BookingParty.Type, now: string) =>
    Effect.gen(function* () {
      const [topology, policies] = yield* Effect.all([
        repository.topology(party),
        repository.policies()
      ])
      return resolveCheckoutPolicy(policies, {
        ...topology,
        shopId: party.shopId,
        now
      })
    })
  const prepare = (session: BookingSession, now: string) =>
    Effect.gen(function* () {
      const party = yield* parties.findForSession(session.id)
      const policy = yield* currentPolicy(party, now)
      let quote = yield* pricing
        .findLatest(party.id)
        .pipe(Effect.catchTag('PricingQuoteNotFound', () => Effect.succeed(null)))
      const policyVersions = policy ? [`${policy.kind}:${policy.version}`] : []
      const quoteIsCurrent =
        quote &&
        quote.expiresAt > now &&
        quote.facts.partyVersion === party.version &&
        [...quote.facts.policyVersions].sort().join('|') ===
          [...policyVersions].sort().join('|')
      if (!quoteIsCurrent) {
        const material = yield* repository.quoteMaterial(party, policy, now)
        quote = material ? yield* pricing.quote(material) : null
      }
      const [policyAcceptance, marketingConsents] = yield* Effect.all([
        repository.acceptance(party.id),
        repository.consents(party.id)
      ])
      return {
        party,
        quote,
        policy,
        policyAcceptance,
        marketingConsents: [...marketingConsents]
      }
    })
  return {
    prepare: (session: BookingSession, input: { readonly now: string }) =>
      prepare(session, input.now),
    acceptQuote: (
      session: BookingSession,
      input: { readonly quoteId: string; readonly now: string }
    ) =>
      Effect.gen(function* () {
        const party = yield* parties.findForSession(session.id)
        const latest = yield* pricing.findLatest(party.id)
        if (latest.id !== input.quoteId)
          return yield* new CheckoutCommandRejected({ reason: 'quote_missing' })
        return yield* pricing.accept(input.quoteId, party.version, input.now)
      }),
    acceptPolicy: (
      session: BookingSession,
      input: { readonly policyId: string; readonly now: string }
    ) =>
      Effect.gen(function* () {
        const party = yield* parties.findForSession(session.id)
        const policy = yield* currentPolicy(party, input.now)
        if (!policy || policy.id !== input.policyId)
          return yield* new CheckoutCommandRejected({ reason: 'policy_changed' })
        return yield* repository.saveAcceptance(party.id, policy, input.now)
      }),
    recordMarketingConsent: (
      session: BookingSession,
      input: {
        readonly personId: string
        readonly channel: 'email' | 'sms'
        readonly granted: boolean
        readonly policyVersion: string
        readonly now: string
      }
    ) =>
      Effect.gen(function* () {
        const party = yield* parties.findForSession(session.id)
        if (!party.requests.some((request) => request.id === input.personId))
          return yield* new CheckoutCommandRejected({ reason: 'person_not_found' })
        return yield* repository.saveConsent(party, {
          personId: input.personId,
          channel: input.channel,
          granted: input.granted,
          policyVersion: input.policyVersion,
          recordedAt: input.now
        })
      }),
    reviewParty: (session: BookingSession, input: { readonly now: string }) =>
      Effect.gen(function* () {
        const state = yield* prepare(session, input.now)
        const acceptedQuote = state.quote
          ? yield* pricing.requireAccepted(
              state.quote.id,
              state.party.version,
              input.now
            )
          : null
        return yield* buildCheckoutReview({
          requests: state.party.requests.map((request) => ({
            id: request.id,
            complete: bookingRequestIsComplete(request, input.now)
          })),
          acceptedQuote: acceptedQuote?.acceptedAt
            ? { id: acceptedQuote.id, acceptedAt: acceptedQuote.acceptedAt }
            : null,
          policy: state.policy,
          policyAcceptance: state.policyAcceptance,
          marketingConsents: state.marketingConsents
        })
      })
  }
}

export type SeedBookingCheckoutStore = {
  readonly details: Map<string, CustomerDetails>
  readonly scheduling: SeedBookingSchedulingStore
  readonly policies: CheckoutPolicy[]
  readonly policyAcceptances: Map<string, CheckoutPolicyAcceptance>
  readonly marketingConsents: Map<string, typeof MarketingConsent.Type>
  readonly merchantId: string
  readonly brandId: string
}

export const emptySeedBookingCheckoutStore = (
  scheduling: SeedBookingSchedulingStore
): SeedBookingCheckoutStore => ({
  details: new Map(),
  scheduling,
  policies: [],
  policyAcceptances: new Map(),
  marketingConsents: new Map(),
  merchantId: scheduling.scenario?.merchant.id ?? 'mer_seed',
  brandId: `brd_${scheduling.scenario?.merchant.id ?? 'seed'}`
})

export const SeedBookingCheckout = (
  store: SeedBookingCheckoutStore
): Layer.Layer<BookingCheckout, never, BookingParties | PricingQuotes> => {
  const requestKey = (session: BookingSession) =>
    store.scheduling.activeRequests?.get(session.id) ?? session.id
  const activeHold = (session: BookingSession, now: string) =>
    [...store.scheduling.holds.values()].find(
      (candidate) =>
        candidate.bookingSessionId === session.id &&
        candidate.expiresAt > now &&
        (!store.scheduling.activeRequests?.get(session.id) ||
          candidate.bookingRequestId ===
            store.scheduling.activeRequests?.get(session.id))
    )
  const review = (session: BookingSession, now: string) =>
    Effect.gen(function* () {
      const details = store.details.get(requestKey(session))
      if (!details) return yield* unavailable('details_missing')
      const hold = activeHold(session, now)
      if (!hold) return yield* unavailable('hold_expired')
      return {
        customerDetails: details,
        checkoutPath: 'pay_in_person' as const,
        holdExpiresAt: hold.expiresAt,
        quote: hold.quote
      }
    })
  return Layer.effect(
    BookingCheckout,
    Effect.gen(function* () {
      const parties = yield* BookingParties
      const pricing = yield* PricingQuotes
      const workflow = partyCheckoutWorkflow(parties, pricing, {
        topology: () =>
          Effect.succeed({ merchantId: store.merchantId, brandId: store.brandId }),
        policies: () => Effect.succeed(store.policies),
        acceptance: (partyId) =>
          Effect.succeed(store.policyAcceptances.get(partyId) ?? null),
        saveAcceptance: (partyId, policy, now) =>
          Effect.sync(() => {
            const acceptance = acceptCheckoutPolicy(
              policy,
              now,
              store.policyAcceptances.get(partyId)
            )
            store.policyAcceptances.set(partyId, acceptance)
            return acceptance
          }),
        consents: (partyId) =>
          Effect.succeed(
            [...store.marketingConsents.values()]
              .filter((consent) => consent.personId.startsWith(`${partyId}:`))
              .map((consent) => ({
                ...consent,
                personId: consent.personId.slice(partyId.length + 1)
              }))
          ),
        saveConsent: (party, consent) =>
          Effect.sync(() => {
            store.marketingConsents.set(
              `${party.id}:${consent.personId}:${consent.channel}`,
              { ...consent, personId: `${party.id}:${consent.personId}` }
            )
            return consent
          }),
        quoteMaterial: (party, policy, now) =>
          Effect.succeed(
            party.requests.every((request) => bookingRequestIsComplete(request, now))
              ? {
                  bookingPartyId: party.id,
                  partyVersion: party.version,
                  currency: party.currency,
                  lines: party.requests.map((request) => {
                    const hold = [...store.scheduling.holds.values()].find(
                      (candidate) => candidate.id === request.holdId
                    )!
                    return {
                      requestId: request.id,
                      holdId: hold.id,
                      serviceIds: request.serviceIds,
                      amountMinor: hold.quote.totalMinor
                    }
                  }),
                  policyVersions: policy ? [`${policy.kind}:${policy.version}`] : [],
                  giftCardReservationIds: [],
                  tipMinor: 0,
                  expiresAt: party.requests
                    .map((request) => request.holdExpiresAt!)
                    .sort()[0]!,
                  now
                }
              : null
          )
      })
      return {
        ...workflow,
        review: (session, input) => review(session, input.now),
        saveCustomerDetails: (session, details, input) =>
          Effect.gen(function* () {
            const hold = activeHold(session, input.now)
            if (!hold) return yield* unavailable('hold_expired')
            store.details.set(requestKey(session), details)
            const party = yield* parties
              .findForSession(session.id)
              .pipe(Effect.catchTag('BookingPartyNotFound', () => Effect.succeed(null)))
            if (party?.activeRequestId)
              yield* parties.updateRequest(
                party.id,
                party.activeRequestId,
                { customerDetails: details },
                party.version,
                input.now
              )
            return yield* review(session, input.now)
          })
      }
    })
  )
}

export const LiveBookingCheckout: Layer.Layer<
  BookingCheckout,
  never,
  Database | BookingParties | PricingQuotes
> = Layer.effect(
  BookingCheckout,
  Effect.gen(function* () {
    const db = yield* Database
    const parties = yield* BookingParties
    const pricing = yield* PricingQuotes
    const read = (session: BookingSession, now: string) =>
      Effect.gen(function* () {
        const rows = yield* orUnavailable('booking-checkout')(
          db
            .select({
              session: bookingSessions,
              hold: timeSlotHolds,
              request: bookingRequests
            })
            .from(bookingSessions)
            .leftJoin(
              bookingParties,
              eq(bookingParties.bookingSessionId, bookingSessions.id)
            )
            .leftJoin(
              bookingRequests,
              eq(bookingRequests.id, bookingParties.activeRequestId)
            )
            .innerJoin(
              timeSlotHolds,
              and(
                eq(timeSlotHolds.bookingSessionId, bookingSessions.id),
                or(
                  eq(timeSlotHolds.bookingRequestId, bookingRequests.id),
                  isNull(timeSlotHolds.bookingRequestId)
                ),
                gt(timeSlotHolds.expiresAt, now)
              )
            )
            .where(eq(bookingSessions.id, session.id))
            .limit(1)
        )
        const row = rows[0]
        if (!row) return yield* unavailable('hold_expired')
        const requestDetails = row.request?.customerDetailsJson
          ? yield* Effect.try({
              try: () => JSON.parse(row.request!.customerDetailsJson!),
              catch: () => null
            }).pipe(
              Effect.flatMap((value) =>
                Schema.decodeUnknownEffect(CustomerDetails)(value)
              ),
              Effect.mapError(
                () =>
                  new CapabilityUnavailable({
                    capability: 'booking-checkout',
                    reason: 'invalid_customer_details'
                  })
              )
            )
          : null
        if (
          !requestDetails &&
          (!row.session.customerName || !row.session.customerEmail)
        ) {
          return yield* unavailable('details_missing')
        }
        return {
          customerDetails: requestDetails ?? {
            name: row.session.customerName!,
            email: row.session.customerEmail!,
            phone: row.session.customerPhone
          },
          checkoutPath: 'pay_in_person' as const,
          holdExpiresAt: row.hold.expiresAt,
          quote: row.hold.quote
        }
      })
    const workflow = partyCheckoutWorkflow(parties, pricing, {
      topology: (party) =>
        orUnavailable('booking-checkout')(
          db
            .select({ merchantId: brands.merchantId, brandId: shops.brandId })
            .from(shops)
            .innerJoin(brands, eq(brands.id, shops.brandId))
            .where(eq(shops.id, party.shopId))
            .limit(1)
        ).pipe(
          Effect.map(
            ([row]) => row ?? { merchantId: 'mer_missing', brandId: 'brd_missing' }
          )
        ),
      policies: () =>
        orUnavailable('booking-checkout')(db.select().from(checkoutPolicies)).pipe(
          Effect.map((rows) =>
            rows.map((policy) => ({
              id: policy.id,
              scope: policy.scope,
              scopeId: policy.scopeId,
              kind: policy.kind,
              version: policy.version,
              disclosure: policy.disclosure,
              effectiveAt: policy.effectiveAt,
              retiredAt: policy.retiredAt
            }))
          )
        ),
      acceptance: (partyId) =>
        orUnavailable('booking-checkout')(
          db
            .select({ acceptance: policyAcceptances, policy: checkoutPolicies })
            .from(policyAcceptances)
            .innerJoin(
              checkoutPolicies,
              eq(checkoutPolicies.id, policyAcceptances.checkoutPolicyId)
            )
            .where(eq(policyAcceptances.bookingPartyId, partyId))
        ).pipe(
          Effect.map((rows) => {
            const row = rows.sort((a, b) =>
              b.acceptance.acceptedAt.localeCompare(a.acceptance.acceptedAt)
            )[0]
            return row
              ? {
                  policyId: row.policy.id,
                  version: row.policy.version,
                  disclosure: row.acceptance.disclosureSnapshot,
                  acceptedAt: row.acceptance.acceptedAt
                }
              : null
          })
        ),
      saveAcceptance: (partyId, policy, now) =>
        Effect.gen(function* () {
          const existing = yield* orUnavailable('booking-checkout')(
            db
              .select()
              .from(policyAcceptances)
              .where(
                and(
                  eq(policyAcceptances.bookingPartyId, partyId),
                  eq(policyAcceptances.checkoutPolicyId, policy.id)
                )
              )
              .limit(1)
          )
          if (!existing[0])
            yield* orUnavailable('booking-checkout')(
              db.insert(policyAcceptances).values({
                id: newCapabilityId('pca'),
                bookingPartyId: partyId,
                checkoutPolicyId: policy.id,
                disclosureSnapshot: policy.disclosure,
                acceptedAt: now
              })
            )
          return {
            policyId: policy.id,
            version: policy.version,
            disclosure: existing[0]?.disclosureSnapshot ?? policy.disclosure,
            acceptedAt: existing[0]?.acceptedAt ?? now
          }
        }),
      consents: (partyId) =>
        orUnavailable('booking-checkout')(
          db
            .select()
            .from(marketingConsents)
            .where(
              eq(
                marketingConsents.merchantId,
                sql`(select merchant_id from shops where id = (select shop_id from booking_parties where id = ${partyId}))`
              )
            )
        ).pipe(
          Effect.map((rows) => {
            const latest = new Map<string, typeof MarketingConsent.Type>()
            for (const row of rows) {
              const subject = JSON.parse(row.subjectJson) as {
                bookingPartyId?: string
                personId?: string
              }
              if (subject.bookingPartyId !== partyId || !subject.personId) continue
              latest.set(`${subject.personId}:${row.channel}`, {
                personId: subject.personId,
                channel: row.channel,
                granted: row.granted,
                policyVersion: row.policyVersion,
                recordedAt: row.recordedAt
              })
            }
            return [...latest.values()]
          })
        ),
      saveConsent: (party, consent) =>
        Effect.gen(function* () {
          const [topology] = yield* orUnavailable('booking-checkout')(
            db
              .select({ merchantId: brands.merchantId })
              .from(shops)
              .innerJoin(brands, eq(brands.id, shops.brandId))
              .where(eq(shops.id, party.shopId))
              .limit(1)
          )
          if (!topology)
            return yield* new CapabilityUnavailable({
              capability: 'booking-checkout',
              reason: 'shop_topology_missing'
            })
          yield* orUnavailable('booking-checkout')(
            db.insert(marketingConsents).values({
              id: newCapabilityId('mco'),
              merchantId: topology.merchantId,
              customerAccountId: null,
              subjectJson: JSON.stringify({
                bookingPartyId: party.id,
                personId: consent.personId
              }),
              channel: consent.channel,
              granted: consent.granted,
              policyVersion: consent.policyVersion,
              recordedAt: consent.recordedAt,
              createdAt: consent.recordedAt
            })
          )
          return consent
        }),
      quoteMaterial: (party, policy, now) =>
        Effect.gen(function* () {
          if (
            !party.requests.every((request) => bookingRequestIsComplete(request, now))
          )
            return null
          const holds = yield* orUnavailable('booking-checkout')(
            db
              .select()
              .from(timeSlotHolds)
              .where(
                and(
                  eq(timeSlotHolds.bookingSessionId, party.bookingSessionId),
                  gt(timeSlotHolds.expiresAt, now)
                )
              )
          )
          const byRequest = new Map(
            holds.map((hold) => [hold.bookingRequestId, hold] as const)
          )
          if (party.requests.some((request) => !byRequest.get(request.id))) return null
          return {
            bookingPartyId: party.id,
            partyVersion: party.version,
            currency: party.currency,
            lines: party.requests.map((request) => {
              const hold = byRequest.get(request.id)!
              return {
                requestId: request.id,
                holdId: hold.id,
                serviceIds: request.serviceIds,
                amountMinor: hold.quote.totalMinor
              }
            }),
            policyVersions: policy ? [`${policy.kind}:${policy.version}`] : [],
            giftCardReservationIds: [],
            tipMinor: 0,
            expiresAt: holds.map((hold) => hold.expiresAt).sort()[0]!,
            now
          }
        })
    })
    return {
      ...workflow,
      review: (session, input) => read(session, input.now),
      saveCustomerDetails: (session, details, input) =>
        Effect.gen(function* () {
          const activeHold = yield* orUnavailable('booking-checkout')(
            db
              .select({ id: timeSlotHolds.id })
              .from(timeSlotHolds)
              .where(
                and(
                  eq(timeSlotHolds.bookingSessionId, session.id),
                  or(
                    eq(
                      timeSlotHolds.bookingRequestId,
                      sql`(select active_request_id from booking_parties where booking_session_id = ${session.id})`
                    ),
                    isNull(timeSlotHolds.bookingRequestId)
                  ),
                  gt(timeSlotHolds.expiresAt, input.now)
                )
              )
              .limit(1)
          )
          if (!activeHold[0]) return yield* unavailable('hold_expired')
          const party = yield* parties
            .findForSession(session.id)
            .pipe(Effect.catchTag('BookingPartyNotFound', () => Effect.succeed(null)))
          if (party?.activeRequestId)
            yield* parties.updateRequest(
              party.id,
              party.activeRequestId,
              { customerDetails: details },
              party.version,
              input.now
            )
          yield* orUnavailable('booking-checkout')(
            batch(db, [
              db
                .update(bookingSessions)
                .set({
                  customerName: details.name,
                  customerEmail: details.email,
                  customerPhone: details.phone
                })
                .where(eq(bookingSessions.id, session.id)),
              db
                .update(bookingRequests)
                .set({ customerDetailsJson: JSON.stringify(details) })
                .where(
                  eq(
                    bookingRequests.id,
                    sql`(select active_request_id from booking_parties where booking_session_id = ${session.id})`
                  )
                )
            ])
          )
          return yield* read(session, input.now)
        })
    }
  })
)
