import { afterAll, beforeAll, expect, it } from '@effect/vitest'
import { Effect, Result, type Layer } from 'effect'
import { cookieHeader, cookiePairs, mergeCookiePairs } from 'effectful-better-auth'
import { Auth } from './index.ts'
import { decodeUriSecret, withNextTotpWindow } from './test-totp.ts'
import {
  buildAuthLayer,
  provisionAuthD1,
  signUpSession,
  type AuthService,
  type ProvisionedAuthD1
} from './test-auth-layer.ts'

let provisioned: ProvisionedAuthD1
let authLayer: Layer.Layer<AuthService>

// oxlint-disable-next-line effect/noTestLifecycleHooks -- owns the workerd process
beforeAll(
  () =>
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- lifecycle bridge for the real D1 process
    Effect.runPromise(
      Effect.gen(function* () {
        provisioned = yield* Effect.promise(() => provisionAuthD1())
        authLayer = buildAuthLayer(provisioned.db)
      })
    ),
  60_000
)
// oxlint-disable-next-line effect/noTestLifecycleHooks -- disposes the workerd process
afterAll(() => provisioned.dispose())

it.live(
  'a consumed authenticator code cannot verify again in the same or another session',
  () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Tag
      const email = 'consumed-code@assurance.test'
      const password = 'correct-horse-battery-staple'
      const signup = yield* signUpSession(email)
      const enabled = yield* auth.full.enableTwoFactor({
        body: { password },
        headers: signup.headers
      })
      if (enabled.response.method !== 'totp') {
        return yield* Effect.die('Expected TOTP enrollment')
      }
      const secret = new URL(enabled.response.totpURI).searchParams.get('secret')
      if (!secret) {
        return yield* Effect.die('Expected TOTP secret')
      }
      const { code } = yield* auth.api.generateTOTP({
        body: { secret: decodeUriSecret(secret) }
      })
      const enrolled = yield* auth.full.verifyTOTP({
        body: { code },
        headers: signup.headers
      })
      const headers = new Headers({
        cookie: cookieHeader(
          mergeCookiePairs(signup.cookiePairs, cookiePairs(enrolled.headers))
        )
      })
      const sameSession = yield* Effect.result(
        auth.api.verifyTOTP({ body: { code }, headers })
      )
      expect(Result.isFailure(sameSession)).toBe(true)

      const signIn = yield* auth.full.signInEmail({ body: { email, password } })
      const challengeHeaders = new Headers({
        cookie: cookieHeader(cookiePairs(signIn.headers))
      })
      const anotherSession = yield* Effect.result(
        auth.api.verifyTOTP({ body: { code }, headers: challengeHeaders })
      )
      expect(Result.isFailure(anotherSession)).toBe(true)
      const next = yield* Effect.promise(() =>
        withNextTotpWindow(() =>
          // oxlint-disable-next-line starter/no-run-promise-in-tests -- generate an authenticator code with the native library clock
          Effect.runPromise(
            auth.api.generateTOTP({ body: { secret: decodeUriSecret(secret) } })
          )
        )
      )
      const attempts = yield* Effect.all(
        [0, 1].map(() => Effect.result(auth.api.verifyTOTP({ body: next, headers }))),
        { concurrency: 'unbounded' }
      )
      expect(attempts.filter(Result.isSuccess)).toHaveLength(1)
      expect(attempts.filter(Result.isFailure)).toHaveLength(1)
    }).pipe(Effect.provide(authLayer))
)
