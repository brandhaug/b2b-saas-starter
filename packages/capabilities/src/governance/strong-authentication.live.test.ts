import { session, twoFactor, passkey } from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { DateTime, Effect, Result } from 'effect'
import { eq } from 'drizzle-orm'
import { expect, layer } from '@effect/vitest'

import { StrongAuthentication } from './strong-authentication.ts'
import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'live strong authentication',
  (it) => {
    it.effect('binds assurance to a current session and current factor', () =>
      inWorkspace(
        'live-lab',
        Effect.gen(function* () {
          const db = yield* Database
          const now = DateTime.toDate(yield* DateTime.now)
          const sessionId = 'session_assurance_live'
          const passkeyId = 'passkey_assurance_live'
          yield* db.insert(session).values({
            id: sessionId,
            token: 'token_assurance_live',
            userId: 'usr_owner',
            // oxlint-disable-next-line effect/noGlobals -- test fixture date derived from the live clock
            expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
            strongAuthAt: now,
            strongAuthMethod: 'passkey',
            strongAuthCredentialId: passkeyId
          })
          yield* db.insert(passkey).values({
            id: passkeyId,
            userId: 'usr_owner',
            publicKey: 'public-key',
            credentialID: 'credential-id',
            counter: 0,
            deviceType: 'singleDevice',
            backedUp: false,
            createdAt: now
          })
          const assurance = yield* StrongAuthentication
          expect(yield* assurance.status({ userId: 'usr_owner', sessionId })).toEqual({
            qualified: true,
            recent: true,
            recovering: false,
            hasFactors: true,
            passwordVerified: false
          })
          expect(
            (yield* assurance.status({ userId: 'usr_outsider', sessionId })).qualified
          ).toBe(false)

          yield* db.delete(passkey).where(eq(passkey.id, passkeyId))
          expect(
            (yield* assurance.status({ userId: 'usr_owner', sessionId })).qualified
          ).toBe(false)
          yield* db.delete(session).where(eq(session.id, sessionId))
        })
      )
    )

    it.effect(
      'recent proof expires independently of privileged entry and cannot survive revocation',
      () =>
        inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const db = yield* Database
            const authentication = yield* StrongAuthentication
            const now = DateTime.toDate(yield* DateTime.now)
            const sessionId = 'session_recent_proof'
            const totpId = 'totp_recent_proof'
            const input = { userId: 'usr_owner', sessionId }
            yield* db.insert(session).values({
              id: sessionId,
              token: 'token_recent_proof',
              userId: input.userId,
              // oxlint-disable-next-line effect/noGlobals -- fixture date uses the test clock
              expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
              passwordVerifiedAt: now
            })
            yield* authentication.requireRecent(input)
            expect((yield* authentication.status(input)).qualified).toBe(false)
            yield* db.insert(twoFactor).values({
              id: totpId,
              userId: input.userId,
              secret: 'secret',
              backupCodes: '[]',
              verified: true
            })
            expect(
              Result.isFailure(
                yield* Effect.result(authentication.requireRecent(input))
              )
            ).toBe(true)
            yield* db
              .update(session)
              .set({
                strongAuthAt: now,
                strongAuthMethod: 'totp',
                strongAuthCredentialId: totpId
              })
              .where(eq(session.id, sessionId))
            yield* authentication.requireRecent(input)
            expect(
              Result.isFailure(
                yield* Effect.result(
                  authentication.requireRecent({ ...input, userId: 'usr_outsider' })
                )
              )
            ).toBe(true)
            expect(
              Result.isFailure(
                yield* Effect.result(
                  authentication.requireRecent({
                    ...input,
                    sessionId: 'another-session'
                  })
                )
              )
            ).toBe(true)
            yield* db
              .update(session)
              .set({
                // oxlint-disable-next-line effect/noGlobals -- fixture date uses the test clock
                strongAuthAt: new Date(now.getTime() - 6 * 60 * 1000)
              })
              .where(eq(session.id, sessionId))
            yield* authentication.require(input)
            expect(
              Result.isFailure(
                yield* Effect.result(authentication.requireRecent(input))
              )
            ).toBe(true)
            // Extending the session lifetime cannot renew the original ceremony.
            yield* db
              .update(session)
              .set({
                // oxlint-disable-next-line effect/noGlobals -- fixture date uses the test clock
                expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000)
              })
              .where(eq(session.id, sessionId))
            expect(
              Result.isFailure(
                yield* Effect.result(authentication.requireRecent(input))
              )
            ).toBe(true)
            yield* db
              .update(session)
              .set({ strongAuthAt: now })
              .where(eq(session.id, sessionId))
            yield* authentication.requireRecent(input)
            yield* db.delete(twoFactor).where(eq(twoFactor.id, totpId))
            expect(
              Result.isFailure(
                yield* Effect.result(authentication.requireRecent(input))
              )
            ).toBe(true)
            yield* db
              .update(session)
              .set({
                strongAuthAt: null,
                strongAuthMethod: null,
                strongAuthCredentialId: null,
                // oxlint-disable-next-line effect/noGlobals -- fixture date uses the test clock
                recoveryUntil: new Date(now.getTime() + 60 * 60 * 1000)
              })
              .where(eq(session.id, sessionId))
            expect(
              Result.isFailure(
                yield* Effect.result(authentication.requireRecent(input))
              )
            ).toBe(true)
            yield* db.delete(session).where(eq(session.id, sessionId))
            expect(
              Result.isFailure(
                yield* Effect.result(authentication.requireRecent(input))
              )
            ).toBe(true)
          })
        )
    )

    it.effect(
      'rejects expired, revoked, impersonating, stale and recovery sessions',
      () =>
        inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const db = yield* Database
            const now = DateTime.toDate(yield* DateTime.now)
            const sessionId = 'session_assurance_states'
            const totpId = 'totp_assurance_states'
            yield* db.insert(session).values({
              id: sessionId,
              token: 'token_assurance_states',
              userId: 'usr_owner',
              // oxlint-disable-next-line effect/noGlobals -- test fixture date derived from the live clock
              expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
              passwordVerifiedAt: now,
              strongAuthAt: now,
              strongAuthMethod: 'totp',
              strongAuthCredentialId: totpId
            })
            yield* db.insert(twoFactor).values({
              id: totpId,
              userId: 'usr_owner',
              secret: 'secret',
              backupCodes: '[]',
              verified: true
            })
            const assurance = yield* StrongAuthentication
            expect(
              (yield* assurance.status({ userId: 'usr_owner', sessionId })).qualified
            ).toBe(true)
            yield* db
              .update(session)
              // oxlint-disable-next-line effect/noGlobals -- test fixture date derived from the live clock
              .set({ strongAuthAt: new Date(now.getTime() - 12 * 60 * 60 * 1000 - 1) })
              .where(eq(session.id, sessionId))
            expect(
              (yield* assurance.status({ userId: 'usr_owner', sessionId })).qualified
            ).toBe(false)
            yield* db
              .update(session)
              .set({ strongAuthAt: now })
              .where(eq(session.id, sessionId))
            yield* db
              .update(session)
              // oxlint-disable-next-line effect/noGlobals -- test fixture date derived from the live clock
              .set({ recoveryUntil: new Date(now.getTime() + 60 * 60 * 1000) })
              .where(eq(session.id, sessionId))
            expect(yield* assurance.status({ userId: 'usr_owner', sessionId })).toEqual(
              {
                qualified: false,
                recent: false,
                recovering: true,
                hasFactors: true,
                passwordVerified: true
              }
            )
            yield* db
              .update(session)
              .set({ recoveryUntil: null, impersonatedBy: 'usr_sysadmin' })
              .where(eq(session.id, sessionId))
            expect(yield* assurance.status({ userId: 'usr_owner', sessionId })).toEqual(
              {
                qualified: false,
                recent: false,
                recovering: false,
                hasFactors: true,
                passwordVerified: false
              }
            )
            yield* db
              .update(session)
              // oxlint-disable-next-line effect/noGlobals -- test fixture date derived from the live clock
              .set({ impersonatedBy: null, expiresAt: new Date(now.getTime() - 1) })
              .where(eq(session.id, sessionId))
            expect(yield* assurance.status({ userId: 'usr_owner', sessionId })).toEqual(
              {
                qualified: false,
                recent: false,
                recovering: false,
                hasFactors: false,
                passwordVerified: false
              }
            )
            yield* db.delete(twoFactor).where(eq(twoFactor.id, totpId))
            yield* db.delete(session).where(eq(session.id, sessionId))
          })
        )
    )
  }
)
