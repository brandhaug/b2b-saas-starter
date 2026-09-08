// oxlint-disable effect/noGlobals -- Real-clock Better Auth ceremonies require real timestamps, including persisted expiry boundary tests.
import { type DrizzleDatabase } from './ports.ts'
import { user, session as sessionTable, twoFactor } from '@b2b-saas-starter/db/schema'
import { Effect, type Layer } from 'effect'
import {
  cookieHeader as toCookieHeader,
  cookiePairs,
  mergeCookiePairs
} from 'effectful-better-auth'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest'
import { type AuthEmailSender, Auth } from './index.ts'
import {
  buildAuthLayer,
  enableTotp,
  provisionAuthD1,
  signUpSession,
  type AuthService,
  type ProvisionedAuthD1
} from './test-auth-layer.ts'
import { decodeUriSecret, withNextTotpWindow } from './test-totp.ts'

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
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- the hook is the port: layer() suites expose no live tester for a real-clock suite, and a memoized fixture could not dispose its workerd process
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
  return Effect.provide(effect, authLayer)
}

/** The raw instance handler's answer for one credential sign-in attempt. */
function signInWithEmail(email: string, cookie = '') {
  return Effect.flatMap(Auth.Tag, (auth) =>
    Effect.promise(() =>
      auth.instance.handler(
        new Request(`${BASE_URL}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
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
    return { secret, backupCodes: response.backupCodes }
  })
}

/** A code the server itself generated for a stored secret. */
function freshCode(secret: string) {
  return Effect.flatMap(Auth.Tag, (auth) =>
    Effect.promise(() =>
      withNextTotpWindow(() =>
        // oxlint-disable-next-line starter/no-run-promise-in-tests -- bridge the Auth service effect into the native clock shim
        Effect.runPromise(auth.api.generateTOTP({ body: { secret } }))
      )
    )
  )
}

/** The code the send endpoint generated for one email, most recent first. */
function codeFor(email: string): string {
  const sent = sentCodes.toReversed().find((entry) => entry.email === email)
  if (sent === undefined) {
    throw new Error(`no one-time code was sent to ${email}`)
  }
  return sent.otp
}

function storedSession(cookieHeader: string, phase = 'session') {
  return Effect.gen(function* () {
    const auth = yield* Auth.Tag
    const current = yield* auth.api.getSession({
      headers: new Headers({ cookie: cookieHeader })
    })
    if (!current) {
      return yield* Effect.die(`Expected an authenticated session at ${phase}`)
    }
    const [row] = yield* Effect.promise(() =>
      db.select().from(sessionTable).where(eq(sessionTable.id, current.session.id))
    )
    if (!row) {
      return yield* Effect.die('Session missing from D1')
    }
    return row
  })
}

function weakEmailSession(email: string) {
  return Effect.gen(function* () {
    const auth = yield* Auth.Tag
    // Verify the signup mailbox first; Better Auth removes unproven passwords
    // when an OTP first verifies an email address.
    yield* Effect.promise(() =>
      db.update(user).set({ emailVerified: true }).where(eq(user.email, email))
    )
    yield* auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } })
    const signed = yield* auth.full.signInEmailOTP({
      body: { email, otp: codeFor(email) }
    })
    return toCookieHeader(cookiePairs(signed.headers))
  })
}

describe('the two-factor challenge hop', () => {
  it.live(
    'records enrollment proof on the rotated session and invalidates it on password change',
    () =>
      run(
        Effect.gen(function* () {
          const signup = yield* signUpSession('enrollment@assurance.test')
          const auth = yield* Auth.Tag
          const old = yield* storedSession(signup.cookieHeader)
          expect(old.strongAuthAt).toBeNull()
          const enrolled = yield* enableTotp(signup)
          const rotated = yield* storedSession(enrolled.freshCookieHeader)
          expect(rotated.id).not.toBe(old.id)
          expect(rotated.passwordVerifiedAt).toBeInstanceOf(Date)
          expect(rotated.strongAuthMethod).toBe('totp')
          const [factor] = yield* Effect.promise(() =>
            db.select().from(twoFactor).where(eq(twoFactor.userId, signup.userId))
          )
          expect(rotated.strongAuthCredentialId).toBe(factor?.id)
          yield* auth.api.changePassword({
            body: {
              currentPassword: PASSWORD,
              newPassword: 'another-correct-password'
            },
            headers: new Headers({ cookie: enrolled.freshCookieHeader })
          })
          const changed = yield* storedSession(enrolled.freshCookieHeader)
          expect(changed.strongAuthAt).toBeNull()
          expect(changed.passwordVerifiedAt).toBeNull()
        })
      ),
    { timeout: 30_000 }
  )

  it.live(
    'does not share password proof between concurrent sessions and rejects stale pairing',
    () =>
      run(
        Effect.gen(function* () {
          const email = 'isolated@assurance.test'
          const { secret } = yield* totpUser(email)
          const auth = yield* Auth.Tag
          const firstCookie = yield* weakEmailSession(email)
          const secondCookie = yield* weakEmailSession(email)
          const firstHeaders = new Headers({ cookie: firstCookie })
          const secondHeaders = new Headers({ cookie: secondCookie })
          const { code } = yield* freshCode(secret)
          yield* auth.api.verifyTOTP({ body: { code }, headers: secondHeaders })
          expect((yield* storedSession(secondCookie)).strongAuthAt).toBeNull()
          yield* auth.api.verifyPassword({
            body: { password: PASSWORD },
            headers: firstHeaders
          })
          yield* Effect.all(
            [
              auth.api.verifyTOTP({ body: { code }, headers: firstHeaders }),
              auth.api.verifyTOTP({ body: { code }, headers: secondHeaders })
            ],
            { concurrency: 'unbounded' }
          )
          expect((yield* storedSession(firstCookie)).strongAuthMethod).toBe('totp')
          expect((yield* storedSession(secondCookie)).strongAuthAt).toBeNull()
          const first = yield* storedSession(firstCookie)
          yield* Effect.promise(() =>
            db
              .update(sessionTable)
              .set({
                passwordVerifiedAt: new Date(Date.now() - 301_000),
                strongAuthAt: null
              })
              .where(eq(sessionTable.id, first.id))
          )
          yield* auth.api.verifyTOTP({ body: { code }, headers: firstHeaders })
          expect((yield* storedSession(firstCookie)).strongAuthAt).toBeNull()
        })
      ),
    { timeout: 30_000 }
  )

  it.live(
    'trusted-device password bypass creates password evidence without strong evidence',
    () =>
      run(
        Effect.gen(function* () {
          const email = 'trusted@assurance.test'
          const { secret } = yield* totpUser(email)
          const auth = yield* Auth.Tag
          const challenge = yield* signInWithEmail(email)
          const { code } = yield* freshCode(secret)
          const verified = yield* auth.full.verifyTOTP({
            body: { code, trustDevice: true },
            headers: new Headers({
              cookie: toCookieHeader(cookiePairs(challenge.headers))
            })
          })
          const strong = yield* storedSession(
            toCookieHeader(mergeCookiePairs([], cookiePairs(verified.headers)))
          )
          expect(strong.strongAuthMethod).toBe('totp')
          const trusted = cookiePairs(verified.headers).filter((cookie) =>
            cookie.includes('trust_device=')
          )
          const bypass = yield* signInWithEmail(email, toCookieHeader(trusted))
          const weak = yield* storedSession(toCookieHeader(cookiePairs(bypass.headers)))
          expect(weak.passwordVerifiedAt).toBeInstanceOf(Date)
          expect(weak.strongAuthAt).toBeNull()
        })
      ),
    { timeout: 30_000 }
  )

  it.live(
    'backup codes open recovery for at most one hour through factor rotation',
    () =>
      run(
        Effect.gen(function* () {
          const email = 'recovery@assurance.test'
          const { backupCodes, secret } = yield* totpUser(email)
          const code = backupCodes[0]
          const secondCode = backupCodes[1]
          if (!code || !secondCode) {
            return yield* Effect.die('Missing generated backup codes')
          }
          const auth = yield* Auth.Tag
          const challenge = yield* signInWithEmail(email)
          const recovered = yield* auth.full.verifyBackupCode({
            body: { code },
            headers: new Headers({
              cookie: toCookieHeader(cookiePairs(challenge.headers))
            })
          })
          const recoveryCookie = toCookieHeader(cookiePairs(recovered.headers))
          const recovery = yield* storedSession(recoveryCookie, 'backup-code')
          expect(recovery.strongAuthAt).toBeNull()
          expect(recovery.recoveryUntil).toBeInstanceOf(Date)
          expect(recovery.expiresAt).toEqual(recovery.recoveryUntil)
          expect(
            (recovery.recoveryUntil?.getTime() ?? 0) - Date.now()
          ).toBeLessThanOrEqual(3_600_000)
          yield* auth.api.verifyBackupCode({
            body: { code: secondCode },
            headers: new Headers({ cookie: recoveryCookie })
          })
          expect(
            (yield* storedSession(recoveryCookie, 'backup-code')).recoveryUntil
          ).toEqual(recovery.recoveryUntil)
          yield* auth.api.verifyPassword({
            body: { password: PASSWORD },
            headers: new Headers({ cookie: recoveryCookie })
          })
          const { code: oldFactorCode } = yield* freshCode(secret)
          yield* auth.api.verifyTOTP({
            body: { code: oldFactorCode },
            headers: new Headers({ cookie: recoveryCookie })
          })
          const stillRecovering = yield* storedSession(recoveryCookie)
          expect(stillRecovering.recoveryUntil).toEqual(recovery.recoveryUntil)
          expect(stillRecovering.strongAuthAt).toBeNull()
          const disabled = yield* auth.full.disableTwoFactor({
            body: { password: PASSWORD },
            headers: new Headers({ cookie: recoveryCookie })
          })
          const disabledCookie = toCookieHeader(
            mergeCookiePairs([], cookiePairs(disabled.headers))
          )
          const rotated = yield* storedSession(disabledCookie, 'disable')
          expect(rotated.id).not.toBe(recovery.id)
          expect(rotated.recoveryUntil).toEqual(recovery.recoveryUntil)
          const enabled = yield* auth.full.enableTwoFactor({
            body: { password: PASSWORD },
            headers: new Headers({ cookie: disabledCookie })
          })
          if (enabled.response.method !== 'totp') {
            return yield* Effect.die('Expected TOTP')
          }
          const { code: replacementCode } = yield* freshCode(
            secretOf(enabled.response.totpURI)
          )
          const verified = yield* auth.full.verifyTOTP({
            body: { code: replacementCode },
            headers: new Headers({ cookie: disabledCookie })
          })
          const replaced = yield* storedSession(
            toCookieHeader(mergeCookiePairs([], cookiePairs(verified.headers)))
          )
          expect(replaced.recoveryUntil).toBeNull()
          expect(replaced.strongAuthMethod).toBe('totp')
          expect(replaced.strongAuthCredentialId).not.toBeNull()
        })
      ),
    { timeout: 30_000 }
  )

  it.live(
    'diverts a TOTP-enabled credential sign-in and leaves no working session',
    () =>
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
          const probe = yield* getSessionWith(
            toCookieHeader(cookiePairs(signIn.headers))
          )
          expect(probe.status).toBe(200)
          const probeBody = yield* Effect.promise(() => probe.json())
          expect(probeBody).toBeNull()
        })
      ),
    { timeout: 30_000 }
  )

  it.live(
    'mints the session when the challenge is completed with a code',
    () =>
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
            toCookieHeader(mergeCookiePairs([], cookiePairs(verified.headers)))
          )
          const probeBody = yield* Effect.promise(() => probe.json())
          expect(probeBody?.user?.email).toBe(email)
          const strong = yield* storedSession(
            toCookieHeader(mergeCookiePairs([], cookiePairs(verified.headers)))
          )
          expect(strong.strongAuthMethod).toBe('totp')
          expect(strong.strongAuthCredentialId).toBeTruthy()
        })
      ),
    { timeout: 30_000 }
  )

  it.live(
    'still mints an email-OTP session for that same user — the gap the app gate closes',
    () =>
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
      ),
    { timeout: 30_000 }
  )
})
