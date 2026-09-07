import { Effect, Layer } from 'effect'
import { describe, expect, it } from '@effect/vitest'

import { AccountPreferencesRejected } from '../errors.ts'
import { AuditEventLog, SeedAuditEventLog } from './audit-event-log.ts'
import {
  AccountPreferencesService,
  SeedAccountPreferences
} from './account-preferences.ts'

const audit = SeedAuditEventLog([])
const layer = Layer.merge(
  audit,
  SeedAccountPreferences([
    { userId: 'usr_demo', locale: null, timeZone: null },
    {
      userId: 'usr_nb',
      email: 'martin@example.com',
      locale: 'nb',
      timeZone: 'Europe/Oslo'
    }
  ]).pipe(Layer.provide(audit))
)

describe('account preferences', () => {
  it.effect('persists locale and initializes a timezone once', () =>
    Effect.gen(function* () {
      const preferences = yield* AccountPreferencesService
      expect(yield* preferences.get('usr_demo')).toEqual({
        locale: null,
        timeZone: null
      })
      expect(yield* preferences.getByEmail('MARTIN@example.com')).toEqual({
        locale: 'nb',
        timeZone: 'Europe/Oslo'
      })
      expect(yield* preferences.getByEmail('unknown@example.com')).toBeNull()
      expect(
        yield* preferences.set({
          userId: 'usr_demo',
          locale: 'nb',
          timeZone: 'Europe/Oslo',
          initializeTimeZone: true
        })
      ).toEqual({ locale: 'nb', timeZone: 'Europe/Oslo' })
      expect(
        yield* preferences.set({
          userId: 'usr_demo',
          timeZone: 'America/New_York',
          initializeTimeZone: true
        })
      ).toEqual({ locale: 'nb', timeZone: 'Europe/Oslo' })
      expect(
        yield* preferences.set({
          userId: 'usr_demo',
          locale: 'en',
          timeZone: 'America/New_York',
          initializeTimeZone: true
        })
      ).toEqual({ locale: 'en', timeZone: 'Europe/Oslo' })
      const events = yield* (yield* AuditEventLog).listGlobal
      expect(
        events.filter((event) => event.eventType === 'auth.user_updated')
      ).toHaveLength(2)
    }).pipe(Effect.provide(layer))
  )

  it.effect('rejects invalid timezones before mutating the account', () =>
    Effect.gen(function* () {
      const preferences = yield* AccountPreferencesService
      const result = yield* Effect.result(
        preferences.set({ userId: 'usr_demo', timeZone: 'Not/A-Timezone' })
      )
      expect(result._tag).toBe('Failure')
      if (result._tag === 'Failure') {
        expect(result.failure).toBeInstanceOf(AccountPreferencesRejected)
      }
      expect(yield* preferences.get('usr_demo')).toEqual({
        locale: null,
        timeZone: null
      })
    }).pipe(Effect.provide(layer))
  )
})
