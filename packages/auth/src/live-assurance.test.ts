// oxlint-disable effect/noGlobals -- The native Better Auth adapter and real D1 use the wall clock.
import { session, user, twoFactor } from '@b2b-saas-starter/db/schema'
import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Exit, Fiber, type Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { cookieHeader, cookiePairs, mergeCookiePairs } from 'effectful-better-auth'
import { vi } from 'vite-plus/test'
import { Auth } from './index.ts'
import { decodeUriSecret } from './test-totp.ts'
import {
  buildAuthLayer,
  enableTotp,
  provisionAuthD1,
  signUpSession,
  type AuthService,
  type ProvisionedAuthD1
} from './test-auth-layer.ts'

const PASSWORD = 'correct-horse-battery-staple'
let provisioned: ProvisionedAuthD1
let authLayer: Layer.Layer<AuthService>
const recoveryStarted = vi.fn().mockResolvedValue(undefined)

// oxlint-disable-next-line effect/noTestLifecycleHooks -- owns the workerd process
beforeAll(
  () =>
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- lifecycle bridge for the real D1 process
    Effect.runPromise(
      Effect.gen(function* () {
        provisioned = yield* Effect.promise(() => provisionAuthD1())
        authLayer = buildAuthLayer(provisioned.db, {
          recoveryHooks: { onRecoveryStarted: recoveryStarted }
        })
      })
    ),
  60_000
)
// oxlint-disable-next-line effect/noTestLifecycleHooks -- disposes the workerd process
afterAll(() => provisioned.dispose())

function run<A, E>(effect: Effect.Effect<A, E, AuthService>) {
  return Effect.provide(effect, authLayer)
}

function headersOf(headers: Headers) {
  return new Headers({
    cookie: cookieHeader(mergeCookiePairs([], cookiePairs(headers)))
  })
}

function readSession(headers: Headers) {
  return Effect.gen(function* () {
    const auth = yield* Auth.Tag
    const current = yield* auth.api.getSession({ headers })
    if (!current) {
      return yield* Effect.die('Expected session')
    }
    const [stored] = yield* Effect.promise(() =>
      provisioned.db.select().from(session).where(eq(session.id, current.session.id))
    )
    if (!stored) {
      return yield* Effect.die('Expected stored session')
    }
    return stored
  })
}

function backupChallenge(email: string) {
  return Effect.gen(function* () {
    const signup = yield* signUpSession(email)
    const enrolled = yield* enableTotp(signup)
    const code = enrolled.response.backupCodes[0]
    if (!code) {
      return yield* Effect.die('Expected backup code')
    }
    const auth = yield* Auth.Tag
    const challenge = yield* auth.full.signInEmail({
      body: { email, password: PASSWORD }
    })
    return { userId: signup.userId, code, headers: headersOf(challenge.headers) }
  })
}

describe('session evidence lifecycle', () => {
  it.live(
    'blocks a known cookie while recovery notification is pending and never restores a deleted session',
    () =>
      run(
        Effect.gen(function* () {
          const signup = yield* signUpSession('pending-notice@assurance.test')
          const enrolled = yield* enableTotp(signup)
          const code = enrolled.response.backupCodes[0]
          if (!code) {
            return yield* Effect.die('Expected backup code')
          }
          const headers = new Headers({ cookie: enrolled.freshCookieHeader })
          const original = yield* readSession(headers)
          const callbackStarted = yield* Deferred.make<undefined>()
          const completeCallback = yield* Deferred.make<undefined>()
          recoveryStarted.mockImplementationOnce(() =>
            // oxlint-disable-next-line starter/no-run-promise-in-tests -- onRecoveryStarted is Better Auth's Promise callback; Deferred controls its real request boundary
            Effect.runPromise(
              Effect.gen(function* () {
                yield* Deferred.succeed(callbackStarted, undefined)
                yield* Deferred.await(completeCallback)
              })
            )
          )
          const auth = yield* Auth.Tag
          const verification = yield* Effect.forkChild(
            Effect.exit(auth.api.verifyBackupCode({ body: { code }, headers }))
          )
          yield* Deferred.await(callbackStarted)
          const [pending] = yield* Effect.promise(() =>
            provisioned.db.select().from(session).where(eq(session.id, original.id))
          )
          expect(pending?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now())
          expect(pending?.strongAuthAt).toBeNull()
          const repair = yield* auth.api
            .enableTwoFactor({ body: { password: PASSWORD }, headers })
            .pipe(
              Effect.match({ onSuccess: () => null, onFailure: (error) => error.code })
            )
          expect(repair).toBe('UNAUTHORIZED')
          yield* Deferred.succeed(completeCallback, undefined)
          expect(Exit.isFailure(yield* Fiber.join(verification))).toBe(true)
          const remaining = yield* Effect.promise(() =>
            provisioned.db
              .select()
              .from(session)
              .where(eq(session.userId, signup.userId))
          )
          expect(remaining).toHaveLength(0)
        })
      ),
    { timeout: 30_000 }
  )

  it.live(
    'requires verification of an in-place replacement before leaving recovery',
    () =>
      run(
        Effect.gen(function* () {
          const challenge = yield* backupChallenge('inplace@assurance.test')
          const auth = yield* Auth.Tag
          const recovered = yield* auth.full.verifyBackupCode({
            body: { code: challenge.code },
            headers: challenge.headers
          })
          const headers = headersOf(recovered.headers)
          const original = yield* readSession(headers)
          const replacement = yield* auth.api.enableTwoFactor({
            body: { password: PASSWORD },
            headers
          })
          if (replacement.method !== 'totp') {
            return yield* Effect.die('Expected TOTP')
          }
          const secret = new URL(replacement.totpURI).searchParams.get('secret')
          if (!secret) {
            return yield* Effect.die('Expected secret')
          }
          const [pending] = yield* Effect.promise(() =>
            provisioned.db
              .select()
              .from(twoFactor)
              .where(eq(twoFactor.userId, challenge.userId))
          )
          expect(pending?.verified).toBe(false)
          expect((yield* readSession(headers)).recoveryUntil).toEqual(
            original.recoveryUntil
          )
          const { code } = yield* auth.api.generateTOTP({
            body: { secret: decodeUriSecret(secret) }
          })
          yield* auth.api.verifyTOTP({ body: { code }, headers })
          const completed = yield* readSession(headers)
          expect(completed.recoveryUntil).toBeNull()
          expect(completed.strongAuthMethod).toBe('totp')
          expect(completed.strongAuthCredentialId).toBe(pending?.id)
        })
      ),
    { timeout: 30_000 }
  )

  it.live(
    'audits recovery and refuses an expired recovery cookie',
    () =>
      run(
        Effect.gen(function* () {
          const email = 'deadline@assurance.test'
          const challenge = yield* backupChallenge(email)
          const auth = yield* Auth.Tag
          const verified = yield* auth.full.verifyBackupCode({
            body: { code: challenge.code },
            headers: challenge.headers
          })
          const headers = headersOf(verified.headers)
          const recovery = yield* readSession(headers)
          expect(recoveryStarted).toHaveBeenCalledWith(
            expect.objectContaining({
              userId: challenge.userId,
              sessionId: recovery.id,
              email,
              expiresAt: expect.any(Date)
            })
          )
          yield* Effect.promise(() =>
            provisioned.db
              .update(session)
              .set({ expiresAt: new Date(Date.now() - 1000) })
              .where(eq(session.id, recovery.id))
          )
          expect(yield* auth.api.getSession({ headers })).toBeNull()
        })
      ),
    { timeout: 30_000 }
  )

  it.live(
    'revokes the session when recovery notification fails after code consumption',
    () =>
      run(
        Effect.gen(function* () {
          const challenge = yield* backupChallenge('failed-notice@assurance.test')
          const auth = yield* Auth.Tag
          recoveryStarted.mockRejectedValueOnce(new Error('Notification unavailable'))
          const result = yield* Effect.exit(
            auth.api.verifyBackupCode({
              body: { code: challenge.code },
              headers: challenge.headers
            })
          )
          expect(Exit.isFailure(result)).toBe(true)
          const event = recoveryStarted.mock.calls.at(-1)?.[0]
          expect(event?.sessionId).toBeTypeOf('string')
          const rows = yield* Effect.promise(() =>
            provisioned.db.select().from(session).where(eq(session.id, event.sessionId))
          )
          expect(rows).toHaveLength(0)
          const replay = yield* Effect.exit(
            auth.api.verifyBackupCode({
              body: { code: challenge.code },
              headers: challenge.headers
            })
          )
          expect(Exit.isFailure(replay)).toBe(true)
        })
      ),
    { timeout: 30_000 }
  )

  it.live(
    'refresh preserves the original strong timestamp and impersonation starts without proof',
    () =>
      run(
        Effect.gen(function* () {
          const admin = yield* signUpSession('admin@assurance.test')
          const target = yield* signUpSession('target@assurance.test')
          const enrolled = yield* enableTotp(admin)
          const headers = new Headers({ cookie: enrolled.freshCookieHeader })
          const original = yield* readSession(headers)
          expect(original.strongAuthMethod).toBe('totp')
          yield* Effect.promise(() =>
            provisioned.db
              .update(user)
              .set({ role: 'admin' })
              .where(eq(user.id, admin.userId))
          )
          yield* Effect.promise(() =>
            provisioned.db
              .update(session)
              .set({ expiresAt: new Date(Date.now() + 60_000) })
              .where(eq(session.id, original.id))
          )
          const refreshed = yield* readSession(headers)
          expect(refreshed.expiresAt.getTime()).toBeGreaterThan(
            original.createdAt.getTime() + 86_400_000
          )
          expect(refreshed.strongAuthAt).toEqual(original.strongAuthAt)
          const auth = yield* Auth.Tag
          const impersonated = yield* auth.full.impersonateUser({
            body: { userId: target.userId },
            headers
          })
          const impersonation = yield* readSession(headersOf(impersonated.headers))
          expect(impersonation.impersonatedBy).toBe(admin.userId)
          expect(impersonation.passwordVerifiedAt).toBeNull()
          expect(impersonation.strongAuthAt).toBeNull()
          expect(impersonation.strongAuthCredentialId).toBeNull()
        })
      ),
    { timeout: 30_000 }
  )

  it.live(
    'removing TOTP invalidates every session that used that factor',
    () =>
      run(
        Effect.gen(function* () {
          const signup = yield* signUpSession('removed@assurance.test')
          const enrolled = yield* enableTotp(signup)
          const firstHeaders = new Headers({ cookie: enrolled.freshCookieHeader })
          const auth = yield* Auth.Tag
          const original = yield* readSession(firstHeaders)
          const challenge = yield* auth.full.signInEmail({
            body: { email: 'removed@assurance.test', password: PASSWORD }
          })
          const secret = new URL(enrolled.response.totpURI).searchParams.get('secret')
          if (!secret) {
            return yield* Effect.die('Expected secret')
          }
          const { code } = yield* auth.api.generateTOTP({
            body: { secret: decodeUriSecret(secret) }
          })
          const verified = yield* auth.full.verifyTOTP({
            body: { code },
            headers: headersOf(challenge.headers)
          })
          const other = yield* readSession(headersOf(verified.headers))
          expect(other.strongAuthMethod).toBe('totp')
          yield* auth.api.disableTwoFactor({
            body: { password: PASSWORD },
            headers: firstHeaders
          })
          const rows = yield* Effect.promise(() =>
            provisioned.db
              .select()
              .from(session)
              .where(eq(session.userId, signup.userId))
          )
          expect(rows.some((row) => row.id === original.id)).toBe(false)
          expect(
            rows.every(
              (row) => row.strongAuthAt === null && row.strongAuthCredentialId === null
            )
          ).toBe(true)
        })
      ),
    { timeout: 30_000 }
  )
})
