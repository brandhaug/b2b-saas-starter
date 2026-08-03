import { Effect, Layer } from 'effect'
import { and, eq } from 'drizzle-orm'
import {
  customerAccountSessions,
  customerIdentities,
  customerBookingAssociations,
  Database
} from '@b2b-saas-starter/db'
import { randomHex } from '../internal/crypto.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import {
  CustomerIdentity,
  CustomerIdentityNotFound,
  CustomerIdentityRejected,
  type CustomerAccount,
  type CustomerAccountSession,
  type CustomerBookingAssociation,
  type CustomerIdentityShape
} from './index.ts'

export type SeedCustomerIdentityStore = {
  readonly accounts: Map<string, CustomerAccount>
  readonly subjects: Map<string, string>
  readonly sessions: Map<string, CustomerAccountSession>
  readonly associations: CustomerBookingAssociation[]
  nextId: number
}
export const emptySeedCustomerIdentityStore = (): SeedCustomerIdentityStore => ({
  accounts: new Map(),
  subjects: new Map(),
  sessions: new Map(),
  associations: [],
  nextId: 1
})

const notFound = () => new CustomerIdentityNotFound()
const sessionAccount = (
  store: SeedCustomerIdentityStore,
  session: CustomerAccountSession,
  now: string
): Effect.Effect<
  CustomerAccount,
  CustomerIdentityNotFound | CustomerIdentityRejected
> =>
  Effect.gen(function* () {
    const persisted = store.sessions.get(session.id)
    if (!persisted || persisted.customerAccountId !== session.customerAccountId)
      return yield* notFound()
    if (persisted.expiresAt <= now)
      return yield* new CustomerIdentityRejected({ reason: 'session_expired' })
    const account = store.accounts.get(persisted.customerAccountId)
    return account ?? (yield* notFound())
  })

export const SeedCustomerIdentity = (
  store = emptySeedCustomerIdentityStore()
): Layer.Layer<CustomerIdentity> =>
  Layer.succeed(CustomerIdentity)({
    establishSession: (input) =>
      Effect.sync(() => {
        const key = `${input.principal.provider}:${input.principal.providerSubject}`
        let account = store.accounts.get(store.subjects.get(key) ?? '')
        if (!account) {
          account = {
            id: `cua_${store.nextId++}`,
            provider: input.principal.provider,
            providerSubject: input.principal.providerSubject,
            email: input.principal.email.trim().toLowerCase(),
            displayName: input.principal.displayName,
            verifiedAt: input.now
          }
          store.accounts.set(account.id, account)
          store.subjects.set(key, account.id)
        }
        const session = {
          id: `cus_${store.nextId++}`,
          customerAccountId: account.id,
          expiresAt: input.expiresAt
        }
        store.sessions.set(session.id, session)
        return session
      }),
    findAccount: (session, now) => sessionAccount(store, session, now),
    associateBooking: (input) =>
      Effect.flatMap(sessionAccount(store, input.session, input.now), (account) => {
        const conflict = store.associations.find(
          (item) =>
            item.bookingPartyId === input.bookingPartyId &&
            item.customerAccountId !== account.id
        )
        if (conflict)
          return Effect.fail(
            new CustomerIdentityRejected({ reason: 'booking_already_linked' })
          )
        if (
          !store.associations.some(
            (item) => item.bookingPartyId === input.bookingPartyId
          )
        ) {
          store.associations.push({
            customerAccountId: account.id,
            merchantId: input.merchantId,
            bookingPartyId: input.bookingPartyId,
            confirmationRouteId: input.confirmationRouteId,
            customerDetails: { ...input.customerDetails },
            associatedAt: input.now
          })
        }
        return Effect.void
      }),
    listMerchantOwnership: (input) =>
      Effect.map(sessionAccount(store, input.session, input.now), (account) =>
        store.associations
          .filter(
            (item) =>
              item.customerAccountId === account.id &&
              item.merchantId === input.merchantId
          )
          .map((item) => ({ ...item, customerDetails: { ...item.customerDetails } }))
      ),
    recoverContinuation: (input) =>
      Effect.flatMap(sessionAccount(store, input.session, input.now), (account) => {
        const association = store.associations.find(
          (item) =>
            item.customerAccountId === account.id &&
            item.merchantId === input.merchantId &&
            item.confirmationRouteId === input.confirmationRouteId
        )
        return association
          ? Effect.succeed({
              merchantId: association.merchantId,
              bookingPartyId: association.bookingPartyId,
              confirmationRouteId: association.confirmationRouteId
            })
          : Effect.fail(notFound())
      })
  })

const makeLive = (db: typeof Database.Service): CustomerIdentityShape => {
  const authorize = (
    session: CustomerAccountSession,
    now: string
  ): ReturnType<CustomerIdentityShape['findAccount']> =>
    Effect.gen(function* () {
      const [row] = yield* orUnavailable('customer-identity')(
        db
          .select({
            account: customerIdentities,
            expiresAt: customerAccountSessions.expiresAt
          })
          .from(customerAccountSessions)
          .innerJoin(
            customerIdentities,
            eq(customerIdentities.id, customerAccountSessions.customerAccountId)
          )
          .where(
            and(
              eq(customerAccountSessions.id, session.id),
              eq(customerAccountSessions.customerAccountId, session.customerAccountId)
            )
          )
          .limit(1)
      )
      if (!row) return yield* notFound()
      if (row.expiresAt <= now || row.expiresAt !== session.expiresAt)
        return yield* new CustomerIdentityRejected({ reason: 'session_expired' })
      return row.account
    })
  return {
    establishSession: (input) =>
      Effect.gen(function* () {
        const existing = yield* orUnavailable('customer-identity')(
          db
            .select()
            .from(customerIdentities)
            .where(
              and(
                eq(customerIdentities.provider, input.principal.provider),
                eq(customerIdentities.providerSubject, input.principal.providerSubject)
              )
            )
            .limit(1)
        )
        const account = existing[0] ?? {
          id: `cua_${yield* Effect.sync(() => randomHex(16))}`,
          provider: input.principal.provider,
          providerSubject: input.principal.providerSubject,
          email: input.principal.email.trim().toLowerCase(),
          displayName: input.principal.displayName,
          verifiedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now
        }
        if (!existing[0])
          yield* orUnavailable('customer-identity')(
            db.insert(customerIdentities).values(account)
          )
        const session = {
          id: `cus_${yield* Effect.sync(() => randomHex(16))}`,
          customerAccountId: account.id,
          expiresAt: input.expiresAt
        }
        yield* orUnavailable('customer-identity')(
          db
            .insert(customerAccountSessions)
            .values({ ...session, createdAt: input.now })
        )
        return session
      }),
    findAccount: authorize,
    associateBooking: (input) =>
      Effect.gen(function* () {
        const account = yield* authorize(input.session, input.now)
        const conflict = yield* orUnavailable('customer-identity')(
          db
            .select()
            .from(customerBookingAssociations)
            .where(eq(customerBookingAssociations.bookingPartyId, input.bookingPartyId))
            .limit(1)
        )
        if (conflict[0] && conflict[0].customerAccountId !== account.id)
          return yield* new CustomerIdentityRejected({
            reason: 'booking_already_linked'
          })
        if (!conflict[0])
          yield* orUnavailable('customer-identity')(
            db.insert(customerBookingAssociations).values({
              customerAccountId: account.id,
              merchantId: input.merchantId,
              bookingPartyId: input.bookingPartyId,
              confirmationRouteId: input.confirmationRouteId,
              customerDetailsJson: input.customerDetails,
              associatedAt: input.now
            })
          )
      }),
    listMerchantOwnership: (input) =>
      Effect.gen(function* () {
        const account = yield* authorize(input.session, input.now)
        const rows = yield* orUnavailable('customer-identity')(
          db
            .select()
            .from(customerBookingAssociations)
            .where(
              and(
                eq(customerBookingAssociations.customerAccountId, account.id),
                eq(customerBookingAssociations.merchantId, input.merchantId)
              )
            )
        )
        return rows.map((row) => ({
          customerAccountId: row.customerAccountId,
          merchantId: row.merchantId,
          bookingPartyId: row.bookingPartyId,
          confirmationRouteId: row.confirmationRouteId,
          customerDetails: row.customerDetailsJson,
          associatedAt: row.associatedAt
        }))
      }),
    recoverContinuation: (input) =>
      Effect.gen(function* () {
        const account = yield* authorize(input.session, input.now)
        const rows = yield* orUnavailable('customer-identity')(
          db
            .select()
            .from(customerBookingAssociations)
            .where(
              and(
                eq(customerBookingAssociations.customerAccountId, account.id),
                eq(customerBookingAssociations.merchantId, input.merchantId),
                eq(
                  customerBookingAssociations.confirmationRouteId,
                  input.confirmationRouteId
                )
              )
            )
            .limit(1)
        )
        const row = rows[0]
        if (!row) return yield* notFound()
        return {
          merchantId: row.merchantId,
          bookingPartyId: row.bookingPartyId,
          confirmationRouteId: row.confirmationRouteId
        }
      })
  }
}

export const LiveCustomerIdentity: Layer.Layer<CustomerIdentity, never, Database> =
  Layer.effect(CustomerIdentity, Effect.map(Database, makeLive))
