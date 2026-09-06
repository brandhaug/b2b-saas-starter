import { Effect } from 'effect'
import { expect, layer } from '@effect/vitest'

import { AuditEventLog } from './audit-event-log.ts'
import { AccountPreferencesService } from './account-preferences.ts'
import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'live account preferences',
  (it) => {
    it.effect('persists locale and initializes a missing timezone once', () =>
      inWorkspace(
        'live-lab',
        Effect.gen(function* () {
          const preferences = yield* AccountPreferencesService
          expect(yield* preferences.get('usr_owner')).toEqual({
            locale: null,
            timeZone: null
          })
          expect(
            yield* preferences.set({
              userId: 'usr_owner',
              locale: 'nb',
              timeZone: 'Europe/Oslo',
              initializeTimeZone: true
            })
          ).toEqual({ locale: 'nb', timeZone: 'Europe/Oslo' })
          expect(yield* preferences.getByEmail('OWNER@LIVE.TEST')).toEqual({
            locale: 'nb',
            timeZone: 'Europe/Oslo'
          })
          expect(
            yield* preferences.set({
              userId: 'usr_owner',
              locale: 'en',
              timeZone: 'America/New_York',
              initializeTimeZone: true
            })
          ).toEqual({ locale: 'en', timeZone: 'Europe/Oslo' })
          expect(
            yield* preferences.set({
              userId: 'usr_owner',
              timeZone: 'America/New_York',
              initializeTimeZone: true
            })
          ).toEqual({ locale: 'en', timeZone: 'Europe/Oslo' })
          const audit = yield* AuditEventLog
          const changes = (yield* audit.listGlobal).filter(
            (event) => event.eventType === 'auth.user_updated'
          )
          expect(changes).toHaveLength(2)
        }),
        { userId: 'usr_owner' }
      )
    )
  }
)
