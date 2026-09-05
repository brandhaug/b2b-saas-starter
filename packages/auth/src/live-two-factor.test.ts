import { type DrizzleDatabase } from '@b2b-saas-starter/db/client'
import { user } from '@b2b-saas-starter/db/schema'
import { Effect, type Layer } from 'effect'
import { cookieHeader as toCookieHeader, cookiePairs } from 'effectful-better-auth'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'
import { type AuthEmailSender, Auth } from './index.ts'
import {
  buildAuthLayer,
  enableTotp,
  provisionAuthD1,
  signUpSession,
  type AuthService,
  type ProvisionedAuthD1
} from './test-auth-layer.ts'
import { decodeUriSecret } from './test-totp.ts'

// The two-factor challenge hop is only observable end to end: whether a
// credential sign-in leaves a working session or a pending challenge is
// decided inside the plugin's after-hook against a real database. This suite
// drives `Auth.instance` against a local D1 (workerd) and pins the three
// halves of the hop's contract:
//
// 1. A credential sign-in for a TOTP-enabled user answers `twoFactorRedirect`
//    and leaves NO working session — the hook deletes the session it had
//    minted and sets the two-factor challenge cookie instead.
// 2. Completing the challenge with a code mints the session the sign-in
//    withheld.
// 3. The email-OTP sign-in still mints a session outright for that same
//    user — the plugin's hook matches the credential endpoints only, which
//    is exactly why the app-layer gate (`two-factor-sign-in-gate.ts` in
//    apps/web) exists for the mailbox-only paths.

// The shared suite's sign-up password, restated because `test-auth-layer`
// keeps it private: a sign-in attempt has to present it.
const PASSWORD = 'correct-horse-battery-staple'

const BASE_URL = 'http://localhost:3071'

let db: DrizzleDatabase
let provisioned: ProvisionedAuthD1
let authLayer: Layer.Layer<AuthService>

// The email-otp codes, captured so the gap test can play the mailbox.
const sentCodes: Array<{ readonly email: string; readonly otp: string }> = []

const capturingEmailSender: AuthEmailSender = {
  sendResetPassword: () => Promise.resolve(),
  sendVerificationEmail: () => Promise.resolve(),
  sendOneTimeCode: (data) => {
    sentCodes.push({ email: data.email, otp: data.otp })
    return Promise.resolve()
  },
  sendMagicLink: () => Promise.resolve(),
  sendPasswordResetConfirmation: () => Promise.resolve()
}

// oxlint-disable-next-line effect/noTestLifecycleHooks -- owns the workerd process
beforeAll(
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        provisioned = yield* Effect.promise(() => provisionAuthD1())
        db = provisioned.db
        authLayer = buildAuthLayer(db, { emails: capturingEmailSender })
      })
    ),
  60_000
)

// oxlint-disable-next-line effect/noTestLifecycleHooks -- disposes the workerd process
afterAll(() => provisioned.dispose())

function run<A, E>(effect: Effect.Effect<A, E, AuthService>) {
  return Effect.runPromise(Effect.provide(effect, authLayer))
}

/** The raw instance handler's answer for one credential sign-in attempt. */
function signInWithEmail(email: string) {
  return Effect.flatMap(Auth.Tag, (auth) =>
    Effect.promise(() =>
      auth.instance.handler(
        new Request(`${BASE_URL}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // oxlint-disable-next-line effect/noGlobals -- the auth handler's own JSON wire format is the thing under test here
          body: JSON.stringify({ email, password: PASSWORD })
        })
      )
    )
  )
}

/** Whether a cookie jar opens a session, played through the handler. */
function getSessionWith(cookieHeader: string) {
  return Effect.flatMap(Auth.Tag, (auth) =>
    Effect.promise(() =>
      auth.instance.handler(
        new Request(`${BASE_URL}/api/auth/get-session`, {
          headers: { cookie: cookieHeader }
        })
      )
    )
  )
}

/**
 * The decoded secret from a TOTP enable response, for the code generator. A
 * missing secret is a helper bug, same stance as live-email-flows' captures.
 */
function secretOf(totpURI: string): string {
  const secret = new URL(totpURI).searchParams.get('secret')
  if (secret === null) {
    throw new Error('the TOTP enable response carried no secret')
  }
  return decodeUriSecret(secret)
}

/** A TOTP-enabled user, via the shared ceremony, keeping the enable secret. */
function totpUser(email: string) {
  return Effect.gen(function* () {
    const session = yield* signUpSession(email)
    const { response } = yield* enableTotp(session)
    const secret = secretOf(response.totpURI)

    const rows = yield* Effect.promise(() =>
      db.select().from(user).where(eq(user.email, email))
    )
    expect(rows[0]?.twoFactorEnabled).toBe(true)
    return { secret }
  })
}

/** A code the server itself generated for a stored secret. */
function freshCode(secret: string) {
  return Effect.flatMap(Auth.Tag, (auth) => auth.api.generateTOTP({ body: { secret } }))
}

/** The code the send endpoint generated for one email, most recent first. */
function codeFor(email: string): string {
  const sent = sentCodes.toReversed().find((entry) => entry.email === email)
  if (sent === undefined) {
    throw new Error(`no one-time code was sent to ${email}`)
  }
  return sent.otp
}

describe('the two-factor challenge hop', () => {
  it('diverts a TOTP-enabled credential sign-in and leaves no working session', () =>
    run(
      Effect.gen(function* () {
        const email = 'challenge@twofactor.test'
        yield* totpUser(email)

        const signIn = yield* signInWithEmail(email)
        expect(signIn.status).toBe(200)
        const body = yield* Effect.promise(() => signIn.json())
        // The hook's answer replaces the sign-in's own.
        expect(body.twoFactorRedirect).toBe(true)

        // The challenge cookie is set in place of the session: the hook
        // deletes the session it had minted and expires its cookie, so the
        // jar the response builds opens nothing.
        const cookies = signIn.headers.getSetCookie().join(' ')
        expect(cookies).toContain('two_factor')
        const probe = yield* getSessionWith(toCookieHeader(cookiePairs(signIn.headers)))
        expect(probe.status).toBe(200)
        const probeBody = yield* Effect.promise(() => probe.json())
        expect(probeBody).toBeNull()
      })
    ))

  it('mints the session when the challenge is completed with a code', () =>
    run(
      Effect.gen(function* () {
        const email = 'completer@twofactor.test'
        const { secret } = yield* totpUser(email)

        // The challenge cookie the diverted sign-in set is the only thing
        // the verify step needs — no session exists yet at all.
        const signIn = yield* signInWithEmail(email)
        const { code } = yield* freshCode(secret)
        const auth = yield* Auth.Tag
        const verified = yield* auth.full.verifyTOTP({
          body: { code },
          headers: new Headers({
            cookie: toCookieHeader(cookiePairs(signIn.headers))
          })
        })
        expect(verified.response.user.email).toBe(email)
        expect(verified.response.token).not.toBeNull()

        // The verify step's own cookie is a real session: it names the user.
        const probe = yield* getSessionWith(
          toCookieHeader(cookiePairs(verified.headers))
        )
        const probeBody = yield* Effect.promise(() => probe.json())
        expect(probeBody?.user?.email).toBe(email)
      })
    ))

  it('still mints an email-OTP session for that same user — the gap the app gate closes', () =>
    run(
      Effect.gen(function* () {
        const email = 'otp-gap@twofactor.test'
        yield* totpUser(email)
        const auth = yield* Auth.Tag

        yield* auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } })

        // The plugin's two-factor hook matches the credential sign-in
        // endpoints only, so the emailed code mints the session outright —
        // documented here so the app-layer gate has a pinned reason to exist.
        const { response, headers } = yield* auth.full.signInEmailOTP({
          body: { email, otp: codeFor(email) }
        })
        expect(response.user.email).toBe(email)
        expect(headers.getSetCookie().join(' ')).toContain('session_token=')
      })
    ))
})
