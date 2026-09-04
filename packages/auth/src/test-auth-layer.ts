import { createDrizzleDb, type DrizzleDatabase } from '@b2b-saas-starter/db/client'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { Effect, Layer } from 'effect'
import { type Service } from 'effectful-better-auth'
import {
  Auth,
  AuthConfig,
  type AuthConfigInterface,
  type AuthOptions
} from './index.ts'
import { testMcpConfig } from './test-mcp.ts'
import { decodeUriSecret } from './test-totp.ts'

/**
 * The one live-suite scaffold, shared by every suite that drives the real
 * `Auth` service against a local D1: provisioning, the default `AuthConfig`
 * layer, a session-cookie sign-up, and the cookie-merge plumbing. Test-only —
 * never import this from application code (same stance as `./testing` in
 * `packages/db`).
 */

/** The service type every live suite's `run` helper provides. */
export type AuthService = Service<AuthOptions>

/** What `provisionAuthD1` hands back, kept so suites can type their state. */
export type ProvisionedAuthD1 = {
  readonly d1: TestD1['d1']
  readonly db: DrizzleDatabase
  readonly dispose: () => Promise<void>
}

const SIGN_UP_PASSWORD = 'correct-horse-battery-staple'

// oxlint-disable-next-line effect/noAsyncFunction, eslint/require-await -- Better Auth's port signatures are Promise<void>; a default that does nothing is the point, and there is no Effect here to return
async function noop(): Promise<void> {
  return undefined
}

/**
 * Boots an isolated, non-persisted local D1 (workerd, every committed
 * migration applied) and opens the promise-based drizzle client Better Auth's
 * adapter needs. Callers own the lifecycle: run once per suite and always
 * `await dispose()` in `afterAll`.
 */
export function provisionAuthD1(): Promise<ProvisionedAuthD1> {
  return provisionTestD1().then((testD1) => ({
    d1: testD1.d1,
    db: createDrizzleDb(testD1.d1),
    dispose: () => testD1.dispose()
  }))
}

/**
 * The `Auth` service layer over a test config: the defaults every live suite
 * shares (a fixed secret, the local dev origin, no trusted origins, no-op
 * email sender and account hooks, an inline background runner, the refusing
 * MCP metadata transport), with the caller's overrides merged on top so a
 * suite states only what it differs in — the capturing email sender, an
 * active social provider, capturing account hooks.
 */
export function buildAuthLayer(
  db: DrizzleDatabase,
  overrides: Partial<AuthConfigInterface> = {}
): Layer.Layer<AuthService> {
  return Auth.layer.pipe(
    Layer.provide(
      Layer.sync(AuthConfig)(() => ({
        db,
        secret: 'test-secret-at-least-32-characters-long',
        baseURL: 'http://localhost:3071',
        trustedOrigins: [],
        // No-op callbacks (Better Auth's own Promise<void> signatures — no
        // Effect reaches its config). The suites that care override them.
        emails: {
          sendResetPassword: noop,
          sendVerificationEmail: noop,
          sendOneTimeCode: noop,
          sendMagicLink: noop
        },
        // No provider configured: the Local Auth Path shape, unchanged.
        socialProviders: {},
        accountHooks: {
          onAccountLinked: noop,
          onAccountUnlinked: noop
        },
        // Local-mode stance: the gate stays off in tests, matching dev.
        requireEmailVerification: false,
        // No execution context in a test: run the detached send inline and
        // keep its rejection off the isolate's unhandled path.
        runBackground: (promise) => {
          void promise.catch(() => undefined)
        },
        mcp: testMcpConfig(),
        ...overrides
      }))
    )
  )
}

/**
 * A real session cookie. Sign-up is the one flow every live suite needs a
 * signed-in user for; the superset return covers all the former per-suite
 * variants: `headers` for the endpoints that require request headers,
 * `cookieHeader`/`cookiePairs` for merging with later session rotations, and
 * `userId` for row-level assertions.
 */
export function signUpSession(email: string) {
  return Effect.gen(function* () {
    const auth = yield* Auth.Tag
    const { headers, response } = yield* Effect.promise(() =>
      auth.instance.api.signUpEmail({
        body: { email, name: email, password: SIGN_UP_PASSWORD },
        returnHeaders: true
      })
    )
    // Sign-up can set more than one cookie (the framework bridge forwards
    // each); keep every name=value pair, not just the first header.
    const setCookies = headers.getSetCookie()
    if (setCookies.length === 0) {
      // oxlint-disable-next-line starter/no-effect-escape-hatch -- test invariant: a sign-up that sets no cookie is a broken fixture, and dying fails exactly this test without widening the shared helper's error channel
      return yield* Effect.die(`sign-up set no cookie for ${email}`)
    }
    const cookieHeader = setCookies.map((cookie) => cookie.split(';')[0]).join('; ')
    return {
      headers: new Headers({ cookie: cookieHeader }),
      /** The sign-up cookies as `name=value` pairs, for merging with later rotations. */
      cookiePairs: cookieHeader.split('; ').filter(Boolean),
      cookieHeader,
      userId: response.user.id
    }
  })
}

/** Reads every `Set-Cookie` off a response as `name=value` pairs. */
export function responseCookies(headers: Headers): string {
  return headers.getSetCookie().join('; ')
}

/** Merges two cookie strings, later pairs winning on name collisions. */
export function mergeCookies(left: string, right: string): string {
  const merged = new Map<string, string>()
  for (const pair of [...left.split('; '), ...right.split('; ')]) {
    if (pair.length === 0) {
      continue
    }
    const separator = pair.indexOf('=')
    if (separator === -1) {
      merged.set(pair, pair)
      continue
    }
    merged.set(pair.slice(0, separator), pair)
  }
  return [...merged.values()].join('; ')
}

/**
 * The enable→verify TOTP ceremony, the way the account panel runs it: enable
 * (the one-time reveal of the otpauth URI and backup codes), then a first
 * verified code. Enabling stores an unverified secret only — the FIRST
 * verified code is what flips `twoFactorEnabled`, and it rotates the session
 * token, so the returned cookie is the sign-up cookie merged through every
 * rotation the ceremony caused. The raw instance API (not the effectful
 * proxy) is used because `returnHeaders` is what carries those cookies.
 */
export function enableTotp(cookieHeader: string) {
  return Effect.gen(function* () {
    const auth = yield* Auth.Tag
    const enabled = yield* Effect.promise(() =>
      auth.instance.api.enableTwoFactor({
        body: { password: SIGN_UP_PASSWORD },
        headers: new Headers({ cookie: cookieHeader }),
        returnHeaders: true
      })
    )
    const response = enabled.response
    if (response.method !== 'totp') {
      // oxlint-disable-next-line starter/no-effect-escape-hatch -- test invariant: the wrong response shape means the ceremony helper is broken, not the code under test
      return yield* Effect.die('expected TOTP enable response')
    }
    const secret = new URL(response.totpURI).searchParams.get('secret')
    if (secret === null) {
      // oxlint-disable-next-line starter/no-effect-escape-hatch -- test invariant: same as above — a malformed otpauth URI is a helper bug
      return yield* Effect.die('the TOTP enable response carried no secret')
    }
    // Server-side helper endpoint: turns a secret into a valid code, so the
    // test plays its own authenticator.
    const { code } = yield* auth.api.generateTOTP({
      body: { secret: decodeUriSecret(secret) }
    })
    const verified = yield* Effect.promise(() =>
      auth.instance.api.verifyTOTP({
        body: { code },
        headers: new Headers({
          cookie: mergeCookies(cookieHeader, responseCookies(enabled.headers))
        }),
        returnHeaders: true
      })
    )
    const freshCookieHeader = mergeCookies(
      mergeCookies(cookieHeader, responseCookies(enabled.headers)),
      responseCookies(verified.headers)
    )
    return { response, freshCookieHeader }
  })
}
