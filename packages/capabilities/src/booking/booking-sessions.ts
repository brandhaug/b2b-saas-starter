import { Context, Effect, Layer, Schema } from 'effect'
import { and, eq, gt, sql } from 'drizzle-orm'
import {
  batch,
  bookingParties,
  bookingRequests,
  bookingSessions,
  Database,
  merchants,
  publicBookingPages,
  shops
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { hashSha256, randomHex } from '../internal/crypto.ts'
import { orUnavailable } from '../internal/unavailable.ts'

export const bookingSessionCheckoutPaths = ['pay_in_person'] as const
export const bookingSessionLifecycles = ['active', 'consumed'] as const

export const BookingSession = Schema.Struct({
  id: Schema.String,
  merchantSlug: Schema.String,
  checkoutPath: Schema.Literal('pay_in_person'),
  lifecycle: Schema.Union([Schema.Literal('active'), Schema.Literal('consumed')]),
  createdAt: Schema.String,
  lastActivityAt: Schema.String,
  idleExpiresAt: Schema.String,
  absoluteExpiresAt: Schema.String,
  locale: Schema.optional(Schema.Literals(['en', 'es', 'fr', 'ro'])),
  embeddingProfile: Schema.optional(Schema.Literals(['standalone', 'widget', 'google']))
})
export type BookingSession = typeof BookingSession.Type

export class BookingPageUnavailable extends Schema.TaggedErrorClass<BookingPageUnavailable>()(
  'BookingPageUnavailable',
  { message: Schema.String }
) {}

export class BookingSessionNotFound extends Schema.TaggedErrorClass<BookingSessionNotFound>()(
  'BookingSessionNotFound',
  { message: Schema.String }
) {}

export class BookingSessionGone extends Schema.TaggedErrorClass<BookingSessionGone>()(
  'BookingSessionGone',
  {
    message: Schema.String,
    locale: Schema.optional(Schema.Literals(['en', 'es', 'fr', 'ro'])),
    embeddingProfile: Schema.optional(
      Schema.Literals(['standalone', 'widget', 'google'])
    )
  }
) {}

export type StartBookingSessionInput = {
  readonly merchantSlug: string
  readonly now: string
}

export type IssuedBookingSession = {
  readonly session: BookingSession
  readonly routeId: string
  /** Server boundary only: send solely in the session-specific HttpOnly cookie. */
  readonly capability: string
}

export type BookingSessionsShape = {
  readonly start: (
    input: StartBookingSessionInput
  ) => Effect.Effect<
    IssuedBookingSession,
    BookingPageUnavailable | CapabilityUnavailable
  >
  readonly authorize: (
    input: AuthorizeBookingSessionInput
  ) => Effect.Effect<
    BookingSession,
    BookingSessionNotFound | BookingSessionGone | CapabilityUnavailable
  >
  readonly authorizeRoute: (input: {
    readonly merchantSlug: string
    readonly routeId: string
    readonly candidates: readonly PresentedBookingSessionCapability[]
    readonly now: string
    readonly allowConfirmedReplay?: boolean
  }) => Effect.Effect<
    BookingSession,
    BookingSessionNotFound | BookingSessionGone | CapabilityUnavailable
  >
  readonly captureContext: (
    session: BookingSession,
    context: BookingSessionContextInput
  ) => Effect.Effect<void, CapabilityUnavailable>
}

export type BookingSessionContextInput = {
  readonly locale: 'en' | 'es' | 'fr' | 'ro' | null
  readonly embedding: 'standalone' | 'widget' | 'google'
  readonly acquisition: Readonly<Record<string, string>>
}

export type AuthorizeBookingSessionInput = {
  readonly merchantSlug: string
  readonly sessionId: string
  readonly capability: string
  readonly now: string
  readonly allowConfirmedReplay?: boolean
}

export type PresentedBookingSessionCapability = {
  readonly sessionId: string
  readonly capability: string
}

export type BookingSessionEntry =
  | {
      readonly kind: 'created'
      readonly session: BookingSession
      readonly routeId: string
      readonly capability: string
    }
  | {
      readonly kind: 'resumed'
      readonly session: BookingSession
      readonly routeId: string
    }

export class BookingSessions extends Context.Service<
  BookingSessions,
  BookingSessionsShape
>()('@b2b-saas-starter/capabilities/BookingSessions') {}

export const enterBookingSession = (input: {
  readonly merchantSlug: string
  readonly routeLocator: string | null
  readonly candidates: readonly PresentedBookingSessionCapability[]
  readonly now: string
}): Effect.Effect<
  BookingSessionEntry,
  BookingPageUnavailable | CapabilityUnavailable,
  BookingSessions
> =>
  Effect.gen(function* () {
    const sessions = yield* BookingSessions
    if (input.routeLocator) {
      const result = yield* Effect.result(
        sessions.authorizeRoute({
          merchantSlug: input.merchantSlug,
          routeId: input.routeLocator,
          candidates: input.candidates,
          now: input.now
        })
      )
      if (result._tag === 'Success') {
        return {
          kind: 'resumed' as const,
          session: result.success,
          routeId: input.routeLocator
        }
      }
      if (result.failure instanceof CapabilityUnavailable) return yield* result.failure
    }
    const issued = yield* sessions.start({
      merchantSlug: input.merchantSlug,
      now: input.now
    })
    return { kind: 'created' as const, ...issued }
  })

export type SeedBookingSessionRecord = BookingSession & {
  readonly merchantId: string
  readonly capabilityHash: string
  readonly replayExpiresAt?: string | null
  readonly confirmedAppointmentId?: string | null
  locale?: 'en' | 'es' | 'fr' | 'ro' | undefined
  embeddingProfile?: 'standalone' | 'widget' | 'google' | undefined
  acquisition?: Readonly<Record<string, string>> | null
  routeId?: string
}

export type SeedBookingSessionStore = {
  readonly merchants: Map<
    string,
    { readonly id: string; readonly slug: string; published: boolean }
  >
  readonly sessions: Map<string, SeedBookingSessionRecord>
  readonly parties: Map<
    string,
    {
      readonly id: string
      readonly bookingSessionId: string
      readonly requestId: string
      readonly shopId: string
      locale: 'en' | 'es' | 'fr' | 'ro'
    }
  >
}

export const emptySeedBookingSessionStore = (
  input: {
    readonly merchants?: readonly {
      readonly id: string
      readonly slug: string
      readonly published: boolean
    }[]
  } = {}
): SeedBookingSessionStore => ({
  merchants: new Map(
    (input.merchants ?? []).map((merchant) => [merchant.slug, merchant])
  ),
  sessions: new Map(),
  parties: new Map()
})

type BookingSessionGenerators = {
  readonly newSessionId: () => string
  readonly newCapability: () => string
  readonly newPartyId?: () => string
  readonly newRequestId?: () => string
  readonly newRouteId?: () => string
}

const defaultGenerators: BookingSessionGenerators = {
  newSessionId: () => `bsn_${randomHex(16)}`,
  newCapability: () => randomHex(32),
  newPartyId: () => `bpt_${randomHex(16)}`,
  newRequestId: () => `brq_${randomHex(16)}`,
  newRouteId: () => `brt_${randomHex(16)}`
}

const addMilliseconds = (instant: string, milliseconds: number): string =>
  new Date(new Date(instant).getTime() + milliseconds).toISOString()

const newSession = (id: string, merchantSlug: string, now: string): BookingSession => ({
  id,
  merchantSlug,
  checkoutPath: 'pay_in_person',
  lifecycle: 'active',
  createdAt: now,
  lastActivityAt: now,
  idleExpiresAt: addMilliseconds(now, 30 * 60_000),
  absoluteExpiresAt: addMilliseconds(now, 2 * 60 * 60_000),
  locale: 'en',
  embeddingProfile: 'standalone'
})

const constantTimeEqual = (left: string, right: string): boolean => {
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return difference === 0
}

const notFound = () =>
  new BookingSessionNotFound({ message: 'Booking Session not found' })

const gone = (record?: BookingSession) =>
  new BookingSessionGone({
    message: 'This Booking Session has expired',
    ...(record?.locale ? { locale: record.locale } : {}),
    ...(record?.embeddingProfile ? { embeddingProfile: record.embeddingProfile } : {})
  })

type StoredBookingSession = BookingSession & {
  readonly capabilityHash: string
  readonly replayExpiresAt?: string | null
}

const authorizeStoredSession = (
  record: StoredBookingSession | undefined,
  input: AuthorizeBookingSessionInput,
  candidateHash: string
): Effect.Effect<BookingSession, BookingSessionNotFound | BookingSessionGone> =>
  Effect.gen(function* () {
    const validLocator = record?.merchantSlug === input.merchantSlug
    const validCapability = constantTimeEqual(
      candidateHash,
      record?.capabilityHash ?? '0'.repeat(64)
    )
    if (!record || !validLocator || !validCapability) return yield* notFound()

    const nowMs = new Date(input.now).getTime()
    const confirmedReplay =
      record.lifecycle === 'consumed' &&
      input.allowConfirmedReplay === true &&
      !!record.replayExpiresAt &&
      nowMs < new Date(record.replayExpiresAt).getTime()
    if (
      !confirmedReplay &&
      (record.lifecycle !== 'active' ||
        nowMs >= new Date(record.idleExpiresAt).getTime() ||
        nowMs >= new Date(record.absoluteExpiresAt).getTime())
    ) {
      return yield* gone(record)
    }
    if (confirmedReplay) return record
    return {
      ...record,
      lastActivityAt: input.now,
      idleExpiresAt: new Date(
        Math.min(nowMs + 30 * 60_000, new Date(record.absoluteExpiresAt).getTime())
      ).toISOString()
    }
  })

export const SeedBookingSessions = (
  store: SeedBookingSessionStore,
  generators: BookingSessionGenerators = defaultGenerators
): Layer.Layer<BookingSessions> =>
  Layer.succeed(BookingSessions)({
    authorizeRoute: (input) =>
      Effect.gen(function* () {
        const record = [...store.sessions.values()].find(
          (candidate) => candidate.routeId === input.routeId
        )
        const presented = input.candidates.find(
          (candidate) => candidate.sessionId === record?.id
        )
        if (!record || !presented) return yield* notFound()
        const candidateHash = yield* Effect.promise(() =>
          hashSha256(presented.capability)
        )
        const authorized = yield* authorizeStoredSession(
          record,
          {
            merchantSlug: input.merchantSlug,
            sessionId: record.id,
            capability: presented.capability,
            now: input.now,
            ...(input.allowConfirmedReplay === undefined
              ? {}
              : { allowConfirmedReplay: input.allowConfirmedReplay })
          },
          candidateHash
        )
        store.sessions.set(record.id, { ...record, ...authorized })
        return authorized
      }),
    captureContext: (session, context) =>
      Effect.sync(() => {
        const record = store.sessions.get(session.id)
        if (!record) return
        store.sessions.set(session.id, {
          ...record,
          locale: context.locale ?? record.locale ?? 'en',
          embeddingProfile: context.embedding,
          acquisition:
            record.acquisition ??
            (Object.keys(context.acquisition).length > 0
              ? { ...context.acquisition }
              : null)
        })
        const party = store.parties.get(session.id)
        if (party && context.locale) party.locale = context.locale
      }),
    start: (input) =>
      Effect.gen(function* () {
        const merchant = store.merchants.get(input.merchantSlug)
        if (!merchant?.published) {
          return yield* new BookingPageUnavailable({
            message: 'Bookings are currently unavailable'
          })
        }

        const capability = generators.newCapability()
        const routeId = generators.newRouteId?.() ?? defaultGenerators.newRouteId!()
        const session = newSession(
          generators.newSessionId(),
          input.merchantSlug,
          input.now
        )
        const capabilityHash = yield* Effect.promise(() => hashSha256(capability))
        store.sessions.set(session.id, {
          ...session,
          merchantId: merchant.id,
          capabilityHash,
          routeId
        })
        store.parties.set(session.id, {
          id: generators.newPartyId?.() ?? defaultGenerators.newPartyId!(),
          bookingSessionId: session.id,
          requestId: generators.newRequestId?.() ?? defaultGenerators.newRequestId!(),
          shopId: `shp_${merchant.id}`,
          locale: 'en'
        })
        return { session, routeId, capability }
      }),
    authorize: (input) =>
      Effect.gen(function* () {
        const record = store.sessions.get(input.sessionId)
        const candidateHash = yield* Effect.promise(() => hashSha256(input.capability))
        const authorized = yield* authorizeStoredSession(record, input, candidateHash)
        if (!record) return yield* notFound()
        const refreshed: SeedBookingSessionRecord = {
          ...record,
          ...authorized
        }
        store.sessions.set(record.id, refreshed)
        return refreshed
      })
  })

const toBookingSession = (
  row: typeof bookingSessions.$inferSelect,
  merchantSlug: string
): BookingSession => ({
  id: row.id,
  merchantSlug,
  checkoutPath: row.checkoutPath ?? 'pay_in_person',
  lifecycle: row.lifecycle,
  createdAt: row.createdAt,
  lastActivityAt: row.lastActivityAt,
  idleExpiresAt: row.idleExpiresAt,
  absoluteExpiresAt: row.absoluteExpiresAt,
  locale:
    row.locale === 'es' || row.locale === 'fr' || row.locale === 'ro'
      ? row.locale
      : 'en',
  embeddingProfile: row.embeddingProfile
})

export const LiveBookingSessions: Layer.Layer<BookingSessions, never, Database> =
  Layer.effect(
    BookingSessions,
    Effect.gen(function* () {
      const db = yield* Database
      return {
        authorizeRoute: (input) =>
          Effect.gen(function* () {
            const [row] = yield* orUnavailable('booking-sessions')(
              db
                .select({ sessionId: bookingSessions.id })
                .from(bookingSessions)
                .innerJoin(merchants, eq(merchants.id, bookingSessions.merchantId))
                .where(
                  and(
                    eq(bookingSessions.routeId, input.routeId),
                    eq(merchants.slug, input.merchantSlug)
                  )
                )
                .limit(1)
            )
            const presented = input.candidates.find(
              (candidate) => candidate.sessionId === row?.sessionId
            )
            if (!row || !presented) return yield* notFound()
            const rows = yield* orUnavailable('booking-sessions')(
              db
                .select({ session: bookingSessions, merchantSlug: merchants.slug })
                .from(bookingSessions)
                .innerJoin(merchants, eq(merchants.id, bookingSessions.merchantId))
                .where(eq(bookingSessions.id, row.sessionId))
                .limit(1)
            )
            const stored = rows[0]
            const candidateHash = yield* Effect.promise(() =>
              hashSha256(presented.capability)
            )
            const authorized = yield* authorizeStoredSession(
              stored
                ? {
                    ...toBookingSession(stored.session, stored.merchantSlug),
                    capabilityHash: stored.session.capabilityHash,
                    replayExpiresAt: stored.session.replayExpiresAt
                  }
                : undefined,
              {
                merchantSlug: input.merchantSlug,
                sessionId: row.sessionId,
                capability: presented.capability,
                now: input.now,
                ...(input.allowConfirmedReplay === undefined
                  ? {}
                  : { allowConfirmedReplay: input.allowConfirmedReplay })
              },
              candidateHash
            )
            const [updated] = yield* orUnavailable('booking-sessions')(
              db
                .update(bookingSessions)
                .set({
                  lastActivityAt: authorized.lastActivityAt,
                  idleExpiresAt: authorized.idleExpiresAt
                })
                .where(eq(bookingSessions.id, row.sessionId))
                .returning()
            )
            if (!updated) return yield* gone(authorized)
            return toBookingSession(updated, input.merchantSlug)
          }),
        captureContext: (session, context) =>
          orUnavailable('booking-sessions')(
            batch(db, [
              db
                .update(bookingSessions)
                .set({
                  ...(context.locale ? { locale: context.locale } : {}),
                  embeddingProfile: context.embedding,
                  ...(Object.keys(context.acquisition).length > 0
                    ? {
                        acquisitionJson: sql<string>`coalesce(${bookingSessions.acquisitionJson}, ${JSON.stringify(context.acquisition)})`
                      }
                    : {})
                })
                .where(eq(bookingSessions.id, session.id)),
              db
                .update(bookingParties)
                .set({
                  ...(context.locale ? { locale: context.locale } : {}),
                  updatedAt: session.lastActivityAt
                })
                .where(eq(bookingParties.bookingSessionId, session.id))
            ])
          ),
        start: (input) =>
          Effect.gen(function* () {
            const capability = defaultGenerators.newCapability()
            const routeId = defaultGenerators.newRouteId!()
            const session = newSession(
              defaultGenerators.newSessionId(),
              input.merchantSlug,
              input.now
            )
            const capabilityHash = yield* Effect.promise(() => hashSha256(capability))
            const [merchant] = yield* orUnavailable('booking-sessions')(
              db
                .select({
                  id: merchants.id,
                  currency: merchants.currency
                })
                .from(merchants)
                .innerJoin(
                  publicBookingPages,
                  and(
                    eq(publicBookingPages.merchantId, merchants.id),
                    eq(publicBookingPages.status, 'published')
                  )
                )
                .where(eq(merchants.slug, input.merchantSlug))
                .limit(1)
            )
            if (!merchant) {
              return yield* new BookingPageUnavailable({
                message: 'Bookings are currently unavailable'
              })
            }
            const [shop] = yield* orUnavailable('booking-sessions')(
              db
                .select({ id: shops.id })
                .from(shops)
                .where(eq(shops.merchantId, merchant.id))
                .orderBy(shops.id)
                .limit(1)
            )
            if (!shop) {
              return yield* new CapabilityUnavailable({
                capability: 'booking-sessions',
                reason: 'missing_normalized_shop'
              })
            }
            const partyId = defaultGenerators.newPartyId!()
            const requestId = defaultGenerators.newRequestId!()
            yield* orUnavailable('booking-sessions')(
              batch(db, [
                db.insert(bookingSessions).values({
                  id: session.id,
                  routeId,
                  merchantId: merchant.id,
                  capabilityHash,
                  checkoutPath: 'pay_in_person',
                  lifecycle: 'active',
                  createdAt: session.createdAt,
                  lastActivityAt: session.lastActivityAt,
                  idleExpiresAt: session.idleExpiresAt,
                  absoluteExpiresAt: session.absoluteExpiresAt
                }),
                db.insert(bookingParties).values({
                  id: partyId,
                  bookingSessionId: session.id,
                  shopId: shop.id,
                  activeRequestId: requestId,
                  lifecycle: 'active',
                  currency: merchant.currency,
                  locale: 'en',
                  version: 1,
                  createdAt: input.now,
                  updatedAt: input.now
                }),
                db.insert(bookingRequests).values({
                  id: requestId,
                  bookingPartyId: partyId,
                  position: 0,
                  createdAt: input.now,
                  updatedAt: input.now
                })
              ])
            )
            return { session, routeId, capability }
          }),
        authorize: (input) =>
          Effect.gen(function* () {
            const rows = yield* orUnavailable('booking-sessions')(
              db
                .select({ session: bookingSessions, merchantSlug: merchants.slug })
                .from(bookingSessions)
                .innerJoin(merchants, eq(merchants.id, bookingSessions.merchantId))
                .where(eq(bookingSessions.id, input.sessionId))
                .limit(1)
            )
            const row = rows[0]
            const candidateHash = yield* Effect.promise(() =>
              hashSha256(input.capability)
            )
            const authorized = yield* authorizeStoredSession(
              row
                ? {
                    ...toBookingSession(row.session, row.merchantSlug),
                    capabilityHash: row.session.capabilityHash,
                    replayExpiresAt: row.session.replayExpiresAt
                  }
                : undefined,
              input,
              candidateHash
            )
            if (!row) return yield* notFound()
            if (authorized.lifecycle === 'consumed') return authorized
            const refreshed = yield* orUnavailable('booking-sessions')(
              db
                .update(bookingSessions)
                .set({
                  lastActivityAt: authorized.lastActivityAt,
                  idleExpiresAt: authorized.idleExpiresAt
                })
                .where(
                  and(
                    eq(bookingSessions.id, row.session.id),
                    eq(bookingSessions.capabilityHash, row.session.capabilityHash),
                    eq(bookingSessions.lifecycle, 'active'),
                    gt(bookingSessions.idleExpiresAt, input.now),
                    gt(bookingSessions.absoluteExpiresAt, input.now)
                  )
                )
                .returning()
            )
            const updated = refreshed[0]
            if (!updated) return yield* gone(authorized)
            return toBookingSession(updated, row.merchantSlug)
          })
      }
    })
  )
