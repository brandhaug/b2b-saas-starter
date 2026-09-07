import { accountLocales } from '@b2b-saas-starter/db/enums'
import { isLocale, type Locale } from '@b2b-saas-starter/i18n/locale'
import { user } from '@b2b-saas-starter/db/schema'
import { Database, type RawD1 } from '@b2b-saas-starter/db/service'
import { Context, Effect, Layer, Ref, Schema } from 'effect'
import { eq, sql, type SQL } from 'drizzle-orm'

import { AccountPreferencesRejected } from '../errors.ts'
import {
  type CapabilityUnavailable,
  orUnavailable
} from '@b2b-saas-starter/failure/capability'
import { AuditEventLog, type RecordAuditEventInput } from './audit-event-log.ts'
import { auditedMutations } from './audited-mutation.ts'

export const AccountLocale = Schema.Literals(accountLocales)
export type AccountLocale = Locale

export const AccountPreferences = Schema.Struct({
  locale: Schema.NullOr(AccountLocale),
  timeZone: Schema.NullOr(Schema.String)
})
export type AccountPreferences = typeof AccountPreferences.Type

type AccountPreferencesUpdate = {
  locale?: AccountPreferences['locale']
  timeZone?: string | SQL<unknown> | null
}

export type SetAccountPreferencesInput = {
  readonly userId: string
  readonly locale?: AccountLocale | null | undefined
  readonly timeZone?: string | null | undefined
  /** Set the browser supplied timezone only when the account has none yet. */
  readonly initializeTimeZone?: boolean | undefined
}

export type SeedAccountPreference = AccountPreferences & {
  readonly userId: string
  readonly email?: string | undefined
}

export type AccountPreferencesInterface = {
  readonly get: (
    userId: string
  ) => Effect.Effect<AccountPreferences, CapabilityUnavailable>
  /** Resolve preferences for an email recipient; null means no account exists. */
  readonly getByEmail: (
    email: string
  ) => Effect.Effect<AccountPreferences | null, CapabilityUnavailable>
  readonly set: (
    input: SetAccountPreferencesInput
  ) => Effect.Effect<
    AccountPreferences,
    CapabilityUnavailable | AccountPreferencesRejected
  >
}

export class AccountPreferencesService extends Context.Service<
  AccountPreferencesService,
  AccountPreferencesInterface
>()('@b2b-saas-starter/capabilities/AccountPreferences') {}

function preferenceChanged(input: SetAccountPreferencesInput): RecordAuditEventInput {
  const metadata: Record<string, string | boolean | null> = {}
  if (input.locale !== undefined) {
    metadata.locale = input.locale
  }
  if (input.timeZone !== undefined) {
    metadata.timeZone = input.timeZone
  }
  if (input.initializeTimeZone !== undefined) {
    metadata.initializeTimeZone = input.initializeTimeZone
  }
  return {
    actorUserId: input.userId,
    actorType: 'user',
    eventType: 'auth.user_updated',
    targetType: 'user',
    targetId: input.userId,
    metadata
  }
}

export function SeedAccountPreferences(
  seed: ReadonlyArray<SeedAccountPreference>
): Layer.Layer<AccountPreferencesService, never, AuditEventLog> {
  return Layer.effect(AccountPreferencesService)(
    Effect.gen(function* () {
      const audit = yield* AuditEventLog
      const store = yield* Ref.make(new Map(seed.map((row) => [row.userId, row])))
      const byEmail = new Map<string, string>()
      for (const row of seed) {
        if (row.email !== undefined) {
          byEmail.set(row.email.toLowerCase(), row.userId)
        }
      }
      function get(userId: string) {
        return Effect.map(Ref.get(store), (rows) => {
          const row = rows.get(userId)
          return {
            locale: row?.locale ?? null,
            timeZone: row?.timeZone ?? null
          }
        })
      }
      return {
        get,
        getByEmail: (email) => {
          const userId = byEmail.get(email.toLowerCase())
          if (userId === undefined) {
            return Effect.succeed(null)
          }
          return Effect.map(get(userId), (preferences) => preferences)
        },
        set: (input) =>
          Effect.gen(function* () {
            const stored = yield* Ref.get(store)
            const row = stored.get(input.userId)
            const current = {
              locale: row?.locale ?? null,
              timeZone: row?.timeZone ?? null
            }
            if (
              row === undefined ||
              (input.locale === undefined && input.timeZone === undefined)
            ) {
              return current
            }
            const rejected = validateInput(input)
            if (rejected !== null) {
              return yield* Effect.fail(rejected)
            }
            if (
              input.locale === undefined &&
              input.timeZone !== undefined &&
              input.initializeTimeZone === true &&
              current.timeZone !== null
            ) {
              return current
            }
            const result = yield* Ref.modify(
              store,
              (
                rows
              ): readonly [
                { readonly preferences: AccountPreferences; readonly changed: boolean },
                Map<string, SeedAccountPreference>
              ] => {
                const latest = rows.get(input.userId)
                if (latest === undefined) {
                  return [{ preferences: current, changed: false }, rows]
                }
                const latestPreferences: AccountPreferences = {
                  locale: latest.locale ?? null,
                  timeZone: latest.timeZone ?? null
                }
                let nextLocale = latestPreferences.locale
                if (input.locale !== undefined) {
                  nextLocale = input.locale
                }
                let nextTimeZone = latestPreferences.timeZone
                if (input.timeZone !== undefined) {
                  nextTimeZone = input.timeZone
                }
                if (
                  input.initializeTimeZone === true &&
                  latestPreferences.timeZone !== null
                ) {
                  nextTimeZone = latestPreferences.timeZone
                }
                const next: AccountPreferences = {
                  locale: nextLocale,
                  timeZone: nextTimeZone
                }
                return [
                  { preferences: next, changed: true },
                  new Map(rows).set(input.userId, { userId: input.userId, ...next })
                ]
              }
            )
            if (result.changed) {
              yield* audit.record(preferenceChanged(input))
            }
            return result.preferences
          })
      }
    })
  )
}

const unavailable = orUnavailable('account-preferences')

function isValidTimeZone(value: string): boolean {
  if (value.length === 0 || value.length > 128) {
    return false
  }
  // SAFETY: Intl.DateTimeFormat is the platform's IANA timezone validator and
  // throws synchronously for an unknown timezone.
  // oxlint-disable-next-line effect/noTryCatch -- this pure validation helper returns a boolean
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

function validateInput(input: SetAccountPreferencesInput) {
  if (input.locale !== undefined && input.locale !== null && !isLocale(input.locale)) {
    return new AccountPreferencesRejected({ reason: 'invalid_locale' })
  }
  if (
    input.timeZone !== undefined &&
    input.timeZone !== null &&
    !isValidTimeZone(input.timeZone)
  ) {
    return new AccountPreferencesRejected({ reason: 'invalid_timezone' })
  }
  return null
}

export const LiveAccountPreferences: Layer.Layer<
  AccountPreferencesService,
  never,
  Database | RawD1 | AuditEventLog
> = Layer.effect(AccountPreferencesService)(
  Effect.gen(function* () {
    const db = yield* Database
    const audit = yield* AuditEventLog
    const auditedMutation = yield* auditedMutations({
      prepareAuditRecord: audit.prepareRecord,
      unavailable
    })

    function get(userId: string) {
      return unavailable(
        db
          .select({ locale: user.locale, timeZone: user.timeZone })
          .from(user)
          .where(eq(user.id, userId))
          .limit(1)
      ).pipe(
        Effect.map((rows) => {
          const row = rows[0]
          if (row === undefined) {
            return { locale: null, timeZone: null }
          }
          return {
            locale: row.locale ?? null,
            timeZone: row.timeZone ?? null
          }
        })
      )
    }

    function getByEmail(email: string) {
      return unavailable(
        db
          .select({ locale: user.locale, timeZone: user.timeZone })
          .from(user)
          .where(eq(user.email, email.toLowerCase()))
          .limit(1)
      ).pipe(
        Effect.map((rows) => {
          const row = rows[0]
          if (row === undefined) {
            return null
          }
          return { locale: row.locale ?? null, timeZone: row.timeZone ?? null }
        })
      )
    }

    return {
      get,
      getByEmail,
      set: (input) =>
        Effect.gen(function* () {
          const current = yield* get(input.userId)
          if (input.locale === undefined && input.timeZone === undefined) {
            return current
          }
          const rejected = validateInput(input)
          if (rejected !== null) {
            return yield* Effect.fail(rejected)
          }
          let locale = current.locale
          if (input.locale !== undefined) {
            locale = input.locale
          }
          const shouldInitialize =
            input.initializeTimeZone === true && current.timeZone === null
          if (
            input.locale === undefined &&
            input.timeZone !== undefined &&
            input.initializeTimeZone === true &&
            !shouldInitialize
          ) {
            return current
          }
          let timeZone = current.timeZone
          if (input.timeZone !== undefined) {
            timeZone = input.timeZone
          }
          if (input.initializeTimeZone === true && !shouldInitialize) {
            timeZone = current.timeZone
          }
          yield* auditedMutation({
            matched: unavailable(
              db
                .select({ id: user.id })
                .from(user)
                .where(eq(user.id, input.userId))
                .limit(1)
            ).pipe(Effect.map((rows) => rows.length > 0)),
            auditEvent: preferenceChanged(input),
            write: () => {
              const values: AccountPreferencesUpdate = {}
              if (input.locale !== undefined) {
                values.locale = locale
              }
              if (input.timeZone !== undefined) {
                if (input.initializeTimeZone === true) {
                  // Keep an already initialized timezone while allowing an
                  // explicit locale in the same atomic update. A conditional
                  // WHERE would discard that locale when two first visits
                  // race to initialize the account.
                  values.timeZone = sql`coalesce(${user.timeZone}, ${input.timeZone})`
                } else {
                  values.timeZone = timeZone
                }
              }
              return db.update(user).set(values).where(eq(user.id, input.userId))
            }
          })
          // The conditional update above is intentionally followed by a read;
          // the returned row is authoritative if another request initialized
          // the timezone concurrently.
          return yield* get(input.userId)
        })
    }
  })
)
