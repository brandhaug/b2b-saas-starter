import { type DrizzleDatabase } from '@b2b-saas-starter/db/client'
import { user, verification } from '@b2b-saas-starter/db/schema'
import { Effect, type Layer } from 'effect'
import { type BetterAuthApiError } from 'effectful-better-auth'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'
import { type AuthEmailSender, Auth } from './index.ts'
import {
  buildAuthLayer,
  provisionAuthD1,
  signUpSession,
  type AuthService,
  type ProvisionedAuthD1
} from './test-auth-layer.ts'

// The account lifecycle's email-driven flows — verification, password reset,
// the email-otp one-time codes, and the magic link — are only observable end
// to end: the tokens, hashes, and session revocations resolve inside Better
// Auth against a real database, so this suite drives `Auth.api` and the raw
// instance handler against a local D1 (workerd) and plays the mailbox through
// a capturing email sender.

let db: DrizzleDatabase
let provisioned: ProvisionedAuthD1
let authLayer: Layer.Layer<AuthService>

// The lifecycle-email port, capturing what Better Auth hands it instead of
// sending: these tests assert on the URLs and the calls, not on delivery.
const sentEmails: Array<{
  readonly kind: 'reset' | 'verification' | 'magic-link'
  readonly email: string
  readonly url: string
}> = []

// The email-otp codes, captured so a test can play the mailbox: the code is
// the payload, and the lockout test needs the real one to prove a correct
// fourth attempt still dies.
const sentCodes: Array<{
  readonly email: string
  readonly otp: string
  readonly type: 'sign-in' | 'email-verification' | 'forget-password' | 'change-email'
}> = []

const capturingEmailSender: AuthEmailSender = {
  // Destructured off `data` rather than the parameter: `user` up here is the
  // imported table.
  sendResetPassword: (data) => {
    sentEmails.push({ kind: 'reset', email: data.user.email, url: data.url })
    return Promise.resolve()
  },
  sendVerificationEmail: (data) => {
    sentEmails.push({
      kind: 'verification',
      email: data.user.email,
      url: data.url
    })
    return Promise.resolve()
  },
  sendOneTimeCode: (data) => {
    sentCodes.push({ email: data.email, otp: data.otp, type: data.type })
    return Promise.resolve()
  },
  sendMagicLink: (data) => {
    sentEmails.push({ kind: 'magic-link', email: data.email, url: data.url })
    return Promise.resolve()
  },
  // The reset confirmation is a notification, not a flow input — the suite
  // has no assertion for it yet, so it captures nothing.
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

describe('account lifecycle email flows', () => {
  it('sends a verification email on sign-up and verifies through the token hop', () =>
    run(
      Effect.gen(function* () {
        const email = 'newbie@lifecycle.test'
        const auth = yield* Auth.Tag
        const before = sentEmails.length

        const signUp = yield* auth.api.signUpEmail({
          body: {
            name: 'Newbie',
            email,
            password: 'correct-horse-battery-staple',
            callbackURL: 'http://localhost:3071/verify-email'
          }
        })
        expect(signUp.user.emailVerified).toBe(false)

        const sent = sentEmails
          .slice(before)
          .filter((entry) => entry.kind === 'verification')
        expect(sent).toHaveLength(1)
        const url = sent[0]?.url ?? ''
        // The link points at the auth handler's token-exchange route with our
        // landing page as the callback — not straight at the app route.
        expect(url).toContain('http://localhost:3071/api/auth/verify-email?token=')
        expect(url).toContain(encodeURIComponent('http://localhost:3071/verify-email'))

        const response = yield* Effect.promise(() =>
          auth.instance.handler(new Request(url))
        )
        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe(
          'http://localhost:3071/verify-email'
        )
        // autoSignInAfterVerification: the hop sets a session cookie.
        expect(response.headers.get('set-cookie')).toContain('better-auth')

        const rows = yield* Effect.promise(() =>
          db.select().from(user).where(eq(user.email, email))
        )
        expect(rows[0]?.emailVerified).toBe(true)
      })
    ))

  it('rejects a bad verification token by redirecting with an error param', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Tag
        const response = yield* Effect.promise(() =>
          auth.instance.handler(
            new Request(
              `http://localhost:3071/api/auth/verify-email?token=not-a-real-token&callbackURL=${encodeURIComponent('http://localhost:3071/verify-email')}`
            )
          )
        )
        expect(response.status).toBe(302)
        const location = response.headers.get('location') ?? ''
        expect(new URL(location).searchParams.get('error')).toBeTruthy()
      })
    ))

  it('round-trips a password reset: request, hop, set, old sessions revoked', () =>
    run(
      Effect.gen(function* () {
        const email = 'resetter@lifecycle.test'
        const auth = yield* Auth.Tag

        // The sign-up auto sign-in creates the session the reset must revoke.
        const { headers } = yield* auth.full.signUpEmail({
          body: {
            name: 'Resetter',
            email,
            password: 'correct-horse-battery-staple'
          }
        })
        const before = sentEmails.length

        const requested = yield* auth.api.requestPasswordReset({
          body: { email, redirectTo: 'http://localhost:3071/reset-password' }
        })
        expect(requested.status).toBe(true)

        const resetEmail = sentEmails
          .slice(before)
          .find((entry) => entry.kind === 'reset')
        const resetUrl = resetEmail?.url ?? ''
        expect(resetUrl).toContain('http://localhost:3071/api/auth/reset-password/')
        const token = resetUrl.split('/reset-password/')[1]?.split('?')[0] ?? ''
        expect(token).not.toBe('')

        // The token-exchange hop validates the token and forwards it.
        const hop = yield* Effect.promise(() =>
          auth.instance.handler(new Request(resetUrl))
        )
        expect(hop.status).toBe(302)
        const forwarded = new URL(hop.headers.get('location') ?? '')
        expect(forwarded.pathname).toBe('/reset-password')
        expect(forwarded.searchParams.get('token')).toBe(token)

        const reset = yield* auth.api.resetPassword({
          body: { newPassword: 'fresh-horse-battery-staple', token }
        })
        expect(reset.status).toBe(true)

        // The pre-reset session cookie no longer opens a session
        // (revokeSessionsOnPasswordReset). The endpoint's no-session answer
        // is 200 with a `null` body, so the body is the assertion.
        const stale = yield* Effect.promise(() =>
          auth.instance.handler(
            new Request('http://localhost:3071/api/auth/get-session', {
              headers: { cookie: headers.get('set-cookie') ?? '' }
            })
          )
        )
        expect(stale.status).toBe(200)
        const staleBody = yield* Effect.promise(() => stale.json())
        expect(staleBody).toBeNull()

        // The old password is gone; the new one signs in.
        const oldAttempt = yield* auth.api
          .signInEmail({
            body: { email, password: 'correct-horse-battery-staple' }
          })
          .pipe(
            Effect.match({
              onFailure: () => ({ ok: false }),
              onSuccess: () => ({ ok: true })
            })
          )
        expect(oldAttempt.ok).toBe(false)

        const fresh = yield* auth.api.signInEmail({
          body: { email, password: 'fresh-horse-battery-staple' }
        })
        expect(fresh.user.email).toBe(email)
      })
    ))

  it('answers unknown-email reset requests identically and sends nothing', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Tag
        const before = sentEmails.length

        const requested = yield* auth.api.requestPasswordReset({
          body: {
            email: 'ghost@lifecycle.test',
            redirectTo: 'http://localhost:3071/reset-password'
          }
        })
        expect(requested.status).toBe(true)
        expect(requested.message).toContain('If this email exists')
        expect(sentEmails.slice(before)).toHaveLength(0)
      })
    ))
})

describe('email-otp plugin', () => {
  /** The code the send endpoint generated for one email, most recent first. */
  function codeFor(email: string): string {
    const sent = sentCodes.toReversed().find((entry) => entry.email === email)
    if (sent === undefined) {
      throw new Error(`no one-time code was sent to ${email}`)
    }
    return sent.otp
  }

  /**
   * Plays a verify round, collapsing the thrown APIError to its numeric
   * status. This better-call version carries the code on `statusCode` (its
   * `status` holds the status NAME). Non-async on purpose: the Effect lint
   * rules ban `async` helpers, and a `.then` chain reads the same. Nothing
   * reads the fulfilled value, so the generic is never bound at a call site.
   */
  /** The outcome of one sign-in attempt: success, or the plugin's status code. */
  function attempt<A>(
    call: Effect.Effect<A, BetterAuthApiError>
  ): Effect.Effect<
    { readonly ok: true } | { readonly ok: false; readonly status: number }
  > {
    return Effect.match(call, {
      onFailure: (error) => ({ ok: false, status: error.statusCode }),
      onSuccess: () => ({ ok: true })
    })
  }

  it('sends a six-digit sign-in code and signs the holder in', () =>
    run(
      Effect.gen(function* () {
        const email = 'coder@otp.test'
        yield* signUpSession(email)
        const auth = yield* Auth.Tag
        const before = sentCodes.length

        const sent = yield* auth.api.sendVerificationOTP({
          body: { email, type: 'sign-in' }
        })
        expect(sent.success).toBe(true)

        const code = codeFor(email)
        expect(code).toMatch(/^\d{6}$/)
        expect(sentCodes.slice(before)[0]?.type).toBe('sign-in')

        const { headers, response } = yield* auth.full.signInEmailOTP({
          body: { email, otp: code }
        })
        expect(response.user.email).toBe(email)
        expect(headers.getSetCookie().join(' ')).toContain('better-auth')
      })
    ))

  it('locks the code after three failed attempts, even for the correct one', () =>
    run(
      Effect.gen(function* () {
        const email = 'lockout@otp.test'
        yield* signUpSession(email)
        const auth = yield* Auth.Tag

        yield* auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } })
        const code = codeFor(email)

        // Three wrong attempts are each answered INVALID_OTP (400). The wrong
        // code is defined against the real one, so the test cannot flake into
        // a correct guess.
        let wrongCode = '000000'
        if (code === '000000') {
          wrongCode = '000001'
        }
        for (let attemptNo = 0; attemptNo < 3; attemptNo += 1) {
          const wrong = yield* attempt(
            auth.api.signInEmailOTP({ body: { email, otp: wrongCode } })
          )
          expect(wrong).toEqual({ ok: false, status: 400 })
        }

        // The fourth attempt carries the correct code and still dies —
        // TOO_MANY_ATTEMPTS (403), the plugin's lockout.
        const locked = yield* attempt(
          auth.api.signInEmailOTP({ body: { email, otp: code } })
        )
        expect(locked).toEqual({ ok: false, status: 403 })

        // And the lockout consumed the code: the row is gone, so even the
        // correct code now reads as invalid. A fresh send is the only way in.
        const consumed = yield* attempt(
          auth.api.signInEmailOTP({ body: { email, otp: code } })
        )
        expect(consumed).toEqual({ ok: false, status: 400 })
      })
    ))

  it('answers an unknown email identically and sends nothing', () =>
    run(
      Effect.gen(function* () {
        const email = 'ghost@otp.test'
        const auth = yield* Auth.Tag
        const before = sentCodes.length

        const sent = yield* auth.api.sendVerificationOTP({
          body: { email, type: 'sign-in' }
        })
        expect(sent.success).toBe(true)
        expect(sentCodes.slice(before)).toHaveLength(0)

        // With disableSignUp the unsent code verifies to nothing.
        const verify = yield* attempt(
          auth.api.signInEmailOTP({ body: { email, otp: '123456' } })
        )
        expect(verify).toEqual({ ok: false, status: 400 })
      })
    ))

  it('verifies an email address with a code and opens a session', () =>
    run(
      Effect.gen(function* () {
        const email = 'verify-by-code@otp.test'
        const { userId } = yield* signUpSession(email)
        const auth = yield* Auth.Tag

        yield* auth.api.sendVerificationOTP({
          body: { email, type: 'email-verification' }
        })

        // The unverified state the link flow would clear:
        const unverified = yield* Effect.promise(() =>
          db.select().from(user).where(eq(user.id, userId))
        )
        expect(unverified[0]?.emailVerified).toBe(false)

        const verified = yield* auth.api.verifyEmailOTP({
          body: { email, otp: codeFor(email) }
        })
        expect(verified.status).toBe(true)
        // autoSignInAfterVerification carries over: the response names a session.
        expect(verified.token).not.toBeNull()

        const rows = yield* Effect.promise(() =>
          db.select().from(user).where(eq(user.id, userId))
        )
        expect(rows[0]?.emailVerified).toBe(true)
      })
    ))

  it('resets a password with a code and revokes the prior sessions', () =>
    run(
      Effect.gen(function* () {
        const email = 'otp-reset@otp.test'
        const { headers } = yield* signUpSession(email)
        const auth = yield* Auth.Tag

        const requested = yield* auth.api.requestPasswordResetEmailOTP({
          body: { email }
        })
        expect(requested.success).toBe(true)

        const reset = yield* auth.api.resetPasswordEmailOTP({
          body: {
            email,
            otp: codeFor(email),
            password: 'fresh-otp-password-1'
          }
        })
        expect(reset.success).toBe(true)

        // Same contract as the link reset: the pre-reset session is gone.
        const stale = yield* Effect.promise(() =>
          auth.instance.handler(
            new Request('http://localhost:3071/api/auth/get-session', {
              headers: { cookie: headers.get('cookie') ?? '' }
            })
          )
        )
        const staleBody = yield* Effect.promise(() => stale.json())
        expect(staleBody).toBeNull()

        const fresh = yield* auth.api.signInEmail({
          body: { email, password: 'fresh-otp-password-1' }
        })
        expect(fresh.user.email).toBe(email)
      })
    ))
})

describe('magic-link sign-in', () => {
  // The app's adapter sends these three callbacks with every request; the
  // tests mirror them so the hop's redirects are the ones users see.
  const callbacks = {
    callbackURL: 'http://localhost:3071/magic-link/verify',
    newUserCallbackURL: 'http://localhost:3071/magic-link/verify',
    errorCallbackURL: 'http://localhost:3071/magic-link/verify'
  }

  it('round-trips a link for an existing user: request, hop, session', () =>
    run(
      Effect.gen(function* () {
        const email = 'linker@magic.test'
        const auth = yield* Auth.Tag
        yield* signUpSession(email)
        const before = sentEmails.length

        const requested = yield* auth.api.signInMagicLink({
          body: { email, ...callbacks },
          // The endpoint is `requireHeaders: true` (it carries the CSRF
          // middleware); a bare header set satisfies the requirement here.
          headers: new Headers()
        })
        expect(requested.status).toBe(true)

        const sent = sentEmails
          .slice(before)
          .filter((entry) => entry.kind === 'magic-link')
        expect(sent).toHaveLength(1)
        const url = sent[0]?.url ?? ''
        expect(url).toContain('http://localhost:3071/api/auth/magic-link/verify?token=')

        const response = yield* Effect.promise(() =>
          auth.instance.handler(new Request(url))
        )
        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe(
          'http://localhost:3071/magic-link/verify'
        )
        // The hop opens the session itself — the arrival at the landing page
        // is already signed in.
        expect(response.headers.get('set-cookie')).toContain('better-auth')
      })
    ))

  it('stores the token hashed, not as the emailed plaintext', () =>
    run(
      Effect.gen(function* () {
        const email = 'hashed@magic.test'
        const auth = yield* Auth.Tag
        const before = sentEmails.length

        yield* auth.api.signInMagicLink({
          body: { email, ...callbacks },
          headers: new Headers()
        })

        const url = sentEmails
          .slice(before)
          .find((entry) => entry.kind === 'magic-link')?.url
        const token = new URL(url ?? '').searchParams.get('token') ?? ''
        expect(token).not.toBe('')
        // A read of the `verification` table must not be enough to mint a
        // session: the identifier is the hash, never the emailed token.
        const rows = yield* Effect.promise(() => db.select().from(verification))
        expect(rows.some((row) => row.identifier === token)).toBe(false)
      })
    ))

  it('creates a verified user when an unknown email consumes a link', () =>
    run(
      Effect.gen(function* () {
        const email = 'newcomer@magic.test'
        const auth = yield* Auth.Tag
        const before = sentEmails.length

        yield* auth.api.signInMagicLink({
          body: { email, ...callbacks },
          headers: new Headers()
        })
        const url = sentEmails
          .slice(before)
          .find((entry) => entry.kind === 'magic-link')?.url

        const response = yield* Effect.promise(() =>
          auth.instance.handler(new Request(url ?? ''))
        )
        // A brand-new account lands on the new-user callback, signed in —
        // consuming the link is the mailbox proof, so `requireEmailVerification`
        // has nothing left to gate.
        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe(
          'http://localhost:3071/magic-link/verify'
        )
        expect(response.headers.get('set-cookie')).toContain('better-auth')

        const rows = yield* Effect.promise(() =>
          db.select().from(user).where(eq(user.email, email))
        )
        expect(rows).toHaveLength(1)
        expect(rows[0]?.emailVerified).toBe(true)
      })
    ))
})
