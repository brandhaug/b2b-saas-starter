import { Context, Effect, Layer, Schema } from 'effect'
import { and, eq, gt, sql } from 'drizzle-orm'
import {
  bookingSessions,
  Database,
  merchants,
  publicBookingPages
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
  absoluteExpiresAt: Schema.String
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
  { message: Schema.String }
) {}

export type StartBookingSessionInput = {
  readonly merchantSlug: string
  readonly now: string
}

export type IssuedBookingSession = {
  readonly session: BookingSession
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
}

export type AuthorizeBookingSessionInput = {
  readonly merchantSlug: string
  readonly sessionId: string
  readonly capability: string
  readonly now: string
}

export type PresentedBookingSessionCapability = {
  readonly sessionId: string
  readonly capability: string
}

export type BookingSessionEntry =
  | {
      readonly kind: 'created'
      readonly session: BookingSession
      readonly capability: string
    }
  | { readonly kind: 'resumed'; readonly session: BookingSession }

export class BookingSessions extends Context.Service<
  BookingSessions,
  BookingSessionsShape
>()('@b2b-saas-starter/capabilities/BookingSessions') {}

export const enterBookingSession = (input: {
  readonly merchantSlug: string
  readonly candidates: readonly PresentedBookingSessionCapability[]
  readonly now: string
}): Effect.Effect<
  BookingSessionEntry,
  BookingPageUnavailable | CapabilityUnavailable,
  BookingSessions
> =>
  Effect.gen(function* () {
    const sessions = yield* BookingSessions
    for (const candidate of input.candidates) {
      const result = yield* Effect.result(
        sessions.authorize({
          merchantSlug: input.merchantSlug,
          sessionId: candidate.sessionId,
          capability: candidate.capability,
          now: input.now
        })
      )
      if (result._tag === 'Success') {
        return { kind: 'resumed' as const, session: result.success }
      }
      if (result.failure instanceof CapabilityUnavailable) {
        return yield* result.failure
      }
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
}

export type SeedBookingSessionStore = {
  readonly merchants: Map<
    string,
    { readonly id: string; readonly slug: string; published: boolean }
  >
  readonly sessions: Map<string, SeedBookingSessionRecord>
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
  sessions: new Map()
})

type BookingSessionGenerators = {
  readonly newSessionId: () => string
  readonly newCapability: () => string
}

const defaultGenerators: BookingSessionGenerators = {
  newSessionId: () => `bsn_${randomHex(16)}`,
  newCapability: () => randomHex(32)
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
  absoluteExpiresAt: addMilliseconds(now, 2 * 60 * 60_000)
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

const gone = () =>
  new BookingSessionGone({ message: 'This Booking Session has expired' })

type StoredBookingSession = BookingSession & { readonly capabilityHash: string }

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
    if (
      record.lifecycle !== 'active' ||
      nowMs >= new Date(record.idleExpiresAt).getTime() ||
      nowMs >= new Date(record.absoluteExpiresAt).getTime()
    ) {
      return yield* gone()
    }
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
    start: (input) =>
      Effect.gen(function* () {
        const merchant = store.merchants.get(input.merchantSlug)
        if (!merchant?.published) {
          return yield* new BookingPageUnavailable({
            message: 'Bookings are currently unavailable'
          })
        }

        const capability = generators.newCapability()
        const session = newSession(
          generators.newSessionId(),
          input.merchantSlug,
          input.now
        )
        const capabilityHash = yield* Effect.promise(() => hashSha256(capability))
        store.sessions.set(session.id, {
          ...session,
          merchantId: merchant.id,
          capabilityHash
        })
        return { session, capability }
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
  checkoutPath: row.checkoutPath,
  lifecycle: row.lifecycle,
  createdAt: row.createdAt,
  lastActivityAt: row.lastActivityAt,
  idleExpiresAt: row.idleExpiresAt,
  absoluteExpiresAt: row.absoluteExpiresAt
})

export const LiveBookingSessions: Layer.Layer<BookingSessions, never, Database> =
  Layer.effect(
    BookingSessions,
    Effect.gen(function* () {
      const db = yield* Database
      return {
        start: (input) =>
          Effect.gen(function* () {
            const capability = defaultGenerators.newCapability()
            const session = newSession(
              defaultGenerators.newSessionId(),
              input.merchantSlug,
              input.now
            )
            const capabilityHash = yield* Effect.promise(() => hashSha256(capability))
            const inserted = yield* orUnavailable('booking-sessions')(
              db
                .insert(bookingSessions)
                .select(
                  db
                    .select({
                      id: sql<string>`${session.id}`.as('id'),
                      merchantId: merchants.id,
                      capabilityHash: sql<string>`${capabilityHash}`.as(
                        'capability_hash'
                      ),
                      checkoutPath: sql<'pay_in_person'>`'pay_in_person'`.as(
                        'checkout_path'
                      ),
                      lifecycle: sql<'active'>`'active'`.as('lifecycle'),
                      createdAt: sql<string>`${session.createdAt}`.as('created_at'),
                      lastActivityAt: sql<string>`${session.lastActivityAt}`.as(
                        'last_activity_at'
                      ),
                      idleExpiresAt: sql<string>`${session.idleExpiresAt}`.as(
                        'idle_expires_at'
                      ),
                      absoluteExpiresAt: sql<string>`${session.absoluteExpiresAt}`.as(
                        'absolute_expires_at'
                      )
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
                .returning({ id: bookingSessions.id })
            )
            if (inserted.length === 0) {
              return yield* new BookingPageUnavailable({
                message: 'Bookings are currently unavailable'
              })
            }
            return { session, capability }
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
                    capabilityHash: row.session.capabilityHash
                  }
                : undefined,
              input,
              candidateHash
            )
            if (!row) return yield* notFound()
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
            if (!updated) return yield* gone()
            return toBookingSession(updated, row.merchantSlug)
          })
      }
    })
  )
